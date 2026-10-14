// Integration oracle: the real app (`next dev`) against the real local Supabase.
// The only mock is Apple's push service (./mock-apns.mjs).
//
//   npm run test:integration            → exit 0 all ok, 1 any FAIL, 2 precondition missing
//   MUTATE=1 npm run test:integration   → flips one expectation; this run MUST fail
//
// Every run builds its own merchants/staff/cards (tests/fixtures.mjs) and deletes
// them at the end, so it never depends on — or disturbs — the seeded data.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ROOT, loadEnv, preflight, adminClient, newRunId, createMerchant, createCard, cleanup,
} from "../fixtures.mjs";
import { startMockApns } from "./mock-apns.mjs";

const PORT = Number(process.env.TEST_PORT) || 3190; // TEST_PORT lets parallel worktrees run the suite side by side
const B = `http://localhost:${PORT}`;
const MUTATE = process.env.MUTATE === "1";
// The app under test gets a per-run admin password (process env beats
// .env.local), so the admin checks never need the real one.
const ADMIN_PW = `itest-admin-${randomUUID()}`;
// Same idea for the birthday cron's bearer secret.
const CRON_PW = `itest-cron-${randomUUID()}`;
const LOG = join(ROOT, "test-results", "integration", "next.log");

let fail = 0;
let total = 0;
const chk = (name, got, want) => {
  const ok = String(got) === String(want);
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name} (got ${got}${ok ? "" : `, want ${want}`})`);
};

// ---------------------------------------------------------------------------
// process plumbing: port check, start/stop `next dev`, readiness
// ---------------------------------------------------------------------------
function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

async function waitFor(cond, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function startNext(apnsPort, env) {
  mkdirSync(join(ROOT, "test-results", "integration"), { recursive: true });
  const log = openSync(LOG, "w");
  // Own process group (detached) so teardown can kill npx + next + its workers
  // together. Process env beats .env.local in Next, so these overrides win.
  return spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      // Pin the exact Supabase that preflight() verified as local, so a
      // SUPABASE_URL exported in the shell can never point the app elsewhere.
      SUPABASE_URL: env.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
      APNS_HOST: `https://127.0.0.1:${apnsPort}`,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      PUBLIC_BASE_URL: B,
      ADMIN_PASSWORD: ADMIN_PW,
      CRON_SECRET: CRON_PW,
    },
  });
}

async function waitReady(next) {
  const ok = await waitFor(async () => {
    if (next.exitCode !== null) throw new Error(`next dev exited early (code ${next.exitCode}), see ${LOG}`);
    try {
      return (await fetch(`${B}/login`, { signal: AbortSignal.timeout(60_000) })).status === 200;
    } catch {
      return false;
    }
  }, 180_000);
  if (!ok) throw new Error(`next dev not ready on ${B} after 180s, see ${LOG}`);
}

async function stopNext(next) {
  if (!next || next.exitCode !== null || next.signalCode) return;
  const kill = (sig) => {
    try {
      process.kill(-next.pid, sig);
    } catch {
      /* group already gone */
    }
  };
  kill("SIGTERM");
  if (!(await waitFor(() => portFree(PORT), 10_000))) {
    kill("SIGKILL");
    await waitFor(() => portFree(PORT), 5_000);
  }
}

