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

  try {
    const m = await createMerchant(db, run, { key: "e2e", template: "cafe", earnRate: 10 });
    const scanCards = {};
    const voidCards = {};
    for (const p of config.projects) {
      scanCards[p.name] = await createCard(db, m.id, { name: `Scan ${p.name}` });
      voidCards[p.name] = await createCard(db, m.id, { name: `Void ${p.name}` });
    }
    const searchCard = await createCard(db, m.id, {
      name: `Findable ${run}`,
      phone: "+1555" + String(Date.now()).slice(-7),
    });
    // Workers are started after global setup and inherit process.env.
    process.env.E2E_FIXTURE = JSON.stringify({
      run, slug: m.slug, owner: m.owner, cashier: m.cashier, scanCards, voidCards, searchCard,
    });

    // Compile every route the specs touch, one at a time, before the parallel
    // workers start. `next dev` compiling several routes at once can fail a
    // render with webpack's "reading 'call'" (a dev-only race: the page 500s
    // once, then auto-reloads). GETs only: no writes, no rate-limit buckets.
    const base = config.projects[0].use.baseURL;
    for (const p of [
      "/login", `/enroll/${m.slug}`, "/scan", "/dashboard", "/customers", `/customers/${searchCard.serial}`,
      "/api/merchant/login", "/api/enroll", "/api/merchant/me", "/api/merchant/lookup",
      "/api/merchant/redeem", "/api/merchant/undo", "/api/merchant/customers", "/api/merchant/void",
      "/staff", "/api/merchant/staff", "/api/merchant/staff/warm-up", "/api/merchant/crm",
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
