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

  const cafe = await createMerchant(db, run, { key: "cafe", template: "cafe", earnRate: 10 });
  const rest = await createMerchant(db, run, { key: "rest", template: "restaurant", earnRate: 10 });

  // --- baseline: every check of the original smoke oracle, on fixture merchants
  //     (cafe ≙ seeded corgi, rest ≙ seeded mimis) ---------------------------
  console.log("baseline (ported smoke oracle)");
  chk("GET /login", (await req("/login")).status, 200);
  chk("GET /enroll/<cafe>", (await req(`/enroll/${cafe.slug}`)).status, 200);
  chk("GET /enroll/<unknown slug>", (await req(`/enroll/t-${run}-nope`)).status, 404);
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
  chk("pass shows the member's name", JSON.stringify(pass.storeCard?.secondaryFields ?? []).includes("Smoke Test"), true);
  chk("balance field carries a changeMessage", (pass.storeCard?.headerFields ?? []).some((f) => /%@/.test(f.changeMessage ?? "")), true);
  const cash = jar();
  chk("cashier login", (await login(cash, cafe.cashier)).status, 200);
  chk("lookup own card", (await req("/api/merchant/lookup", { method: "POST", body: { serial }, j: cash })).status, 200);
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
  chk("cafe /me buttons", me.redemptions?.map((a) => a.id).join(","), "free_coffee,free_pastry,size_upgrade,extra_shot");
  chk("cafe cashier: restaurant 'drinks' → 400", (await redeem(cash, { serial: gc.serial, actionId: "drinks" })).status, 400);
  const rc = await createCard(db, rest.id, { name: "Restaurant Card" });
  chk("restaurant earn $100 @10x", await balanceOf(await redeem(other, { serial: rc.serial, amount: 100 })), 1000);
  chk("restaurant cashier: cafe 'free_coffee' → 400", (await redeem(other, { serial: rc.serial, actionId: "free_coffee" })).status, 400);
  chk("restaurant cashier: own 'drinks' (500)", await balanceOf(await redeem(other, { serial: rc.serial, actionId: "drinks" })), 500);

  // --- campaigns ---------------------------------------------------------------
  // Fresh cards with no earn are the only "dormant" ones in the cafe fixture.
  console.log("campaigns");
  const d1 = await createCard(db, cafe.id, { name: "Dormant One" });
  const d2 = await createCard(db, cafe.id, { name: "Dormant Two" });
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