// ---------------------------------------------------------------------------
// the checks
// ---------------------------------------------------------------------------
async function checks({ db, run, mock, passTypeId: PTI, tmp }) {
  // A per-run client IP so the shared IP-keyed rate-limit buckets (enroll is 20/min
  // per IP) of other suites hitting the same local Postgres can't flake this run.
  const XFF = `itest-${run}`;
  const jar = () => ({ cookie: "" });
  async function req(path, { method = "GET", body, headers = {}, j } = {}) {
    const h = { "x-forwarded-for": XFF, ...headers };
    if (body !== undefined) h["content-type"] = "application/json";
    if (j?.cookie) h.cookie = j.cookie;
    const r = await fetch(B + path, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual",
    });
    const sc = r.headers.getSetCookie?.() ?? [];
    if (j && sc.length) j.cookie = sc.map((c) => c.split(";")[0]).join("; ");
    return r;
  }
  let n = 0;
  const unzipPass = (buf) => {
    const f = join(tmp, `${n++}.pkpass`);
    writeFileSync(f, buf);
    const list = execFileSync("unzip", ["-Z1", f]).toString().trim().split("\n");
    return { list, pass: JSON.parse(execFileSync("unzip", ["-p", f, "pass.json"]).toString()) };
  };
  const rows = async (q) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const login = (j, s) =>
    req("/api/merchant/login", { method: "POST", body: { username: s.username, password: s.password }, j });
  const redeem = (j, body, key = randomUUID()) =>
    req("/api/merchant/redeem", { method: "POST", body, headers: { "Idempotency-Key": key }, j });
  const balanceOf = async (r) => (await r.json()).newBalance;
  // "<status>:<error>": the reason a request was refused, not just that it was
  const answer = async (r) => `${r.status}:${(await r.json().catch(() => ({}))).error}`;
  const register = (dev, card, pushToken) =>
    req(`/api/v1/devices/${dev}/registrations/${PTI}/${card.serial}`, {
      method: "POST", body: { pushToken }, headers: { Authorization: `ApplePass ${card.authToken}` },
    });
  const updatable = (dev, since) =>
    req(`/api/v1/devices/${dev}/registrations/${PTI}` +
      (since === undefined ? "" : `?passesUpdatedSince=${encodeURIComponent(since)}`));
  const listed = async (r, serial) => r.status === 200 && (await r.json()).serialNumbers.includes(serial);
  const latestPass = async (card) => {
    const r = await req(`/api/v1/passes/${PTI}/${card.serial}`, {
      headers: { Authorization: `ApplePass ${card.authToken}` },
    });
    if (r.status !== 200) throw new Error(`GET latest pass ${card.serial} → ${r.status}`);
    return unzipPass(Buffer.from(await r.arrayBuffer())).pass;
  };
  const field = (pass, area, key) => pass.storeCard?.[area]?.find((f) => f.key === key)?.value;
  const pushesTo = (token) => mock.requests.filter((r) => r.path === `/3/device/${token}`);
  // Settings and admin saves refresh cards in next/server's after(), i.e. once
  // the response is sent: wait (up to 5 s) for the push before counting, and
  // give a save that must push nothing 1 s to prove it.
  const pushedTo = async (token) => {
    for (let i = 0; i < 50 && !pushesTo(token).length; i++) await new Promise((r) => setTimeout(r, 100));
    return pushesTo(token).length;
  };
  const quietFor = async (token) => {
    await new Promise((r) => setTimeout(r, 1000));
    return pushesTo(token).length;
  };

  const cafe = await createMerchant(db, run, { key: "cafe", template: "cafe", earnRate: 10 });
  const rest = await createMerchant(db, run, { key: "rest", template: "restaurant", earnRate: 10 });

  // --- baseline: every check of the original smoke oracle, on fixture merchants
  //     (cafe ≙ seeded corgi, rest ≙ seeded mimis) ---------------------------
  console.log("baseline (ported smoke oracle)");
  chk("GET /login", (await req("/login")).status, 200);
  chk("GET /enroll/<cafe>", (await req(`/enroll/${cafe.slug}`)).status, 200);
  const unknownSlug = await req(`/enroll/t-${run}-nope`);
  chk("GET /enroll/<unknown slug>", unknownSlug.status, 404);
  chk("unknown slug page tells the customer the link isn't active", (await unknownSlug.text()).includes("This sign-up link isn"), true);
  const phone = "+1555" + String(Date.now()).slice(-7);
  chk("enroll: empty form → 400", (await req("/api/enroll", { method: "POST", body: { slug: cafe.slug } })).status, 400);
  chk("enroll: bad phone → 400", (await req("/api/enroll", { method: "POST", body: { name: "x", phone: "12-34", slug: cafe.slug } })).status, 400);
  chk("enroll: bad email → 400", (await req("/api/enroll", { method: "POST", body: { name: "x", phone: "5550100999", email: "nope", slug: cafe.slug } })).status, 400);
  // POST returns a signed card link; GETting it is what serves the .pkpass.
  const er = await req("/api/enroll", { method: "POST", body: { name: "Smoke Test", phone, slug: cafe.slug } });
  chk("enroll status", er.status, 200);
  const { cardUrl = "" } = er.status === 200 ? await er.json() : {};
  chk("enroll returns a card link on PUBLIC_BASE_URL", cardUrl.startsWith(`${B}/api/enroll?card=`), true);
  const card = await req(cardUrl.slice(B.length));
  chk("card link content-type", card.headers.get("content-type"), "application/vnd.apple.pkpass");
  chk("card link filename ends .pkpass", /filename="loyalty-[\w-]+\.pkpass"/.test(card.headers.get("content-disposition") ?? ""), true);
  if (card.status !== 200) throw new Error("enroll failed; later checks need its card");
  const { list, pass } = unzipPass(Buffer.from(await card.arrayBuffer()));
  for (const f of ["pass.json", "manifest.json", "signature", "icon.png"]) chk(`pkpass has ${f}`, list.includes(f), true);
  chk("pass webServiceURL is PUBLIC_BASE_URL/api", pass.webServiceURL, `${B}/api`);
  const serial = pass.serialNumber;
  const at = pass.authenticationToken;
  const smokeCard = { serial, authToken: at };
  chk("duplicate phone enroll", (await req("/api/enroll", { method: "POST", body: { name: "x", phone, slug: cafe.slug } })).status, 409);
  const spaced = phone.replace(/^(\+\d)(\d{3})(\d{3})/, "$1 ($2) $3-");
  chk("duplicate phone, different formatting → 409", (await req("/api/enroll", { method: "POST", body: { name: "x", phone: spaced, slug: cafe.slug } })).status, 409);
  // F1: a US number with or without its country code is one customer.
  const national = phone.slice(2);
  for (const [how, variant] of [["no +1", national], ["leading 1-", `1-${national}`], ["00 1", `001 ${national}`]])
    chk(`duplicate phone, ${how} → 409`, (await req("/api/enroll", { method: "POST", body: { name: "x", phone: variant, slug: cafe.slug } })).status, 409);
  // A card enrolled before "+1…" storage keeps its old 10-digit form; the same
  // number must still be refused. Same last 4 digits as `phone`, other area code.
  const legacyNational = "556" + national.slice(3);
  const oldPhoneCard = await createCard(db, cafe.id, { name: "Legacy Phone", phone: legacyNational });
  chk("legacy 10-digit card, re-enrol as +1 … → 409", (await req("/api/enroll", { method: "POST", body: { name: "x", phone: `+1 ${legacyNational}`, slug: cafe.slug } })).status, 409);
  chk("pass shows the member's name", JSON.stringify(pass.storeCard?.secondaryFields ?? []).includes("Smoke Test"), true);
  chk("balance field carries a changeMessage", (pass.storeCard?.headerFields ?? []).some((f) => /%@/.test(f.changeMessage ?? "")), true);
  const cash = jar();
  chk("cashier login", (await login(cash, cafe.cashier)).status, 200);
  chk("lookup own card", (await req("/api/merchant/lookup", { method: "POST", body: { serial }, j: cash })).status, 200);
  const byPhone = async (typed) =>
    ((await (await req("/api/merchant/lookup", { method: "POST", body: { phone: typed }, j: cash })).json()).matches ?? []).map((m) => m.serial);
  chk("find-by-phone: canonical +1 card by its 10 digits", JSON.stringify(await byPhone(national)), JSON.stringify([serial]));
  chk("find-by-phone: legacy 10-digit card by +1 number", JSON.stringify(await byPhone(`+1 (${legacyNational.slice(0, 3)}) ${legacyNational.slice(3)}`)), JSON.stringify([oldPhoneCard.serial]));
  // gone again, so the cafe's segments (campaign checks below) only hold their own cards
  await rows(db.from("passes").delete().eq("serial", oldPhoneCard.serial));
  const key = randomUUID();
  const r1 = await (await redeem(cash, { serial, amount: 12.5 }, key)).json();
  const r2 = await (await redeem(cash, { serial, amount: 12.5 }, key)).json();
  chk("earn 12.5 @10x", r1.newBalance, 125);
  chk("idempotent replay", `${r2.newBalance}:${r2.replay}`, "125:true");
  chk("insufficient redeem (cafe free_coffee 300)", (await redeem(cash, { serial, actionId: "free_coffee" })).status, 422);
  chk("other template's button rejected (drinks on cafe)", (await redeem(cash, { serial, actionId: "drinks" })).status, 400);
  chk("own template redeem ok (extra_shot 80)", await balanceOf(await redeem(cash, { serial, actionId: "extra_shot" })), 45);
  chk("missing idempotency key", (await req("/api/merchant/redeem", { method: "POST", body: { serial, amount: 1 }, j: cash })).status, 400);
  chk("cashier blocked from owner api", (await req("/api/merchant/customers", { j: cash })).status, 403);
  const other = jar();
  await login(other, rest.cashier);
  chk("cross-merchant lookup", (await req("/api/merchant/lookup", { method: "POST", body: { serial }, j: other })).status, 404);
  chk("cross-merchant redeem", (await redeem(other, { serial, amount: 5 })).status, 404);
  const own = jar();
  await login(own, cafe.owner);
  for (const p of ["/dashboard", "/customers", "/campaigns", "/staff", `/customers/${serial}`])
    chk(`owner GET ${p}`, (await req(p, { j: own })).status, 200);
  chk("unauth GET /dashboard redirects", (await req("/dashboard")).status, 307);
  chk("wallet GET latest pass", (await req(`/api/v1/passes/${PTI}/${serial}`, { headers: { Authorization: `ApplePass ${at}` } })).status, 200);
  chk("wallet bad token", (await req(`/api/v1/passes/${PTI}/${serial}`, { headers: { Authorization: "ApplePass nope" } })).status, 401);
  const dev = `t-${run}-dev-smoke`;
  chk("wallet register device", (await register(dev, smokeCard, "deadbeef")).status, 201);
  chk("wallet re-register", (await register(dev, smokeCard, "deadbeef")).status, 200);
  chk("wallet list updatable", (await updatable(dev)).status, 200);

  // --- Wallet loop: register → earn → exactly one empty APNs push → the device's
  //     passesUpdatedSince poll sees the change once → it re-downloads the pass ---
  console.log("wallet loop");
  const wl = await createCard(db, cafe.id, { name: "Wallet Loop" });
  const devW = `t-${run}-dev-wallet`;
  const tokW = `t-${run}-tok-wallet`;
  chk("register device with a pushToken", (await register(devW, wl, tokW)).status, 201);
  const before = await (await updatable(devW)).json();
  mock.clear();
  chk("earn $10 @10x", await balanceOf(await redeem(cash, { serial: wl.serial, amount: 10 })), 100);
  const pushes = pushesTo(tokW);
  chk("exactly one APNs request for the device", pushes.length, MUTATE ? 0 : 1);
  chk("no other APNs traffic", mock.requests.length, 1);
  chk("push is POST /3/device/<token>", pushes[0]?.method, "POST");
  chk("push apns-topic = PASS_TYPE_ID", pushes[0]?.headers["apns-topic"], PTI);
  chk("push body is empty JSON", pushes[0]?.body, "{}");
  const sinceBefore = await updatable(devW, before.lastUpdated);
  const changed = sinceBefore.status === 200 ? await sinceBefore.json() : {};
  chk("passesUpdatedSince=<tag before> lists the serial", changed.serialNumbers?.includes(wl.serial) ?? false, true);
  chk("passesUpdatedSince=<tag after> lists nothing (204)", (await updatable(devW, changed.lastUpdated)).status, 204);
  // Wallet echoes the tag back verbatim; it must survive being sent unencoded
  // (a '+' would decode to a space and silently break the update loop).
  chk("tag needs no URL encoding", /^[\w.:-]+$/.test(changed.lastUpdated ?? ""), true);
  const rawTag = (t) => req(`/api/v1/devices/${devW}/registrations/${PTI}?passesUpdatedSince=${t}`);
  chk("unencoded tag after lists nothing (204)", (await rawTag(changed.lastUpdated)).status, 204);
  const legacy = new Date(Date.parse(changed.lastUpdated) - 60_000).toISOString().replace("Z", "+00:00");
  chk("legacy '+00:00' tag sent raw still filters (200, not a silent 204)", (await rawTag(legacy)).status, 200);
  chk("re-downloaded pass shows the new balance", field(await latestPass(wl), "primaryFields", "points"), "100");

  // --- 410 pruning: APNs says the token is dead → the device row is deleted ---
  console.log("410 pruning");
  const gc = await createCard(db, cafe.id, { name: "Gone Device" });
  chk("earn $50 @10x (no device yet)", await balanceOf(await redeem(cash, { serial: gc.serial, amount: 50 })), 500);
  const devG = `t-${run}-dev-gone`;
  const tokG = `t-${run}-tok-gone`;
  chk("register device", (await register(devG, gc, tokG)).status, 201);
  mock.gone(tokG);
  mock.clear();
  chk("redeem free_coffee", await balanceOf(await redeem(cash, { serial: gc.serial, actionId: "free_coffee" })), 200);
  chk("APNs answered 410 for the token", pushesTo(tokG).filter((r) => r.status === 410).length, 1);
  chk("device row pruned", (await rows(db.from("devices").select("device_lib_id").eq("device_lib_id", devG))).length, 0);
  chk("its registrations pruned", (await rows(db.from("registrations").select("serial").eq("device_lib_id", devG))).length, 0);

  // --- template scoping: each merchant redeems only its own template's buttons ---
  console.log("template scoping");
  const me = await (await req("/api/merchant/me", { j: cash })).json();
  chk("cafe /me template", me.template, "cafe");
  chk("cafe /me maxBill (schema default)", me.maxBill, 1000);
  chk("cafe /me buttons", me.redemptions?.map((a) => a.id).join(","), "free_coffee,free_pastry,size_upgrade,extra_shot");
  chk("cafe cashier: restaurant 'drinks' → 400", (await redeem(cash, { serial: gc.serial, actionId: "drinks" })).status, 400);
  const rc = await createCard(db, rest.id, { name: "Restaurant Card" });
  chk("restaurant earn $100 @10x", await balanceOf(await redeem(other, { serial: rc.serial, amount: 100 })), 1000);
  chk("restaurant cashier: cafe 'free_coffee' → 400", (await redeem(other, { serial: rc.serial, actionId: "free_coffee" })).status, 400);
  chk("restaurant cashier: own 'drinks' (500)", await balanceOf(await redeem(other, { serial: rc.serial, actionId: "drinks" })), 500);

  // --- campaigns ---------------------------------------------------------------
  // "dormant" = no earn and enrolled over 30 days ago, so these two cards are
  // backdated; a card enrolled today with no earn is "new" (merchant_segments).
  // They are the only dormant ones in the cafe fixture.
  console.log("campaigns");
  const d1 = await createCard(db, cafe.id, { name: "Dormant One" });
  const d2 = await createCard(db, cafe.id, { name: "Dormant Two" });
  const fresh = await createCard(db, cafe.id, { name: "Joined Today" });
  await rows(db.from("passes").update({ created_at: new Date(Date.now() - 60 * 86_400_000).toISOString() })
    .in("serial", [d1.serial, d2.serial]).select("serial"));
  const { data: segs, error: segErr } = await db.rpc("merchant_segments", { p_merchant: cafe.id });
  if (segErr) throw new Error(`merchant_segments: ${segErr.message}`);
  const segOf = (c) => segs.customers.find((x) => x.serial === c.serial)?.segment;
  chk("segments: no earn, enrolled 60 days ago → dormant", `${segOf(d1)},${segOf(d2)}`, "dormant,dormant");
  chk("segments: no earn, enrolled today → new", segOf(fresh), "new");
  const devC = `t-${run}-dev-camp`;
  const tokC = `t-${run}-tok-camp`;
  chk("register device on a dormant card", (await register(devC, d1, tokC)).status, 201);
  const tagC = (await (await updatable(devC)).json()).lastUpdated;
  mock.clear();
  const offer = `Free pastry on your next visit (${run})`;
  const oc = await req("/api/merchant/campaigns", {
    method: "POST", body: { name: "Offer only", segment: "dormant", bonusPoints: 0, offerText: offer }, j: own,
  });
  const ocj = await oc.json();
  chk("offer-only campaign sent", oc.status, 200);
  chk("offer-only campaign targets the 2 dormant cards", ocj.targeted, 2);
  chk("offer-only: card appears in passesUpdatedSince", await listed(await updatable(devC, tagC), d1.serial), true);
  chk("offer-only: one APNs push to the card's device", pushesTo(tokC).length, 1);
  chk("offer-only: re-downloaded pass carries the offer", field(await latestPass(d1), "backFields", "offer"), offer);
  chk("offer-only: no ledger rows", (await rows(db.from("transactions").select("id").eq("reason", `campaign:${ocj.campaignId}`))).length, 0);

  const cid = randomUUID();
  const bonus = { id: cid, name: "Bonus 50", segment: "dormant", bonusPoints: 50 };
  chk("bonus campaign POST", (await req("/api/merchant/campaigns", { method: "POST", body: bonus, j: own })).status, 200);
  chk("same campaign id POSTed again", (await req("/api/merchant/campaigns", { method: "POST", body: bonus, j: own })).status, 200);
  const ledger = await rows(db.from("transactions").select("serial, delta").eq("reason", `campaign:${cid}`));
  const per = {};
  for (const t of ledger) per[t.serial] = (per[t.serial] ?? 0) + t.delta;
  const targets = [d1.serial, d2.serial].sort();
  chk("ledger: one campaign row per targeted card", ledger.length, 2);
  chk("ledger: exactly the targeted cards", Object.keys(per).sort().join(","), targets.join(","));
  chk("ledger: each card credited exactly once (+50)", targets.map((s) => per[s]).join(","), "50,50");
  const cached = await rows(db.from("passes").select("serial, points").in("serial", targets).order("serial"));
  chk("cached balance equals the ledger", cached.map((p) => p.points).join(","), "50,50");

  // --- CRM: "Create" on a customer page makes the tag and attaches it ----------
  console.log("crm tags");
  const ct = await req("/api/merchant/crm", { method: "POST", body: { action: "createTag", serial, label: `vip-${run}` }, j: own });
  const ctj = await ct.json();
  chk("createTag with a serial", ct.status, 200);
  const crm = await (await req(`/api/merchant/crm?serial=${serial}`, { j: own })).json();
  chk("the new tag is attached to that customer", crm.assignedTagIds?.includes(ctj.id), true);
  chk("createTag on another merchant's card → 404",
    (await req("/api/merchant/crm", { method: "POST", body: { action: "createTag", serial: rc.serial, label: `x-${run}` }, j: own })).status, 404);

  // --- staff removal: the owner removes a cashier who is signed in; their
  //     still-valid cookie stops working on the next request ------------------
  console.log("staff removal");
  const gone = { username: `t-${run}-gone`, password: `pw-${run}` };
  chk("owner adds a cashier", (await req("/api/merchant/staff", { method: "POST", body: gone, j: own })).status, 200);
  const goneJar = jar();
  chk("the new cashier signs in", (await login(goneJar, gone)).status, 200);
  chk("their session works", (await req("/api/merchant/me", { j: goneJar })).status, 200);
  const [goneRow] = await rows(db.from("staff").select("id").eq("username", gone.username));
  chk("owner removes them", (await req(`/api/merchant/staff/${goneRow?.id}`, { method: "DELETE", j: own })).status, 200);
  chk("removed cashier's cookie: /api/merchant/me → 401", (await req("/api/merchant/me", { j: goneJar })).status, 401);
  chk("removed cashier's cookie: lookup → 401",
    (await req("/api/merchant/lookup", { method: "POST", body: { serial }, j: goneJar })).status, 401);

  // --- card link (owner re-send) ---------------------------------------------
  console.log("card link");
  chk("GET /api/enroll?card=garbage → 410", (await req("/api/enroll?card=garbage")).status, 410);
  const cl = await req("/api/merchant/card-link", { method: "POST", body: { serial }, j: own });
  chk("owner mints a card link", cl.status, 200);
  const { url = "" } = cl.status === 200 ? await cl.json() : {};
  chk("card link points at PUBLIC_BASE_URL", url.startsWith(`${B}/api/enroll?card=`), true);
  const reissue = await req(url.slice(B.length));
  chk("signed card link re-issues the pass", reissue.status, 200);
  if (reissue.status === 200) {
    const p = unzipPass(Buffer.from(await reissue.arrayBuffer())).pass;
    chk("re-issued pass is the same card", `${p.serialNumber === serial}:${p.authenticationToken === at}`, "true:true");
  }

  // --- bill cap: merchants.max_bill (default 1000) refuses bigger bills (422),
  //     and a bill of half the cap or more needs confirm: true (409 otherwise,
  //     with nothing written) ----------------------------------------------------
  console.log("bill cap");
  const cap = await createMerchant(db, run, { key: "cap", template: "cafe", earnRate: 10 });
  const capCash = jar();
  const capOwn = jar();
  await login(capCash, cap.cashier);
  await login(capOwn, cap.owner);
  const cc = await createCard(db, cap.id, { name: "Cap Card" });
  const ledgerRows = async () => (await rows(db.from("transactions").select("id").eq("serial", cc.serial))).length;
  const setCap = (j, maxBill) => req("/api/merchant/settings", { method: "PATCH", body: { maxBill }, j });
  chk("settings GET maxBill defaults to 1000", (await (await req("/api/merchant/settings", { j: capOwn })).json()).maxBill, 1000);
  chk("bill under half the cap (400) earns without a confirm", await balanceOf(await redeem(capCash, { serial: cc.serial, amount: 400 })), 4000);
  const big = await redeem(capCash, { serial: cc.serial, amount: 600 });
  chk("bill of half the cap or more (600) without confirm → 409", big.status, 409);
  chk("409 carries the points it would credit", (await big.json()).confirm?.points, 6000);
  chk("409 wrote nothing to the ledger", await ledgerRows(), 1);
  chk("same bill with confirm: true earns", await balanceOf(await redeem(capCash, { serial: cc.serial, amount: 600, confirm: true })), 10000);
  chk("bill exactly at the cap (1000, confirmed) earns", await balanceOf(await redeem(capCash, { serial: cc.serial, amount: 1000, confirm: true })), 20000);
  const over = await redeem(capCash, { serial: cc.serial, amount: 1000.01, confirm: true });
  chk("bill over the cap → 422 even when confirmed", over.status, 422);
  chk("422 message names the limit in dollars", /limit of \$1,000\.00 /.test((await over.json()).error ?? ""), true);
  chk("422 wrote nothing to the ledger", await ledgerRows(), 3);
  chk("cashier cannot change the cap", (await setCap(capCash, 5000)).status, 403);
  chk("cap below 10 → 400", (await setCap(capOwn, 9.99)).status, 400);
  chk("cap above 100000 → 400", (await setCap(capOwn, 100001)).status, 400);
  chk("cap as a string → 400", (await setCap(capOwn, "5000")).status, 400);
  const raised = await setCap(capOwn, 2000);
  chk("owner raises the cap to 2000", raised.status === 200 ? (await raised.json()).maxBill : raised.status, 2000);
  chk("1500 (half of 2000 is 1000) still needs a confirm → 409", (await redeem(capCash, { serial: cc.serial, amount: 1500 })).status, 409);
  chk("1500 confirmed now earns", await balanceOf(await redeem(capCash, { serial: cc.serial, amount: 1500, confirm: true })), 35000);
  chk("cap card: cached balance equals the ledger",
    (await rows(db.from("passes").select("points").eq("serial", cc.serial)))[0]?.points, 35000);

  // --- undo: POST /api/merchant/undo reverses one counter tap by its
  //     Idempotency-Key, through apply_points (new row, key "undo:<key>") -------
  console.log("undo");
  const uc = await createCard(db, cafe.id, { name: "Undo Card" });
  const undo = (j, idempotencyKey) =>
    req("/api/merchant/undo", { method: "POST", body: { idempotencyKey }, j });
  const devU = `t-${run}-dev-undo`;
  const tokU = `t-${run}-tok-undo`;
  chk("register device on the undo card", (await register(devU, uc, tokU)).status, 201);
  // "undo:" keys are reserved for reversal rows: a client planting undo:<k>
  // first would make the real undo of <k> look already done.
  chk("client Idempotency-Key 'undo:…' refused on redeem", (await redeem(cash, { serial: uc.serial, amount: 1 }, `undo:${randomUUID()}`)).status, 400);
  // a campaign credits key "<campaign id>:<serial>": planted first, it would
  // make that card's credit a replay
  chk("client key shaped like a campaign's refused on redeem",
    await answer(await redeem(cash, { serial: uc.serial, amount: 1 }, `${randomUUID()}:${uc.serial}`)), "400:Invalid Idempotency-Key");
  const k1 = randomUUID();
  chk("earn $20 @10x", await balanceOf(await redeem(cash, { serial: uc.serial, amount: 20 }, k1)), 200);
  mock.clear();
  const u1 = await undo(cash, k1);
  chk("undo the earn → balance restored", `${u1.status}:${(await u1.json()).newBalance}`, "200:0");
  chk("undo pushes to the card's device like any balance change", pushesTo(tokU).length, 1);
  const u2 = await undo(cash, k1);
  const u2j = await u2.json();
  chk("second undo is a replay, not a second reversal", `${u2.status}:${u2j.newBalance}:${u2j.replay}`, "200:0:true");
  chk("a replayed undo pushes nothing", pushesTo(tokU).length, 1);
  const rev = await rows(db.from("transactions").select("delta, reason, staff_id").eq("serial", uc.serial).eq("idempotency_key", `undo:${k1}`));
  chk("exactly one reversal row: -200 undo:earn:purchase by the cashier",
    rev.map((t) => `${t.delta}:${t.reason}:${t.staff_id === cafe.cashier.id}`).join(","), "-200:undo:earn:purchase:true");

  const cash2 = jar();
  const c2 = { username: `t-${run}-cafe-cashier2`, password: randomUUID() };
  chk("owner adds a second cashier", (await req("/api/merchant/staff", { method: "POST", body: c2, j: own })).status, 200);
  chk("second cashier login", (await login(cash2, c2)).status, 200);
  const k2 = randomUUID();
  chk("earn $30 @10x", await balanceOf(await redeem(cash, { serial: uc.serial, amount: 30 }, k2)), 300);
  chk("another shop's cashier can't see the tap → 404", (await undo(other, k2)).status, 404);
  chk("another cashier of the same shop → 403", (await undo(cash2, k2)).status, 403);
  chk("an unknown key → 404", (await undo(cash, randomUUID())).status, 404);
  chk("no key → 400", (await req("/api/merchant/undo", { method: "POST", body: {}, j: cash })).status, 400);
  chk("logged out → 401", (await req("/api/merchant/undo", { method: "POST", body: { idempotencyKey: k2 } })).status, 401);
  const u3 = await undo(own, k2);
  chk("the owner may undo a cashier's tap", `${u3.status}:${(await u3.json()).newBalance}`, "200:0");

  const k3 = randomUUID();
  const k4 = randomUUID();
  chk("earn $10 @10x", await balanceOf(await redeem(cash, { serial: uc.serial, amount: 10 }, k3)), 100);
  chk("redeem extra_shot (80)", await balanceOf(await redeem(cash, { serial: uc.serial, actionId: "extra_shot" }, k4)), 20);
  const u4 = await undo(cash, k3);
  const u4j = await u4.json();
  chk("undoing an earn whose points were spent → 422", `${u4.status}:${u4j.error}`, "422:Those points were already used");
  chk("that 422 carries the real balance", u4j.balance, 20);
  const u5 = await undo(cash, k4);
  chk("undo the reward → the points come back", `${u5.status}:${(await u5.json()).newBalance}`, "200:100");
  chk("an undo can't itself be undone", (await undo(cash, `undo:${k4}`)).status, 400);

  const k5 = randomUUID();
  chk("earn $5 @10x", await balanceOf(await redeem(cash, { serial: uc.serial, amount: 5 }, k5)), 150);
  // age the tap past the 2-minute window (test-only: the delta is untouched)
  await rows(db.from("transactions").update({ created_at: new Date(Date.now() - 3 * 60_000).toISOString() })
    .eq("merchant_id", cafe.id).eq("idempotency_key", k5).select("id"));
  chk("after 2 minutes → refused (409)", (await undo(cash, k5)).status, 409);
  const k6 = randomUUID();
  chk("owner adjust +10", (await req("/api/merchant/adjust", {
    method: "POST", body: { serial: uc.serial, delta: 10 }, headers: { "Idempotency-Key": k6 }, j: own,
  })).status, 200);
  chk("a manual adjustment isn't a counter tap → 400", (await undo(own, k6)).status, 400);
  const uLedger = await rows(db.from("transactions").select("delta").eq("serial", uc.serial));
  const uCached = (await rows(db.from("passes").select("points").eq("serial", uc.serial)))[0]?.points;
  chk("undo card: ledger sum equals the cached balance",
    `${uLedger.reduce((a, t) => a + t.delta, 0)}=${uCached}`, "160=160");

  // --- stamp cards: a stamps merchant (loyalty_mode) earns +1..+3 stamps per
  //     tap and spends stamp_goal on its one reward; each mode refuses the
  //     other's earn and buttons; the card shows STAMPS "n of goal" + a grid ----
  console.log("stamp cards");
  const st = await createMerchant(db, run, { key: "stamps", template: "cafe", earnRate: 10, stamps: { goal: 5, reward: "Free latte" } });
  const stCash = jar();
  const stOwn = jar();
  await login(stCash, st.cashier);
  await login(stOwn, st.owner);
  const sc = await createCard(db, st.id, { name: "Stamp Card" });
  const stMe = await (await req("/api/merchant/me", { j: stCash })).json();
  chk("stamps /me: mode and goal", `${stMe.mode}:${stMe.stampGoal}`, "stamps:5");
  chk("stamps /me: the one reward button, costing the goal",
    JSON.stringify(stMe.redemptions), JSON.stringify([{ id: "stamp_reward", label: "Free latte", points: -5, kind: "redeem" }]));
  chk("points /me says points", me.mode, "points");
  const devS = `t-${run}-dev-stamps`;
  const tokS = `t-${run}-tok-stamps`;
  chk("register device on the stamp card", (await register(devS, sc, tokS)).status, 201);
  mock.clear();
  const ks = randomUUID();
  chk("+1 stamp", await balanceOf(await redeem(stCash, { serial: sc.serial, stamps: 1 }, ks)), 1);
  chk("a stamp pushes to the card's device", pushesTo(tokS).length, 1);
  const ksr = await (await redeem(stCash, { serial: sc.serial, stamps: 1 }, ks)).json();
  chk("the same tap retried is a replay", `${ksr.newBalance}:${ksr.replay}`, "1:true");
  chk("+3 stamps (several items)", await balanceOf(await redeem(stCash, { serial: sc.serial, stamps: 3 })), 4);
  const below = await redeem(stCash, { serial: sc.serial, actionId: "stamp_reward" });
  const belowJ = await below.json();
  chk("reward below the goal (4 of 5) → 422 with the balance", `${below.status}:${belowJ.error}:${belowJ.balance}`, "422:Not enough stamps:4");
  // each refusal names its reason: a bare 400 would also pass on a route that
  // knows nothing of stamps ("Unknown action")
  const noBill = "400:This shop collects stamps: tap a stamp button, no bill amount";
  const oneToThree = "400:Add 1 to 3 stamps at a time";
  for (const [what, body, want] of [
    ["a bill amount", { amount: 12 }, noBill],
    ["a points template button (free_coffee)", { actionId: "free_coffee" }, "400:Unknown action"],
    ["+4 stamps (over 3 per tap)", { stamps: 4 }, oneToThree],
    ["0 stamps", { stamps: 0 }, oneToThree],
    ["1.5 stamps", { stamps: 1.5 }, oneToThree],
    ["stamps as a string", { stamps: "1" }, oneToThree],
  ])
    chk(`stamp card refuses ${what} → 400`, await answer(await redeem(stCash, { serial: sc.serial, ...body })), want);
  chk("points card refuses stamps → 400", await answer(await redeem(cash, { serial, stamps: 1 })),
    "400:This shop earns points from the bill, not stamps");
  chk("points card refuses the stamp reward → 400", await answer(await redeem(cash, { serial, actionId: "stamp_reward" })), "400:Unknown action");
  chk("+1 stamp reaches the goal", await balanceOf(await redeem(stCash, { serial: sc.serial, stamps: 1 })), 5);
  const kr = randomUUID();
  chk("reward at the goal spends 5", await balanceOf(await redeem(stCash, { serial: sc.serial, actionId: "stamp_reward" }, kr)), 0);
  const ku = randomUUID();
  chk("+2 stamps", await balanceOf(await redeem(stCash, { serial: sc.serial, stamps: 2 }, ku)), 2);
  const us = await undo(stCash, ku);
  chk("a stamp tap can be undone", `${us.status}:${(await us.json()).newBalance}`, "200:0");
  const ur = await undo(stCash, kr);
  chk("the reward can be undone (stamps come back)", `${ur.status}:${(await ur.json()).newBalance}`, "200:5");
  const sLedger = await rows(db.from("transactions").select("delta, reason, amount").eq("serial", sc.serial).order("id"));
  chk("ledger: stamps are units, no bill amounts",
    sLedger.map((t) => `${t.delta}:${t.reason}:${t.amount}`).join(","),
    "1:earn:stamp:null,3:earn:stamp:null,1:earn:stamp:null,-5:redeem:stamp_reward:null,2:earn:stamp:null,-2:undo:earn:stamp:null,5:undo:redeem:stamp_reward:null");
  chk("stamp card: cached balance equals the ledger",
    `${sLedger.reduce((a, t) => a + t.delta, 0)}=${(await rows(db.from("passes").select("points").eq("serial", sc.serial)))[0]?.points}`, "5=5");

  const stampPass = async (card) => {
    const r = await req(`/api/v1/passes/${PTI}/${card.serial}`, { headers: { Authorization: `ApplePass ${card.authToken}` } });
    return { status: r.status, ...unzipPass(Buffer.from(await r.arrayBuffer())) };
  };
  const sp = await stampPass(sc);
  const head = sp.pass.storeCard?.headerFields?.[0] ?? {};
  chk("stamp pass header: STAMPS 5 of 5 with a changeMessage", `${sp.status}:${head.label}:${head.value}:${head.changeMessage}`, "200:STAMPS:5 of 5:Stamps: %@");
  chk("stamp pass: no primary points number", (sp.pass.storeCard?.primaryFields ?? []).length, 0);
  chk("stamp pass: REWARD says it is ready", field(sp.pass, "secondaryFields", "next"), "Ready: Free latte");
  chk("stamp pass carries the drawn strip at 1x/2x/3x",
    ["strip.png", "strip@2x.png", "strip@3x.png"].every((f) => sp.list.includes(f)), true);
  chk("stamp pass back: how to earn in stamps", /1 stamp per visit or item.*Collect 5 for Free latte/.test(field(sp.pass, "backFields", "earn") ?? ""), true);
  chk("points pass keeps its POINTS header", (await latestPass(smokeCard)).storeCard?.headerFields?.[0]?.label, "POINTS");

  // owner Settings: the mode is read-only, the reward can be renamed, and the
  // rename reaches every card in Wallet (passesUpdatedSince + one push)
  const stSet = await (await req("/api/merchant/settings", { j: stOwn })).json();
  chk("settings GET: stamp card, goal, reward", `${stSet.mode}:${stSet.stampGoal}:${stSet.stampReward}`, "stamps:5:Free latte");
  const setReward = (j, stampReward) => req("/api/merchant/settings", { method: "PATCH", body: { stampReward }, j });
  const tagS = (await (await updatable(devS)).json()).lastUpdated;
  mock.clear();
  const renamed = await setReward(stOwn, "  Free flat white  ");
  chk("owner renames the reward (trimmed)", renamed.status === 200 ? (await renamed.json()).stampReward : renamed.status, "Free flat white");
  chk("rename: one push to the card's device", await pushedTo(tokS), 1);
  chk("rename: the card appears in passesUpdatedSince", await listed(await updatable(devS, tagS), sc.serial), true);
  chk("rename: re-downloaded pass shows the new reward", field(await latestPass(sc), "secondaryFields", "next"), "Ready: Free flat white");
  chk("reward name over 30 characters → 400", (await setReward(stOwn, "x".repeat(31))).status, 400);
  chk("blank reward name → 400", (await setReward(stOwn, "   ")).status, 400);
  chk("cashier cannot rename the reward → 403", (await setReward(stCash, "Free tea")).status, 403);
  chk("a points shop has no stamp reward to rename → 400", (await setReward(own, "Free tea")).status, 400);
  // a stamp card's campaign bonus is at most one full card (goal 5)
  chk("stamp card campaign of 6 bonus stamps → 400 naming the cap",
    await answer(await req("/api/merchant/campaigns", { method: "POST", body: { name: "Too many", segment: "new", bonusPoints: 6 }, j: stOwn })),
    "400:A stamp card's bonus is 0 to 5 stamps (one full card)");
  const stCsv = await req("/api/merchant/export?type=customers", { j: stOwn });
  chk("stamp card CSV heads its balance column Stamps",
    (await stCsv.text()).replace(/^\uFEFF/, "").split("\r\n")[0], "Name,Phone,Stamps,Lifetime earned,Lifetime redeemed,Visits,Last seen (UTC)");
  const poster = (await (await req("/settings/poster", { j: stOwn })).text()).replace(/<!-- -->/g, "");
  chk("stamp card poster: earn 1 stamp per item, the reward after the goal",
    ["1 stamp", "per item, added at the counter", "Free flat white", "after 5 stamps"].every((t) => poster.includes(t)), true);

  // --- anomaly rule: detect_anomalies flags a single 1,000,000-point earn by
  //     a shop's only cashier (the old cross-staff z-score needed 6+ staff) and
  //     stays quiet on normal earns ------------------------------------------
  console.log("anomaly rule");
  const an = await createMerchant(db, run, { key: "anom", template: "cafe", earnRate: 10 });
  const anCash = jar();
  const anOwn = jar();
  await login(anCash, an.cashier);
  await login(anOwn, an.owner);
  const ac = await createCard(db, an.id, { name: "Anomaly Card" });
  const anomalies = async () => {
    const { data, error } = await db.rpc("detect_anomalies", { p_merchant: an.id });
    if (error) throw new Error(`detect_anomalies: ${error.message}`);
    return data;
  };
  let normal = 0;
  for (const amount of [8, 12.5, 15, 22, 9.5, 30, 18, 11, 25, 14])
    normal = await balanceOf(await redeem(anCash, { serial: ac.serial, amount }));
  chk("10 normal earns credited", normal, 1650);
  chk("normal earns → no anomaly", JSON.stringify(await anomalies()), "[]");
  chk("owner lifts the cap to 100000", (await setCap(anOwn, 100000)).status, 200);
  chk("cashier earns 1,000,000 points in one confirmed tap",
    await balanceOf(await redeem(anCash, { serial: ac.serial, amount: 100000, confirm: true })), 1001650);
  const flagged = await anomalies();
  chk("exactly one anomaly", flagged.length, 1);
  chk("it is staff_over_issue / warn", `${flagged[0]?.kind}/${flagged[0]?.severity}`, "staff_over_issue/warn");
  chk("it names the cashier and what they issued",
    `${flagged[0]?.detail?.staff}:${flagged[0]?.detail?.issued}`, `${an.cashier.username}:1001650`);

  // --- card void: the owner deactivates a card. Every balance change, the card
  //     link and a link minted earlier refuse it, the Wallet card says so and
  //     the balance stays; reactivating makes all of it work again ---------------
  console.log("card void");
  const restOwn = jar();
  await login(restOwn, rest.owner);
  const vPhone = "+1555" + String(Date.now() + 7).slice(-7);
  const vc = await createCard(db, cafe.id, { name: "Void Card", phone: vPhone });
  const setVoid = (j, body) => req("/api/merchant/void", { method: "POST", body, j });
  const reactivate = (j, s) => req("/api/merchant/void", { method: "DELETE", body: { serial: s }, j });
  const adjust = (j, s, delta) =>
    req("/api/merchant/adjust", { method: "POST", body: { serial: s, delta }, headers: { "Idempotency-Key": randomUUID() }, j });
  const cardLink = (j, s) => req("/api/merchant/card-link", { method: "POST", body: { serial: s }, j });
  const vk = randomUUID();
  chk("earn $10 @10x before the void", await balanceOf(await redeem(cash, { serial: vc.serial, amount: 10 }, vk)), 100);
  const { url: earlyLink = "" } = await (await cardLink(own, vc.serial)).json();
  const devV = `t-${run}-dev-void`;
  const tokV = `t-${run}-tok-void`;
  chk("register device on the card", (await register(devV, vc, tokV)).status, 201);
  chk("a cashier cannot deactivate → 403", (await setVoid(cash, { serial: vc.serial, reason: "fraud" })).status, 403);
  chk("another shop's owner cannot deactivate → 404",
    await answer(await setVoid(restOwn, { serial: vc.serial, reason: "fraud" })), "404:Card not found");
  chk("no reason → 400", (await setVoid(own, { serial: vc.serial })).status, 400);
  chk("unknown reason → 400", (await setVoid(own, { serial: vc.serial, reason: "bored" })).status, 400);
  mock.clear();
  chk("owner deactivates the card", (await setVoid(own, { serial: vc.serial, reason: "fraud" })).status, 200);
  chk("deactivating pushes to the card's device", pushesTo(tokV).length, 1);
  const [vRow] = await rows(db.from("passes").select("points, voided_at, void_reason").eq("serial", vc.serial));
  chk("the row keeps its balance and records when and why", `${vRow?.points}:${Boolean(vRow?.voided_at)}:${vRow?.void_reason}`, "100:true:fraud");
  chk("lookup by serial says deactivated",
    (await (await req("/api/merchant/lookup", { method: "POST", body: { serial: vc.serial }, j: cash })).json()).voided, true);
  chk("lookup by phone says deactivated",
    (await (await req("/api/merchant/lookup", { method: "POST", body: { phone: vPhone }, j: cash })).json()).matches?.[0]?.voided, true);
  chk("earn refused → 409", (await redeem(cash, { serial: vc.serial, amount: 5 })).status, 409);
  chk("reward refused → 409", (await redeem(cash, { serial: vc.serial, actionId: "extra_shot" })).status, 409);
  chk("owner adjustment refused → 409", (await adjust(own, vc.serial, 10)).status, 409);
  chk("undo of the earn made before the void refused → 409", (await undo(cash, vk)).status, 409);
  chk("send-card link refused → 409", (await cardLink(own, vc.serial)).status, 409);
  chk("a card link minted before the void stops working → 410", (await req(earlyLink.slice(B.length))).status, 410);
  // decision: a deactivated card keeps its number, so no second card is made
  const again = await req("/api/enroll", { method: "POST", body: { name: "Again", phone: vPhone, slug: cafe.slug } });
  const [stillVoid] = await rows(db.from("passes").select("voided_at").eq("serial", vc.serial));
  chk("re-enrolling its number → 409 saying the card is paused, and the card stays deactivated",
    `${again.status}:${(await again.json()).error}:${Boolean(stillVoid?.voided_at)}`,
    "409:This number's card is paused — ask the owner to switch it back on.:true");
  const vPass = await latestPass(vc);
  chk("Wallet card says DEACTIVATED once: header, no primary field; the back is STATUS, UPDATED, TERMS",
    `${field(vPass, "headerFields", "balance")}|${(vPass.storeCard?.primaryFields ?? []).length}|${(vPass.storeCard?.backFields ?? []).map((f) => f.key).join(",")}`,
    "DEACTIVATED|0|status,updated,terms");
  chk("its STATUS says the points are kept and who switches it back on", field(vPass, "backFields", "status"),
    `This card is paused. Your points are kept — ask Test cafe ${run} to switch it back on.`);
  // a stamp card, deactivated: the same layout in stamps, and the theme's own
  // strip (byte for byte the cafe theme's, as on a points cafe card) instead of the grid
  const vs = await createCard(db, st.id, { name: "Void Stamps" });
  await redeem(stCash, { serial: vs.serial, stamps: 3 });
  chk("owner deactivates a stamp card", (await setVoid(stOwn, { serial: vs.serial, reason: "other" })).status, 200);
  const stripOf = async (card) => {
    const r = await req(`/api/v1/passes/${PTI}/${card.serial}`, { headers: { Authorization: `ApplePass ${card.authToken}` } });
    const f = join(tmp, `${n++}.pkpass`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    return execFileSync("unzip", ["-p", f, "strip@2x.png"]).toString("base64");
  };
  const vsPass = await latestPass(vs);
  chk("deactivated stamp card: CARD DEACTIVATED, no primary, STATUS in stamps",
    `${field(vsPass, "headerFields", "balance")}|${(vsPass.storeCard?.primaryFields ?? []).length}|${field(vsPass, "backFields", "status")}`,
    `DEACTIVATED|0|This card is paused. Your stamps are kept — ask Test stamps ${run} to switch it back on.`);
  chk("deactivated stamp card: the theme's strip, not the stamp grid", (await stripOf(vs)) === (await stripOf(smokeCard)), true);
  chk("deactivated card has no QR and no change message",
    `${(vPass.barcodes ?? []).length}:${vPass.storeCard?.headerFields?.[0]?.changeMessage ?? "none"}`, "0:none");
  const vLedger = await rows(db.from("transactions").select("delta").eq("serial", vc.serial));
  chk("refusals wrote nothing: one ledger row, +100", vLedger.map((t) => t.delta).join(","), "100");
  chk("another shop's owner cannot reactivate → 404", await answer(await reactivate(restOwn, vc.serial)), "404:Card not found");
  chk("a cashier cannot reactivate → 403", (await reactivate(cash, vc.serial)).status, 403);
  mock.clear();
  chk("owner reactivates the card", (await reactivate(own, vc.serial)).status, 200);
  chk("reactivating pushes to the card's device", pushesTo(tokV).length, 1);
  // one check: on its own each of these also passes on a card never deactivated
  const vk2 = randomUUID();
  const restored = [
    await balanceOf(await redeem(cash, { serial: vc.serial, amount: 5 }, vk2)),
    await balanceOf(await redeem(cash, { serial: vc.serial, actionId: "extra_shot" })),
    await balanceOf(await undo(cash, vk2)),
    await balanceOf(await adjust(own, vc.serial, 10)),
    (await cardLink(own, vc.serial)).status,
  ];
  chk("after reactivating: earn, reward, undo, adjust (balances) and card link work again", restored.join(","), "150,70,20,30,200");
  const rPass = await latestPass(vc);
  chk("re-downloaded card shows the balance, QR and change message again",
    `${field(rPass, "primaryFields", "points")}:${(rPass.barcodes ?? []).length}:${Boolean(rPass.storeCard?.headerFields?.[0]?.changeMessage)}`, "30:1:true");

  // --- review link + lock-screen location (owner Settings): https only; the
  //     back-of-card link appears from the 3rd earn visit; the pass carries the
  //     shop's coordinates; each save pushes the merchant's cards -------------
  console.log("review link + location");
  const rv = await createMerchant(db, run, { key: "rev", template: "cafe", earnRate: 10 });
  const rvOwn = jar();
  const rvCash = jar();
  await login(rvOwn, rv.owner);
  await login(rvCash, rv.cashier);
  const settingsPatch = (j, body) => req("/api/merchant/settings", { method: "PATCH", body, j });
  const notHttps = "400:Enter the full review link, starting with https://";
  chk("review link http:// → 400", await answer(await settingsPatch(rvOwn, { reviewUrl: "http://example.com/review" })), notHttps);
  chk("review link javascript: → 400", await answer(await settingsPatch(rvOwn, { reviewUrl: "javascript:alert(1)" })), notHttps);
  chk("review link over 500 characters → 400",
    await answer(await settingsPatch(rvOwn, { reviewUrl: `https://example.com/${"a".repeat(481)}` })),
    "400:Use a review link of 500 characters or fewer");
  const reg = await createCard(db, rv.id, { name: "Regular" });
  const devR = `t-${run}-dev-review`;
  const tokR = `t-${run}-tok-review`;
  chk("register device on the card", (await register(devR, reg, tokR)).status, 201);
  for (const amount of [4, 6]) await redeem(rvCash, { serial: reg.serial, amount });
  const tagR = (await (await updatable(devR)).json()).lastUpdated;
  mock.clear();
  const reviewUrl = `https://g.page/r/${run}/review?a=1&b=2`;
  const sv = await settingsPatch(rvOwn, { reviewUrl });
  chk("owner saves an https review link", `${sv.status}:${(await sv.json()).reviewUrl}`, `200:${reviewUrl}`);
  chk("saving pushes the merchant's card", await pushedTo(tokR), 1);
  chk("the card appears in passesUpdatedSince", await listed(await updatable(devR, tagR), reg.serial), true);
  const second = field(await latestPass(reg), "backFields", "review");
  await redeem(rvCash, { serial: reg.serial, amount: 5 });
  const third = (await latestPass(reg)).storeCard?.backFields?.find((f) => f.key === "review");
  chk("review field only from the 3rd visit (2 visits | 3 visits)", `${second ?? "none"}|${third?.label}`, `none|Enjoying Test rev ${run}?`);
  chk("its link is the saved URL, HTML-escaped",
    third?.attributedValue, `<a href='https://g.page/r/${run}/review?a=1&#38;b=2'>Leave us a review</a>`);
  const outOfRange = "400:Latitude goes from -90 to 90 and longitude from -180 to 180";
  chk("location that isn't 'lat, lng' → 400", await answer(await settingsPatch(rvOwn, { location: "Main St" })),
    "400:Paste the coordinates as lat, lng, like 37.77493, -122.41942");
  chk("latitude above 90 → 400", await answer(await settingsPatch(rvOwn, { location: "91, 10" })), outOfRange);
  chk("longitude below -180 → 400", await answer(await settingsPatch(rvOwn, { location: "10, -181" })), outOfRange);
  const sl = await settingsPatch(rvOwn, { location: " 37.77493,-122.41942 " });
  chk("owner saves a pasted location", `${sl.status}:${(await sl.json()).location}`, "200:37.77493, -122.41942");
  const loc = (await latestPass(reg)).locations ?? [];
  chk("the pass carries it with relevantText",
    loc.map((l) => `${l.latitude},${l.longitude},${l.relevantText}`).join("|"), `37.77493,-122.41942,Show your Test rev ${run} card`);
  const cleared = (await settingsPatch(rvOwn, { location: "" })).status;
  chk("clearing the location → 200 and the pass has none", `${cleared}:${JSON.stringify((await latestPass(reg)).locations ?? null)}`, "200:null");
  // one card refresh per save, and only when something the card shows changed
  await pushedTo(tokR);
  mock.clear();
  chk("saving the same review link again → 200, no push", `${(await settingsPatch(rvOwn, { reviewUrl })).status}:${await quietFor(tokR)}`, "200:0");
  chk("a bill-limit-only save → 200, no push", `${(await settingsPatch(rvOwn, { maxBill: 500 })).status}:${await quietFor(tokR)}`, "200:0");
  const both = await settingsPatch(rvOwn, { reviewUrl: `${reviewUrl}&c=3`, location: "37.7, -122.4" });
  await pushedTo(tokR);
  chk("a review link and a location in one save → one push", `${both.status}:${await quietFor(tokR)}`, "200:1");

  // --- admin earn rate: the creator admin takes Settings' range (0.1-100) and
  //     refuses a rate the shop's bill limit would turn into earns over the
  //     redeem route's 1,000,000-point cap ---------------------------------------
  console.log("admin earn rate");
  const adm = await createMerchant(db, run, { key: "adm", template: "cafe", earnRate: 10 });
  const admin = jar();
  chk("admin login", (await req("/api/admin/login", { method: "POST", body: { password: ADMIN_PW }, j: admin })).status, 200);
  const setRate = (earnRate) => req(`/api/admin/merchants/${adm.id}`, { method: "PATCH", body: { earnRate }, j: admin });
  const rateNow = async () => Number((await rows(db.from("merchants").select("earn_rate").eq("id", adm.id)))[0]?.earn_rate);
  chk("admin rate above 100 → 400", (await setRate(150)).status, 400);
  chk("admin rate below 0.1 → 400", (await setRate(0.05)).status, 400);
  chk("admin rate 100 at the default 1000 bill limit → 200", (await setRate(100)).status, 200);
  await rows(db.from("merchants").update({ earn_rate: 10, max_bill: 100000 }).eq("id", adm.id).select("id"));
  const pair = await setRate(20);
  chk("admin rate 20 with a 100000 bill limit → 400", pair.status, 400);
  chk("400 names the highest rate that fits (10)", /at most 10\b/.test((await pair.json()).error ?? ""), true);
  chk("refused rate left earn_rate alone", await rateNow(), 10);
  chk("rate 10 x 100000 = exactly 1,000,000 → 200", (await setRate(10)).status, 200);
  const created = await req("/api/admin/merchants", {
    method: "POST", j: admin,
    body: { name: "Too generous", slug: `t-${run}-admnew`, earnRate: 1000 },
  });
  chk("admin create with rate 1000 → 400", created.status, 400);
  chk("400 states the range", /between 0\.1 and 100/.test((await created.json()).error ?? ""), true);

  // --- CSV export: owner-only downloads of the customer list and the ledger,
  //     scoped to the session's shop, formula-safe, paged past 1000 rows ------
  console.log("csv export");
  const csv = async (type, j) => {
    const r = await req(`/api/merchant/export?type=${type}`, { j });
    const buf = Buffer.from(await r.arrayBuffer());
    const lines = buf.toString("utf8").replace(/^\uFEFF/, "").split("\r\n");
    return { r, bom: buf.subarray(0, 3).toString("hex") === "efbbbf", head: lines[0], rows: lines.slice(1, -1) };
  };
  const today = new Date().toISOString().slice(0, 10);
  const shown = `(555) ${phone.slice(5, 8)}-${phone.slice(8)}`;
  await createCard(db, cafe.id, { name: '=HYPERLINK("http://evil.example","click")' });
  const cust = await csv("customers", own);
  chk("owner customers export → 200", cust.r.status, 200);
  chk("content-type is utf-8 CSV", cust.r.headers.get("content-type"), "text/csv; charset=utf-8");
  chk("filename carries the slug and the date",
    cust.r.headers.get("content-disposition"), `attachment; filename="${cafe.slug}-customers-${today}.csv"`);
  chk("file starts with a UTF-8 BOM", cust.bom, true);
  chk("customers header row", cust.head, "Name,Phone,Points,Lifetime earned,Lifetime redeemed,Visits,Last seen (UTC)");
  chk("one row per cafe card",
    cust.rows.length, (await rows(db.from("passes").select("serial").eq("merchant_id", cafe.id))).length);
  chk("own row: phone as shown, 45 pts, 125 earned, 80 redeemed, 1 visit",
    cust.rows.some((l) => l.startsWith(`Smoke Test,${shown},45,125,80,1,20`)), true);
  chk("formula name gets a leading ' and RFC 4180 quoting",
    cust.rows.includes(`"'=HYPERLINK(""http://evil.example"",""click"")",,0,0,0,0,`), true);
  chk("another shop's customer never appears", cust.rows.some((l) => l.includes("Restaurant Card")), false);
  chk("…while that shop's own export lists it",
    (await csv("customers", restOwn)).rows.some((l) => l.startsWith("Restaurant Card,")), true);

  const tx = await csv("transactions", own);
  chk("owner transactions export → 200", tx.r.status, 200);
  chk("transactions filename",
    tx.r.headers.get("content-disposition"), `attachment; filename="${cafe.slug}-transactions-${today}.csv"`);
  chk("transactions header row", tx.head, "Date (UTC),Customer,Phone,Kind,Reason,Points,Bill ($),Staff");
  chk("one row per cafe ledger entry",
    tx.rows.length, (await rows(db.from("transactions").select("id").eq("merchant_id", cafe.id))).length);
  chk("the earn: customer, kind, points, bill, cashier",
    tx.rows.some((l) => l.endsWith(`,Smoke Test,${shown},earn,earn:purchase,125,12.5,${cafe.cashier.username}`)), true);
  chk("the reward: its -80 stays a number",
    tx.rows.some((l) => l.endsWith(`,Smoke Test,${shown},redeem,redeem:extra_shot,-80,,${cafe.cashier.username}`)), true);
  chk("kinds as the ledger records them",
    [...new Set(tx.rows.map((l) => l.split(",")[3]))].sort().join(","), "adjust,campaign,earn,redeem,undo");
  chk("another shop's ledger never appears", tx.rows.some((l) => l.includes("Restaurant Card")), false);
  chk("cashier: customers export → 403", (await req("/api/merchant/export?type=customers", { j: cash })).status, 403);
  chk("cashier: transactions export → 403", (await req("/api/merchant/export?type=transactions", { j: cash })).status, 403);
  chk("logged out → 401", (await req("/api/merchant/export?type=transactions")).status, 401);
  chk("unknown export type → 400", (await req("/api/merchant/export?type=staff", { j: own })).status, 400);

  // PostgREST hands back at most 1000 rows a request: a shop with 1005 cards
  // and 1005 ledger rows must get all of them, each once.
  const bulk = await createMerchant(db, run, { key: "bulk", template: "cafe", earnRate: 10 });
  const bulkOwn = jar();
  await login(bulkOwn, bulk.owner);
  const N = 1005;
  const bulkCards = Array.from({ length: N }, (_, i) => ({
    serial: randomUUID(), merchant_id: bulk.id, customer_name: `Bulk ${i}`, points: 0, auth_token: randomUUID(),
  }));
  await rows(db.from("passes").insert(bulkCards).select("serial"));
  for (let i = 0; i < N; i += 50)
    await Promise.all(Array.from({ length: Math.min(50, N - i) }, () => rows(db.rpc("apply_points", {
      p_serial: bulkCards[0].serial, p_delta: 1, p_reason: "adjust:manual",
      p_staff: bulk.owner.id, p_merchant: bulk.id, p_idempo: randomUUID(),
    }))));
  const bc = await csv("customers", bulkOwn);
  chk(`customers export: all ${N} cards, none twice`, `${bc.rows.length}/${new Set(bc.rows).size}`, `${N}/${N}`);
  const bt = await csv("transactions", bulkOwn);
  chk(`transactions export: all ${N} ledger rows`, bt.rows.length, N);

  // --- today summary: GET /api/merchant/today is the signed-in staff member's
  //     own taps since the local midnight /scan sends (clamped to 36 h back) ---
  console.log("today summary");
  const td = await createMerchant(db, run, { key: "today", template: "cafe", earnRate: 10 });
  const tdCash = jar();
  const tdOwn = jar();
  const tdCash2 = jar();
  await login(tdCash, td.cashier);
  await login(tdOwn, td.owner);
  const tdC2 = { username: `t-${run}-today-cashier2`, password: randomUUID() };
  chk("today: owner adds a second cashier", (await req("/api/merchant/staff", { method: "POST", body: tdC2, j: tdOwn })).status, 200);
  await login(tdCash2, tdC2);
  const tc = await createCard(db, td.id, { name: "Today Card" });
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const todayReq = (j, since = midnight.toISOString()) =>
    req(`/api/merchant/today?since=${encodeURIComponent(since)}`, { j });
  const tally = async (j) => {
    const t = await (await todayReq(j)).json();
    return `${t.customers}/${t.points}/${t.rewards}/${t.undos}`;
  };
  chk("since that isn't a date → 400", (await todayReq(tdCash, "yesterday")).status, 400);
  chk("cashier earns $12 @10x", await balanceOf(await redeem(tdCash, { serial: tc.serial, amount: 12 })), 120);
  chk("their summary counts it (customers/points/rewards/undos)", await tally(tdCash), "1/120/0/0");
  chk("the other cashier's summary does not", await tally(tdCash2), "0/0/0/0");
  const kt = randomUUID();
  chk("cashier redeems extra_shot (80)", await balanceOf(await redeem(tdCash, { serial: tc.serial, actionId: "extra_shot" }, kt)), 40);
  chk("…and undoes it", (await undo(tdCash, kt)).status, 200);
  chk("an undone reward counts only as an undo", await tally(tdCash), "1/120/0/1");
  // the reversal row carries the owner's staff_id, yet it is the cashier's tap that was undone
  const ko = randomUUID();
  chk("cashier earns $5 @10x", await balanceOf(await redeem(tdCash, { serial: tc.serial, amount: 5 }, ko)), 170);
  chk("…and the owner undoes it", (await undo(tdOwn, ko)).status, 200);
  chk("the owner's undo shows in the cashier's numbers", await tally(tdCash), "1/120/0/2");
  const hoursBack = async (since) => Math.round((Date.now() - Date.parse((await (await todayReq(tdCash, since)).json()).since)) / 3_600_000);
  chk("since 3 days back is clamped to 36 h", await hoursBack(new Date(Date.now() - 3 * 86_400_000).toISOString()), 36);
  chk("since tomorrow is clamped to now", await hoursBack(new Date(Date.now() + 86_400_000).toISOString()), 0);

  // --- admin stamp cards: the wizard creates one; mode and goal change only
  //     while the shop has no transactions; the reward name changes any time --
  console.log("admin stamp cards");
  const patchM = (id, body) => req(`/api/admin/merchants/${id}`, { method: "PATCH", body, j: admin });
  const modeOf = async (id) => {
    const [m] = await rows(db.from("merchants").select("loyalty_mode, stamp_goal, stamp_reward").eq("id", id));
    return `${m?.loyalty_mode}:${m?.stamp_goal}:${m?.stamp_reward}`;
  };
  const toPoints = await patchM(st.id, { loyaltyMode: "points" });
  chk("switching a shop with transactions to points → 409", toPoints.status, 409);
  chk("409 says why", /already has \d+ transactions/.test((await toPoints.json()).error ?? ""), true);
  chk("changing its goal → 409", (await patchM(st.id, { stampGoal: 8 })).status, 409);
  chk("sending its unchanged goal is fine → 200", (await patchM(st.id, { stampGoal: 5 })).status, 200);
  chk("renaming its reward is fine → 200", (await patchM(st.id, { stampReward: "Free cortado" })).status, 200);
  chk("…and nothing else moved", await modeOf(st.id), "stamps:5:Free cortado");
  const fresh0 = await createMerchant(db, run, { key: "tostamps", template: "retail", earnRate: 10 });
  chk("a new merchant is points by default", await modeOf(fresh0.id), "points:10:Free coffee");
  chk("goal 21 → 400", (await patchM(fresh0.id, { loyaltyMode: "stamps", stampGoal: 21 })).status, 400);
  chk("goal 2 → 400", (await patchM(fresh0.id, { loyaltyMode: "stamps", stampGoal: 2 })).status, 400);
  chk("unknown mode → 400", (await patchM(fresh0.id, { loyaltyMode: "visits" })).status, 400);
  chk("no transactions yet: switch to stamps with goal 6 → 200",
    (await patchM(fresh0.id, { loyaltyMode: "stamps", stampGoal: 6, stampReward: "Free gift" })).status, 200);
  chk("the row is a 6-stamp card", await modeOf(fresh0.id), "stamps:6:Free gift");
  const wiz = await req("/api/admin/merchants", {
    method: "POST", j: admin,
    body: {
      name: "Stamp Wizard", slug: `t-${run}-stampwiz`, template: "cafe", earnRate: 10,
      bgColor: null, fgColor: null, labelColor: null,
      owner: { username: `t-${run}-stampwiz-owner`, password: randomUUID() },
      loyaltyMode: "stamps", stampGoal: 8, stampReward: "Free bagel",
    },
  });
  chk("wizard creates a stamp card merchant → 201", wiz.status, 201);
  if (wiz.status === 201) chk("…with its goal and reward", await modeOf((await wiz.json()).id), "stamps:8:Free bagel");
  // a 2x happy hour doubles what one bill can credit, so 10 x 100000 no longer fits
  await rows(db.from("merchants").update({ happy_hour: { days: [1], start: "15:00", end: "17:00", multiplier: 2 } }).eq("id", adm.id).select("id"));
  const doubled = await setRate(10);
  chk("admin rate counts the owner's 2× happy hour (10 x 100000 x 2 → 400, at most 5)",
    `${doubled.status}:${/at most 5\b/.test((await doubled.json()).error ?? "")}`, "400:true");

  // --- birthday treat: shop time zone (set in /admin), optional month + day at
  //     enroll, and the daily cron that credits it once per card per year ------
  console.log("birthday treat");
  // The suite is plain JS, so it reads shop clocks with Intl itself.
  const KIRI = "Pacific/Kiritimati"; // UTC+14: a calendar day ahead of the US most of the day
  const LA = "America/Los_Angeles";
  const mmdd = (tz, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, month: "2-digit", day: "2-digit" }).format(d);
  const bd = await createMerchant(db, run, { key: "bday", template: "cafe", earnRate: 10 });
  const off = await createMerchant(db, run, { key: "nobday", template: "cafe", earnRate: 10 });
  // sent with the unchanged name, so a route that ignored timezone would answer 200
  const tzSet = (timezone) =>
    req(`/api/admin/merchants/${bd.id}`, { method: "PATCH", body: { name: `Test bday ${run}`, timezone }, j: admin });
  chk("admin: a time zone Intl doesn't know → 400", (await tzSet("Mars/Olympus")).status, 400);
  const tzOk = await tzSet("pacific/kiritimati");
  chk("admin: time zone saved in Intl's spelling",
    `${tzOk.status}:${(await rows(db.from("merchants").select("timezone").eq("id", bd.id)))[0]?.timezone}`, `200:${KIRI}`);
  const bdOwn = jar();
  const bdCash = jar();
  await login(bdOwn, bd.owner);
  await login(bdCash, bd.cashier);
  chk("owner turns the birthday treat on",
    (await (await req("/api/merchant/settings", { method: "PATCH", body: { birthdayReward: true }, j: bdOwn })).json()).birthdayReward, true);
  const enrol = async (m, birthday) => {
    const phone = "+1556" + String(Math.floor(1e6 + Math.random() * 9e6));
    const r = await req("/api/enroll", { method: "POST", body: { name: "Birthday Test", phone, birthday, slug: m.slug } });
    const [c] = await rows(db.from("passes").select("serial, auth_token, birthday").eq("merchant_id", m.id).eq("customer_phone", phone));
    return { status: r.status, serial: c?.serial, authToken: c?.auth_token, birthday: c?.birthday ?? null };
  };
  const bdToday = mmdd(KIRI);
  const bad = await req("/api/enroll", { method: "POST", body: { name: "x", phone: "+15569990000", birthday: "02-30", slug: bd.slug } });
  chk("enroll: an impossible birthday (02-30) → 400 on the birthday field", `${bad.status}:${Boolean((await bad.json()).fields?.birthday)}`, "400:true");
  const bToday = await enrol(bd, bdToday);
  const bOther = await enrol(bd, mmdd(KIRI, new Date(Date.now() - 86_400_000))); // yesterday on the shop's clock
  const bOff = await enrol(off, mmdd(LA));
  chk("enroll stores month + day on year 2000, and nothing while the treat is off",
    `${bToday.status}:${bToday.birthday}|${bOff.status}:${bOff.birthday}`, `200:2000-${bdToday}|200:null`);
  // the toggle-off shop's card gets a birthday that IS today, so skipping it means something
  await rows(db.from("passes").update({ birthday: `2000-${mmdd(LA)}` }).eq("serial", bOff.serial).select("serial"));
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
  // Only cards at least a month old on the day are credited: these were "made" 40 days ago...
  await rows(db.from("passes").update({ created_at: daysAgo(40).toISOString() })
    .in("serial", [bToday.serial, bOther.serial, bOff.serial]).select("serial"));
  // ...this one 5 days ago, birthday today (joined for the treat: skipped), and
  // this one is old but its birthday was 3 days ago (outside the 2-day catch-up)
  const bNew = await createCard(db, bd.id, { name: "Birthday New" });
  await rows(db.from("passes").update({ birthday: `2000-${bdToday}`, created_at: daysAgo(5).toISOString() }).eq("serial", bNew.serial).select("serial"));
  const bOld = await createCard(db, bd.id, { name: "Birthday Gone" });
  await rows(db.from("passes").update({ birthday: `2000-${mmdd(KIRI, daysAgo(3))}`, created_at: daysAgo(40).toISOString() }).eq("serial", bOld.serial).select("serial"));
  const yearOf = (d) => new Intl.DateTimeFormat("en-US", { timeZone: KIRI, year: "numeric" }).format(d);
  const year = yearOf(new Date());
  const planted = `birthday:${year}:${bOther.serial}`;
  chk("the cron's key prefix is refused from clients (redeem, adjust)", [
    (await redeem(bdCash, { serial: bOther.serial, amount: 1 }, planted)).status,
    (await req("/api/merchant/adjust", { method: "POST", body: { serial: bOther.serial, delta: 5 }, headers: { "Idempotency-Key": planted }, j: bdOwn })).status,
  ].join(","), "400,400");
  const cron = (auth) => req("/api/cron/birthday", { headers: auth ? { Authorization: auth } : {} });
  chk("cron: no secret, a wrong one, or no Bearer → 401",
    [(await cron()).status, (await cron("Bearer nope")).status, (await cron(CRON_PW)).status].join(","), "401,401,401");
  const devB = `t-${run}-dev-bday`;
  const tokB = `t-${run}-tok-bday`;
  chk("register device on the birthday card", (await register(devB, bToday, tokB)).status, 201);
  // a stamp card shop's treat is one full card (its goal, 5), on its own (LA) clock
  await rows(db.from("merchants").update({ birthday_reward: true }).eq("id", st.id).select("id"));
  const bStamp = await createCard(db, st.id, { name: "Stamp Birthday" });
  await rows(db.from("passes").update({ birthday: `2000-${mmdd(LA)}`, created_at: daysAgo(40).toISOString() }).eq("serial", bStamp.serial).select("serial"));
  mock.clear();
  const run1 = await cron(`Bearer ${CRON_PW}`);
  const run2 = await cron(`Bearer ${CRON_PW}`);
  chk("cron runs twice the same day", `${run1.status},${run2.status}`, "200,200");
  const bLedger = await rows(db.from("transactions").select("serial, delta, staff_id, idempotency_key")
    .eq("reason", "bonus:birthday").in("serial", [bToday.serial, bOther.serial, bOff.serial, bNew.serial, bOld.serial]));
  const bName = { [bToday.serial]: "today", [bOther.serial]: "yesterday", [bOff.serial]: "off", [bNew.serial]: "new", [bOld.serial]: "3 days ago" };
  const bKey = { [bToday.serial]: `birthday:${year}:${bToday.serial}`, [bOther.serial]: `birthday:${yearOf(daysAgo(1))}:${bOther.serial}` };
  chk("one credit each across both runs, to today's and yesterday's birthday on the shop's clock (+80 = cafe's cheapest reward, no staff, key birthday:<year>:<serial>); the 5-day-old card, the 3-days-ago birthday and the toggle-off shop get nothing",
    bLedger.map((t) => `${bName[t.serial]}:${t.delta}:${t.staff_id}:${t.idempotency_key === bKey[t.serial]}`).sort().join(","),
    "today:80:null:true,yesterday:80:null:true");
  chk("birthday card: cached balance equals the ledger", (await rows(db.from("passes").select("points").eq("serial", bToday.serial)))[0]?.points, 80);
  chk("the credit pushed the card once; the replay pushed nothing", pushesTo(tokB).length, 1);
  const onDay = new Date(`2000-${bdToday}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  chk("card back: BIRTHDAY line", field(await latestPass(bToday), "backFields", "birthday"),
    `${onDay}: 80 bonus points, enough for Extra Shot (once your card is a month old)`);
  const bsLedger = await rows(db.from("transactions").select("delta").eq("reason", "bonus:birthday").eq("serial", bStamp.serial));
  const onLa = new Date(`2000-${mmdd(LA)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  chk("stamp card: the birthday credits one full card (5 stamps), and the back says so in stamps",
    `${bsLedger.map((t) => t.delta).join(",")}|${field(await latestPass(bStamp), "backFields", "birthday")}`,
    `5|${onLa}: 5 bonus stamps, enough for Free flat white (once your card is a month old)`);

  // --- happy hour: a weekly window on the shop's clock multiplies bill earns
  //     at the counter; the ledger keeps earn:purchase and the raw bill ---------
  console.log("happy hour");
  const hm = await createMerchant(db, run, { key: "hh", template: "cafe", earnRate: 10 });
  const hmOwn = jar();
  const hmCash = jar();
  await login(hmOwn, hm.owner);
  await login(hmCash, hm.cashier);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // "now" in the merchant's (default) time zone. A run that crosses local
  // midnight or sits in 23:59 can fail these; rerun.
  const wd = DAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: LA, weekday: "short" }).format(new Date()));
  const allDay = (days) => ({ days, start: "00:00", end: "23:59", multiplier: 2 });
  const setHh = (happyHour, extra = {}) => req("/api/merchant/settings", { method: "PATCH", body: { ...extra, happyHour }, j: hmOwn });
  const hc = await createCard(db, hm.id, { name: "Happy Card" });
  const devH = `t-${run}-dev-hh`;
  const tokH = `t-${run}-tok-hh`;
  chk("register device on the happy-hour card", (await register(devH, hc, tokH)).status, 201);
  // sent with a valid bill limit, so a route that ignored happyHour would save (200)
  const invalid = [{ ...allDay([7]) }, { ...allDay([wd]), start: "17:00", end: "15:00" }, { ...allDay([wd]), multiplier: 4 },
    { ...allDay([wd]), extra: 1 }, { ...allDay([]) }, "2x", { ...allDay([wd]), end: "5pm" }];
  const invalidStatus = [];
  for (const w of invalid) invalidStatus.push((await setHh(w, { maxBill: 1000 })).status);
  chk("malformed happy-hour windows → 400", invalidStatus.join(","), invalid.map(() => 400).join(","));
  mock.clear();
  const on = await setHh(allDay([wd]));
  chk("owner saves a 2× window covering now", `${on.status}:${JSON.stringify((await on.json()).happyHour)}`, `200:${JSON.stringify(allDay([wd]))}`);
  chk("the settings change pushed the card", await pushedTo(tokH), 1);
  chk("/me tells /scan happy hour is on", (await (await req("/api/merchant/me", { j: hmCash })).json()).happyHour, 2);
  const inWin = await (await redeem(hmCash, { serial: hc.serial, amount: 10 })).json();
  const bigIn = await (await redeem(hmCash, { serial: hc.serial, amount: 600 })).json();
  chk("card back: HAPPY HOUR line", field(await latestPass(hc), "backFields", "happyhour"), `2× points ${DAYS[wd]} 12 am–11:59 pm`);
  chk("window moved off today", (await setHh(allDay([0, 1, 2, 3, 4, 5, 6].filter((d) => d !== wd)))).status, 200);
  const outWin = await (await redeem(hmCash, { serial: hc.serial, amount: 10 })).json();
  chk("$10 @10x: doubled inside the window, normal outside (points:happyHour)",
    `${inWin.points}:${inWin.happyHour}|${outWin.points}:${outWin.happyHour}`, "200:2|100:null");
  chk("big-bill confirm shows the multiplied points", `${bigIn.confirm?.points}:${bigIn.happyHour}`, "12000:2");
  const hLedger = await rows(db.from("transactions").select("reason, amount, delta").eq("serial", hc.serial).order("id"));
  chk("ledger keeps reason earn:purchase and the raw bill",
    hLedger.map((t) => `${t.reason}:${Number(t.amount)}:${t.delta}`).join(","), "earn:purchase:10:200,earn:purchase:10:100");
  chk("happy-hour card: cached balance equals the ledger", (await rows(db.from("passes").select("points").eq("serial", hc.serial)))[0]?.points, 300);
  chk("happy hour off", `${(await setHh(null)).status}:${(await (await req("/api/merchant/me", { j: hmCash })).json()).happyHour}`, "200:null");
  // happy hour is a points-card booster: a stamp card refuses a window, and even
  // a stored one (say, from before a switch to stamps) never touches a stamp
  chk("a stamp card refuses a happy-hour window → 400 saying why",
    await answer(await req("/api/merchant/settings", { method: "PATCH", body: { happyHour: allDay([wd]) }, j: stOwn })),
    "400:Happy hour is for points cards: a stamp card adds one stamp per item");
  await rows(db.from("merchants").update({ happy_hour: allDay([wd]) }).eq("id", st.id).select("id"));
  const stTap = await (await redeem(stCash, { serial: sc.serial, stamps: 1 })).json();
  chk("…and a stored window never multiplies a stamp (tap points:happyHour | /me | card back)",
    `${stTap.points}:${stTap.happyHour}|${(await (await req("/api/merchant/me", { j: stCash })).json()).happyHour}|${field(await latestPass(sc), "backFields", "happyhour") ?? "none"}`,
    "1:null|null|none");
  await rows(db.from("merchants").update({ happy_hour: null }).eq("id", st.id).select("id"));
  chk("bill limit 100000 at 10 pts/$1", (await setCap(hmOwn, 100000)).status, 200);
  const tooRich = await setHh(allDay([wd]));
  chk("the 1,000,000 cap counts the multiplier (2× at 10 x 100000 → 400 naming 50000)",
    `${tooRich.status}:${/happy hour, the bill limit can be at most 50000\b/.test((await tooRich.json()).error ?? "")}`, "400:true");

  const admPatch = (body) => req(`/api/admin/merchants/${adm.id}`, { method: "PATCH", body, j: admin });
  chk("admin review link javascript: → 400", await answer(await admPatch({ reviewUrl: "javascript:alert(1)" })), notHttps);
  chk("admin review link http:// → 400", await answer(await admPatch({ reviewUrl: "http://example.com/r" })), notHttps);
  chk("admin location out of range → 400", await answer(await admPatch({ location: "40.7, 200" })), outOfRange);
  chk("admin saves a review link and a location", (await admPatch({ reviewUrl: "https://example.com/r", location: "40.7128, -74.006" })).status, 200);
  const [admRow] = await rows(db.from("merchants").select("review_url, latitude, longitude").eq("id", adm.id));
  chk("stored as given", `${admRow?.review_url}|${admRow?.latitude}|${admRow?.longitude}`, "https://example.com/r|40.7128|-74.006");
  // an admin save refreshes the shop's cards only when they change (rv's card is registered as tokR)
  const rvPatch = (body) => req(`/api/admin/merchants/${rv.id}`, { method: "PATCH", body, j: admin });
  mock.clear();
  chk("admin time-zone-only save → 200, no push", `${(await rvPatch({ timezone: "America/Chicago" })).status}:${await quietFor(tokR)}`, "200:0");
  const renamedRv = await rvPatch({ name: `Test rev ${run} 2` });
  await pushedTo(tokR);
  chk("admin rename → 200, one push", `${renamedRv.status}:${await quietFor(tokR)}`, "200:1");
}

