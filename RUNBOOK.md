# RUNBOOK — 42nights Wallet Loyalty (deploy + device test)

The code for the full build (BUILD_PLAN §12, phases P1–P10) is complete and
type-checks/builds clean. What it **cannot** do by itself is prove the live
Wallet update loop — that needs your Apple certs, a Supabase project, and a
physical iPhone. This runbook is the exact path from a green build to a working
card on a real phone.

---

## 0. One-time accounts (see README for the openssl cert steps)
- Apple Developer Program → a **Pass Type ID**, its **signing cert + private key** (PEM), Apple **WWDR** cert (PEM), and your 10-char **Team ID**.
- A **Supabase** project (Postgres + Storage).
- A host that serves **https** (Vercel) and, for pre-deploy testing, a tunnel (`cloudflared` / `ngrok`).

## 1. Database
1. Run **`supabase/schema.sql`** in the Supabase SQL editor. It is idempotent (safe to re-run) and creates the tables, indexes, and the `apply_points`, `rate_limit_hit`, and `merchant_stats` functions.
2. Verify the points engine with **`supabase/test_apply_points.sql`** — it asserts the applied / insufficient / not-found / idempotent-replay branches and documents the two-session concurrent-key race test.
3. Storage → create a **private bucket named `pass-assets`**.

## 2. Environment (`.env`, from `.env.example`)
| Var | Notes |
|---|---|
| `PUBLIC_BASE_URL` | https origin baked into each pass as `webServiceURL`. The tunnel URL for device testing, the prod domain for deploy. |
| `SESSION_SECRET` | long random string; rotate for prod. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | service-role key is **server-only**. |
| `PASS_TYPE_ID`, `APPLE_TEAM_ID`, `PASS_ORG_NAME` | pass identifiers. |
| `APPLE_WWDR_PEM`, `PASS_SIGNER_CERT_PEM`, `PASS_SIGNER_KEY_PEM`, `PASS_SIGNER_KEY_PASSPHRASE` | base64 PEM (or raw PEM). The signing cert also authenticates APNs. |
| `APNS_HOST` | `https://api.push.apple.com` (prod) or `https://api.sandbox.push.apple.com`. |

## 3. Seed + branding
```bash
npm install
npm run seed -- "Corgi Cafe" corgi 1.0 owner ownerpw cashier cashierpw
#                 name         slug rate owner ----- cashier -----
npm run upload-assets -- <merchant_id> ./assets   # optional; defaults work without it
```
`upload-assets` pushes icon/logo/strip art to `pass-assets/merchants/<id>/` and bumps `assets_updated_at` (which busts the pass image cache). Without it, a merchant issues a valid pass using the bundled default art.

## 4. Local dev
```bash
npm run dev
```
- Owner/cashier log in at **`/scan`** (`/login`). Owners also see **`/dashboard`** and **`/staff`**.
- Customers enroll at **`/enroll/<slug>`** (e.g. `/enroll/corgi`).
- Local `http` **cannot** push to Wallet — for that, go to §5.

## 5. Real-device test (the only way to verify the update loop)
1. Start a tunnel: `cloudflared tunnel --url http://localhost:3000` → copy the https URL.
2. Set `PUBLIC_BASE_URL` to that URL and restart `npm run dev` (the URL is baked into each issued pass).
3. On an **iPhone in Safari**, open `https://<tunnel>/enroll/corgi` → fill name/phone → **Add to Apple Wallet**.
4. On the counter device, open `/scan`, log in, scan the card's QR (or type the serial) → tap a redeem button or enter a bill amount → **watch the card balance update in Wallet within a few seconds.**
5. If it doesn't update, check: `PUBLIC_BASE_URL` is https? device registered (a row in `registrations`)? APNs returned 200 (server logs)? Apple's error posts land at `/api/v1/log`.

## 6. Deploy (Vercel)
- Import the repo; set **all** env vars from §2 (use the prod domain for `PUBLIC_BASE_URL`, prod `APNS_HOST`).
- Routes that sign passes / call APNs are pinned to the Node runtime already.
- Re-run §1 against the prod Supabase if separate. Repeat §5 on the prod domain.
- Optional: a daily `delete from rate_limits where window_start < now() - interval '1 day'` (pg_cron) to sweep stale limiter buckets.

## 7. Edge cases to test (BUILD_PLAN §7)
- [ ] Insufficient points → 422, balance shown, no ledger row.
- [ ] Double-tap / retry → one transaction (busy guard + `Idempotency-Key`).
- [ ] Two cashiers, same card, same second → atomic `apply_points`, no lost update.
- [ ] Card not found / wrong merchant → 404 (no existence leak).
- [ ] Dead push token (410) → device + its registrations pruned.
- [ ] Re-enroll same phone at a merchant → re-issues the existing card, no duplicate.
- [ ] Enroll on Android/desktop → `.pkpass` won't add; "open in Safari on iPhone".

## 8. Security audit (BUILD_PLAN §8)
- **No IDOR.** Every merchant route is session-gated and scoped:
  - `lookup` filters by `staff.merchantId`; cross-merchant serial → 404.
  - `redeem` passes `p_merchant`; `apply_points` enforces `merchant_id = p_merchant` in SQL (DB backstop) → cross-merchant → not_found.
  - `staff` CRUD is owner-only (`requireOwner`) and scoped to the owner's merchant; can't remove self or another owner.
  - `dashboard`/`staff` pages redirect non-owners to `/scan`, unauthed to `/login`.
  - Apple `/api/v1/*` auth is per Apple's protocol (per-pass `ApplePass` token; the list-updatable-passes + log endpoints are unauthenticated by spec, keyed by the opaque device id).
- **Secrets**: certs + service-role key in env only; `.gitignore` covers `*.pem`/`*.p12`/`*.cer`/`.env`.
- **Cookies**: `httpOnly` + `secure` (prod) + `sameSite=lax`; rotate `SESSION_SECRET`.
- **Rate limits**: login 10/min per IP+username; lookup/redeem 120/min per staff.
- **Anti-farming**: not needed — earn/redeem are staff-initiated (the cashier verifies presence). Only relevant if you ever add customer self-scan.

## 9. PWA
`/scan` installs to the home screen (manifest + icons + `apple-mobile-web-app-capable`). **The icons in `public/` are low-res placeholders upscaled from the sample art — replace `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.png` with proper maskable artwork before shipping.**

## 10. What is stubbed / unverifiable locally (hand back to you)
- Apple certs, the Supabase project + `pass-assets` bucket, and per-merchant artwork — you provide these.
- A **real `.pkpass`** (valid signature, colors, image rendering), **APNs push + 410 pruning**, and the **live <5s update** — provable only on a physical iPhone (§5).
- `apply_points` concurrency (the two-session race) — run `test_apply_points.sql` against Postgres.
- Builds in this repo were verified with **dummy** Supabase/session env vars; nothing real is wired.
- Phase 11 (Google Wallet + NFC) is intentionally **not built** — the `WalletProvider` seam (`src/lib/wallet/`) is where a Google provider drops in later.
