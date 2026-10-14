# Tests

Three suites, all against real code and the real local database. The only mock
is Apple's push service.

| Command | What runs | Port |
|---|---|---|
| `npm test` | unit tests, `src/**/*.test.ts` (node:test + tsx) | none |
| `npm run test:integration` | `tests/integration/run.mjs`: HTTP checks against a real `next dev` + local Supabase + mock APNs | 3190 |
| `npm run test:e2e` | Playwright, `tests/e2e/*.spec.ts`, desktop Chromium 1280x800 + iPhone 13 emulation | 3191 |
| `npm run test:all` | all three, in that order, stopping at the first failing suite | 3190, 3191 |

## Prerequisites

1. **Local Supabase running**: `supabase start` (API on `http://127.0.0.1:54321`).
2. **Schema applied**: `supabase/schema.sql` run against the local DB, then reload
   PostgREST's schema cache:
   ```sh
   docker exec -i supabase_db_loyalty-card psql -U postgres -d postgres < supabase/schema.sql
   docker exec -i supabase_db_loyalty-card psql -U postgres -d postgres -c "notify pgrst, 'reload schema'"
   ```
3. **`.env.local` at the repo root** with the **local** Supabase URL and
   service-role key (`supabase status` prints them), `SESSION_SECRET`,
   `PASS_TYPE_ID`, `APPLE_TEAM_ID`, and a pass-signing chain (`APPLE_WWDR_PEM`,
   `PASS_SIGNER_CERT_PEM`, `PASS_SIGNER_KEY_PEM`; self-signed test certs work, since
   nothing here is installed on a real device). `APNS_HOST` is overridden by both suites.