// ---------------------------------------------------------------------------
async function main() {
  let env;
  try {
    env = loadEnv();
    await preflight(env);
  } catch (e) {
    console.error(`precondition: ${e.message}`);
    return 2;
  }
  if (!(await portFree(PORT))) {
    console.error(`precondition: port ${PORT} is in use — stop whatever is listening on it.`);
    return 2;
  }
  if (MUTATE) console.log("MUTATE=1 — one expectation is flipped; this run MUST fail.");

  const db = adminClient(env);
  // The global admin-login bucket (20 tries / 10 min) is shared by every run on
  // this local database, so parallel suites ran it dry (429). preflight() has
  // refused anything but a local Supabase, so start each run with a fresh one.
  await db.from("rate_limits").delete().like("bucket", "admin-login%");
  const run = newRunId();
  const tmp = mkdtempSync(join(tmpdir(), "itest-"));
  let mock;
  let next;
  let done = false;
  const teardown = async () => {
    if (done) return;
    done = true;
    await stopNext(next);
    await mock?.close();
    rmSync(tmp, { recursive: true, force: true });
    for (const e of await cleanup(db, run)) {
      fail++;
      console.log(`  FAIL cleanup ${e}`);
    }
  };
  for (const sig of ["SIGINT", "SIGTERM"])
    process.once(sig, () => teardown().finally(() => process.exit(130)));

  console.log(`run ${run} — app ${B}`);
  try {
    mock = await startMockApns();
    next = startNext(mock.port, env);
    await waitReady(next);
    await checks({ db, run, mock, passTypeId: env.passTypeId, tmp });
  } catch (e) {
    fail++;
    console.log(`  FAIL harness: ${e instanceof Error ? e.message : e}`);
  } finally {
    await teardown();
  }
  if (!(await portFree(PORT))) {
    fail++;
    console.log(`  FAIL teardown: port ${PORT} still in use after stopping next dev`);
  }
  if (fail) console.log(`next dev log: ${LOG}`);
  console.log(fail ? `INTEGRATION FAIL (${fail} of ${total} checks)` : `INTEGRATION PASS (${total} checks)`);
  return fail ? 1 : 0;
}

process.exit(await main());
