// Playwright global setup: own fixtures, never the seeded merchants. One café
// merchant (cafe template, earn_rate 10 — same shape as seeded corgi) with an
// owner and a cashier, one card per project for the /scan journey (projects run
// in parallel, so each gets its own balance), and one card for /customers search.
// The returned function is the global teardown.
import { loadEnv, preflight, adminClient, createMerchant, createCard, cleanup } from "../fixtures.mjs";

export default async function globalSetup(config) {
  const env = loadEnv();
  await preflight(env);
  const db = adminClient(env);
  const run = process.env.E2E_RUN;
  // Same as the integration runner: the global admin-login bucket is shared by
  // every run on this (preflighted, local) database, so start with a fresh one.
  await db.from("rate_limits").delete().like("bucket", "admin-login%");

  try {
    const m = await createMerchant(db, run, { key: "e2e", template: "cafe", earnRate: 10 });
    const scanCards = {};
    // The deactivate journey gets a shop (and owner) per project: the shared
    // owner already logs in 10 times a run, the login limit per minute.
    const voidCards = {};
    for (const p of config.projects) {
      scanCards[p.name] = await createCard(db, m.id, { name: `Scan ${p.name}` });
      const v = await createMerchant(db, run, { key: `void-${p.name}`, template: "cafe", earnRate: 10 });
      voidCards[p.name] = { owner: v.owner, card: await createCard(db, v.id, { name: `Void ${p.name}` }) };
    }
    // The happy-hour journey switches a merchant's happy hour on, which would
    // double the points the /scan journey above asserts, so it gets its own
    // merchant (and card) per project.
    const happy = {};
    for (const p of config.projects) {
      const h = await createMerchant(db, run, { key: `hh-${p.name}`, template: "cafe", earnRate: 10 });
      happy[p.name] = { owner: h.owner, cashier: h.cashier, card: await createCard(db, h.id, { name: `Happy ${p.name}` }) };
    }
    const searchCard = await createCard(db, m.id, {
      name: `Findable ${run}`,
      phone: "+1555" + String(Date.now()).slice(-7),
    });
    // A stamp card shop (goal 5) with its own card per project, for stamps.spec.
    const st = await createMerchant(db, run, { key: "e2e-stamps", template: "cafe", earnRate: 10, stamps: { goal: 5, reward: "Free latte" } });
    const stampCards = {};
    for (const p of config.projects)
      stampCards[p.name] = await createCard(db, st.id, { name: `Stamps ${p.name}` });
    // Workers are started after global setup and inherit process.env.
    process.env.E2E_FIXTURE = JSON.stringify({
      run, merchantId: m.id, slug: m.slug, owner: m.owner, cashier: m.cashier, scanCards, voidCards, searchCard, happy,
      stamps: { cashier: st.cashier, cards: stampCards },
    });

    // Compile every route the specs touch, one at a time, before the parallel
    // workers start. `next dev` compiling several routes at once can fail a
    // render with webpack's "reading 'call'" (a dev-only race: the page 500s
    // once, then auto-reloads). GETs only: no writes, no rate-limit buckets.
    const base = config.projects[0].use.baseURL;
    for (const p of [
      "/login", `/enroll/${m.slug}`, "/scan", "/dashboard", "/customers", `/customers/${searchCard.serial}`,
      "/api/merchant/login", "/api/enroll", "/api/merchant/me", "/api/merchant/lookup",
      "/api/merchant/redeem", "/api/merchant/undo", "/api/merchant/today", "/api/merchant/customers", "/api/merchant/void",
      "/staff", "/api/merchant/staff", "/api/merchant/staff/warm-up", "/api/merchant/crm",
      "/settings", "/api/merchant/settings", "/settings/poster",
      "/admin/login", "/api/admin/login", `/admin/merchants/${m.id}`, `/api/admin/merchants/${m.id}/manage`,
    ])
      await fetch(base + p, { redirect: "manual" });
  } catch (e) {
    await cleanup(db, run);
    throw e;
  }

  return async () => {
    const errors = await cleanup(db, run);
    if (errors.length) throw new Error(`e2e fixture cleanup failed: ${errors.join("; ")}`);
  };
}