4. `npm ci` (Playwright 1.56.1 and its Chromium: `npx playwright install chromium`
   if it's missing). `unzip` and `openssl` on PATH (stock macOS has both).
5. Ports **3190** and **3191** free (override with `TEST_PORT=… npm run test:integration` and `E2E_PORT=… npm run test:e2e` to run several worktrees side by side). Each suite starts its own `next dev` and
   refuses to run if its port is taken.

**Safety:** both suites create and delete rows, so `tests/fixtures.mjs` refuses to
run unless `SUPABASE_URL` is a loopback address. It sends no request at all to a
non-local URL. No push can leave the machine either: integration points
`APNS_HOST` at its mock, e2e points it at a closed local port.

Don't run the two suites at the same time in the same checkout: both `next dev`
servers would share `.next/`.

## Fixtures: own, never seeded

Neither suite reads or writes the seeded merchants (corgi / mimis / northside).
Every run creates its own rows through the service-role key, tagged with a unique
run id (slug and username prefix `t-<run>-`, device ids `t-<run>-…`), and deletes
them at the end, including the rate-limit buckets it touched.

- **integration**: a `cafe` merchant (cafe template, earn_rate 10, the same shape as
  corgi) and a `rest` merchant (restaurant template, the same shape as mimis), each
  with an owner and a cashier (bcrypt-hashed random passwords), plus the cards each
  check needs.
- **e2e** (`tests/e2e/global-setup.mjs`): one cafe merchant with an owner and a
  cashier, one card per Playwright project for the /scan journey (the projects run
  in parallel, so each has its own balance), and one card for /customers search.
  Fixture data reaches the specs through `process.env.E2E_FIXTURE`.

Cards are created with a zero balance. Points only ever arrive through the app
(`apply_points`), so the ledger stays the source of truth in every test.

If a run is killed with `kill -9`, its rows stay behind. They are all prefixed
`t-`, so you can delete them by hand: transactions, then passes, then merchants
(`transactions.merchant_id` has no cascade).

## Integration suite

`npm run test:integration` prints one line per check and a summary:

```
wallet loop
  ok   exactly one APNs request for the device (got 1)
  FAIL push apns-topic = PASS_TYPE_ID (got undefined, want pass.com.42nights.loyalty)
...
INTEGRATION FAIL (1 of 72 checks)
```

Exit codes: **0** all checks ok · **1** at least one FAIL (including a failed
cleanup or a port still held after teardown) · **2** a precondition is missing
(no `.env.local`, Supabase not reachable or not local, port 3190 busy).

What it covers:
- **baseline**: every check of the original smoke oracle (enroll and .pkpass
  contents, duplicate phone, login, lookup, earn, idempotent replay, insufficient
  points, template-scoped redeem, missing Idempotency-Key, owner-only APIs,
  cross-merchant isolation, owner pages, the Wallet web service), run on fixture
  merchants.
- **wallet loop**: register a device, then earn. Exactly one `POST /3/device/<token>`
  arrives, with `apns-topic` = `PASS_TYPE_ID` and body `{}`.
  `passesUpdatedSince=<tag before>` lists the serial, the tag after returns 204,
  and the re-downloaded pass shows the new balance.
- **410 pruning**: the mock answers 410, a redeem pushes, and the device row and
  its registrations are gone.
- **template scoping**: `/me` returns the cafe buttons. A cafe cashier can't redeem
  `drinks` and a restaurant cashier can't redeem `free_coffee` (both 400), while
  each can redeem its own template's actions.
- **campaigns**: an offer-only campaign makes the card show up in
  `passesUpdatedSince`, pushes, and puts the offer on the back of the pass, with no
  ledger rows. POSTing the same campaign id twice credits each targeted card
  exactly once: one `campaign:<id>` row per card, +50 each, and the cached balance
  equals the ledger.
- **card link**: `?card=garbage` returns 410. The signed link scraped from the
  owner's customer page is on `PUBLIC_BASE_URL` and re-issues the same card.

**When it fails**: the app's own output is in `test-results/integration/next.log`.
A `FAIL harness: …` line means the run stopped early (for example, enroll failed and
later checks needed its card). Teardown still ran.

**`MUTATE=1 npm run test:integration`** flips one expectation (the Wallet-loop push
count, 1 → 0), so the run **must** exit 1. Run it after changing the harness to
prove the oracle can still fail.

## E2E suite

`npm run test:e2e` starts `next dev -p 3191`, runs global setup (fixtures, then a
sequential warm-up GET of every route the specs use), and then runs each spec on
both projects. Specs:

- `enroll.spec.ts`: POST returns `{ cardUrl }`; GETting it serves `application/vnd.apple.pkpass` named
  `loyalty-<serial>.pkpass` (a signed zip holding `pass.json`). iPhone opens the card (download
  event + "Your card is ready"); desktop shows the QR screen; an Instagram in-app user agent gets
  "Open your card in Safari" + copy link; an empty form shows inline errors and sends nothing.
- `scan.spec.ts`: cashier UI login → /scan → manual serial → earn by bill ($12.50
  at 10x = 125, preview, then balance) → the cafe template's 4 buttons are shown and
  the restaurant buttons are not → Extra Shot redeems (balance 45).
- `owner.spec.ts`: owner /dashboard shows the 5 KPIs; /customers search finds the
  fixture customer by name and by phone and opens their page; a cashier on
  /dashboard lands on /scan; logged out, /dashboard lands on /login.

Every spec imports `test` from `tests/e2e/helpers.ts`. That `test` **fails any test
whose page saw a 5xx response**. Without it, a server error can hide behind next
dev's auto-reload and the test still goes green.

**Known bug, tracked rather than hidden**: "desktop download is saved with a
.pkpass filename" is marked `test.fail()`. EnrollForm navigates to a `blob:` URL,
which drops the response's filename, so desktop Chromium saves the card as
`<uuid>` with no extension. The list reporter shows that test as `✘`, but it
counts as passed because it failed as expected. Once EnrollForm is fixed, the test
passes, `test.fail()` turns it red, and you delete that line.

**When it fails**: the list output names the test and the failing assertion.
Screenshots, traces and error context for failed tests go to
`test-results/e2e/<test>/`. Open a trace with
`npx playwright show-trace test-results/e2e/<test>/trace.zip`, or the HTML report
with `npx playwright show-report`. Server output is prefixed `[WebServer]` in the
console.

## Unit tests

`npm test` runs `src/**/*.test.ts` with node's built-in runner. They're pure
functions with no database or server.

## CI

`npm run ci` is the gate: `tsc --noEmit`, unit tests, `next build`, the integration
suite, then the Playwright suite — it stops at the first failure and exits non-zero.
Run it before every push (pushing to `main` deploys to production). Locally it takes
about 40 seconds once Supabase is up. Run it when no other `next dev` is using this
checkout's `.next/` (or in a separate worktree), with `TEST_PORT` / `E2E_PORT` if the
default ports are taken.

New machine (or the spare Mac mini): `bash scripts/ci-bootstrap.sh` starts local
Supabase, applies `supabase/schema.sql`, creates the `pass-assets` bucket and writes a
local-only `.env.local` (self-signed signing chain) if there isn't one. Idempotent.

GitHub Actions (`.github/workflows/ci.yml`) runs the same bootstrap + `npm run ci` on
GitHub's free runners for every pull request and every push to `main`, uploading
`test-results/` and `playwright-report/` when it fails. No secrets are involved.
Vercel deploys `main` regardless, so turn on branch protection ("require the CI check")
and merge only green pull requests.
