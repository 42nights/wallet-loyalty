// Shared test fixtures for the integration runner and the Playwright suite.
//
// Every run creates its OWN merchants / staff / cards through the service-role
// key, all tagged with a unique run id (slug + username prefix `t-<run>-`), and
// deletes them again in cleanup(). Nothing here touches the seeded merchants.
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// .env.local is parsed, not injected: the runner hands the app its own env and
// only needs the Supabase URL/key + pass type id for itself.
export function loadEnv() {
  let raw;
  try {
    raw = readFileSync(join(ROOT, ".env.local"));
  } catch {
    throw new Error("Missing .env.local at the repo root (see tests/README.md).");
  }
  const env = dotenv.parse(raw);
  return {
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    passTypeId: env.PASS_TYPE_ID || "pass.com.42nights.loyalty",
  };
}

// The suites create and delete rows, so they refuse to run against anything but
// a loopback Supabase — a copied production .env.local must never be a target.
export async function preflight(env) {
  if (!env.supabaseUrl || !env.serviceKey)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  const host = new URL(env.supabaseUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
    throw new Error(`Refusing to run: SUPABASE_URL (${host}) is not a local Supabase.`);
  let status = 0;
  try {
    const r = await fetch(`${env.supabaseUrl}/rest/v1/merchants?select=id&limit=1`, {
      headers: { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}` },
      signal: AbortSignal.timeout(5000),
    });
    status = r.status;
  } catch {
    /* unreachable */
  }
  if (status !== 200)
    throw new Error(
      `Local Supabase is not reachable at ${env.supabaseUrl} (status ${status || "no response"}). ` +
        "Run `supabase start` and apply supabase/schema.sql (see tests/README.md)."
    );
}

export function adminClient(env) {
  return createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
}

export function newRunId() {
  return Date.now().toString(36) + randomBytes(3).toString("hex");
}

function must({ data, error }, what) {
  if (error) throw new Error(`fixture ${what}: ${error.message}`);
  return data;
}

// A merchant with an owner and a cashier. Passwords are bcrypt-hashed exactly
// like scripts/seed.ts does (cost 4 — test-only, keeps setup fast).
// `stamps: { goal, reward }` makes it a stamp card (loyalty_mode = 'stamps').
export async function createMerchant(db, run, { key, template, earnRate, stamps }) {
  const slug = `t-${run}-${key}`;
  const stampCols = stamps ? { loyalty_mode: "stamps", stamp_goal: stamps.goal, stamp_reward: stamps.reward } : {};
  const m = must(
    await db
      .from("merchants")
      .insert({ name: `Test ${key} ${run}`, slug, earn_rate: earnRate, redeem_template: template, ...stampCols })
      .select("id")
      .single(),
    `merchant ${slug}`
  );
  const staff = {};
  for (const role of ["owner", "cashier"]) {
    const username = `${slug}-${role}`;
    const password = randomBytes(9).toString("hex");
    const row = must(
      await db
        .from("staff")
        .insert({ merchant_id: m.id, username, password_hash: await bcrypt.hash(password, 4), role })
        .select("id")
        .single(),
      `staff ${username}`
    );
    staff[role] = { id: row.id, username, password };
  }
  return { id: m.id, slug, template, earnRate, stamps, ...staff };
}

// A card with a zero balance. Points only ever arrive through the app
// (apply_points), so the ledger stays the source of truth in every test.
export async function createCard(db, merchantId, { name, phone = null }) {
  const card = { serial: randomUUID(), authToken: randomBytes(24).toString("hex"), name, phone };
  must(
    await db.from("passes").insert({
      serial: card.serial,
      merchant_id: merchantId,
      customer_name: name,
      customer_phone: phone,
      points: 0,
      auth_token: card.authToken,
    }),
    `card ${name}`
  );
  return card;
}

// Deletes everything a run created, in FK-safe order: transactions.merchant_id
// has no ON DELETE action, and passes.merchant_id is SET NULL (deleting the
// merchant first would orphan its cards). Devices are matched by the run prefix.
// Returns a list of error strings (empty = clean).
export async function cleanup(db, run) {
  const errors = [];
  const step = async (what, q) => {
    const { error } = await q;
    if (error) errors.push(`${what}: ${error.message}`);
  };
  const { data: merchants, error } = await db
    .from("merchants")
    .select("id")
    .like("slug", `t-${run}-%`);
  if (error) return [`list merchants: ${error.message}`];
  const ids = (merchants ?? []).map((m) => m.id);
  const { data: staff } = ids.length
    ? await db.from("staff").select("id").in("merchant_id", ids)
    : { data: [] };

  await step("devices", db.from("devices").delete().like("device_lib_id", `t-${run}-%`));
  if (ids.length) {
    await step("transactions", db.from("transactions").delete().in("merchant_id", ids));
    await step("passes", db.from("passes").delete().in("merchant_id", ids));
    await step("merchants", db.from("merchants").delete().in("id", ids));
  }
  const buckets = [run, ...(staff ?? []).map((s) => s.id)].map((k) => `bucket.like.*${k}*`);
  await step("rate_limits", db.from("rate_limits").delete().or(buckets.join(",")));
  return errors;
}
