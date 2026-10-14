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
  chk("another shop's owner cannot deactivate → 404", (await setVoid(restOwn, { serial: vc.serial, reason: "fraud" })).status, 404);
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
  chk("re-enrolling the same number is still refused (decision: the card holds it) → 409",
    (await req("/api/enroll", { method: "POST", body: { name: "Again", phone: vPhone, slug: cafe.slug } })).status, 409);
  const vPass = await latestPass(vc);
  chk("Wallet card reads DEACTIVATED (header | primary)",
    `${field(vPass, "headerFields", "balance")}|${field(vPass, "primaryFields", "points")}`, "DEACTIVATED|Deactivated");
  chk("deactivated card has no QR and no change message",
    `${(vPass.barcodes ?? []).length}:${vPass.storeCard?.headerFields?.[0]?.changeMessage ?? "none"}`, "0:none");
  const vLedger = await rows(db.from("transactions").select("delta").eq("serial", vc.serial));
  chk("refusals wrote nothing: one ledger row, +100", vLedger.map((t) => t.delta).join(","), "100");
  chk("another shop's owner cannot reactivate → 404", (await reactivate(restOwn, vc.serial)).status, 404);
  chk("a cashier cannot reactivate → 403", (await reactivate(cash, vc.serial)).status, 403);
  mock.clear();
  chk("owner reactivates the card", (await reactivate(own, vc.serial)).status, 200);
  chk("reactivating pushes to the card's device", pushesTo(tokV).length, 1);
  const vk2 = randomUUID();
  chk("after reactivating: earn works", await balanceOf(await redeem(cash, { serial: vc.serial, amount: 5 }, vk2)), 150);
  chk("after reactivating: reward works", await balanceOf(await redeem(cash, { serial: vc.serial, actionId: "extra_shot" })), 70);
  chk("after reactivating: undo works", `${(await undo(cash, vk2)).status}`, "200");
  chk("after reactivating: adjustment works", (await adjust(own, vc.serial, 10)).status, 200);
  chk("after reactivating: card link works", (await cardLink(own, vc.serial)).status, 200);
  const rPass = await latestPass(vc);
  chk("re-downloaded card shows the balance, QR and change message again",
    `${field(rPass, "primaryFields", "points")}:${(rPass.barcodes ?? []).length}:${Boolean(rPass.storeCard?.headerFields?.[0]?.changeMessage)}`, "30:1:true");

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
