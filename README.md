# 42nights — Apple Wallet Loyalty

[![Repo](https://img.shields.io/badge/GitHub-42nights%2Fwallet--loyalty-181717?logo=github)](https://github.com/42nights/wallet-loyalty)

A **multi-tenant** product for branded digital loyalty cards that live in **Apple
Wallet** with **live points updates**. Customers add a card from a per-merchant
link; staff earn/redeem via QR scan at the counter; owners get a dashboard. Sold
per-merchant. No customer app.

The full build (BUILD_PLAN §12, phases **P1–P10**) is implemented: per-merchant
branding, atomic + idempotent + tenant-safe points, owner/cashier roles, an owner
dashboard, and hardening. **What's left is wiring** — Apple certs, a Supabase
project + storage bucket, per-merchant artwork, and the real-device test. The
end-to-end checklist is **[RUNBOOK.md](RUNBOOK.md)**.

> NFC tap is deliberately **not** wired in — it needs Apple's VAS entitlement +
> certified reader hardware. The identify step here (QR scan → serial) is the
> exact piece NFC would later replace, so the points engine doesn't change when
> you upgrade. See **NFC later** at the bottom.

## What's inside

```
src/lib/
  config.ts            ← the 4 fixed redeem buttons (earn = points-per-dollar via merchant.earn_rate)
  points.ts            ← balance changes via the atomic apply_points() RPC (ledger = source of truth)
  auth.ts              ← staff login → JWT cookie; owner/cashier roles, requireOwner()
  ratelimit.ts         ← Postgres-backed rate limiter (login / lookup / redeem)
  passDefaults.ts      ← bundled default pass art (base64 — no runtime disk read)
  supabase.ts          ← server db client (service role)
  wallet/              ← provider-agnostic seam (Apple today; Google Wallet later)
    types.ts           ← WalletProvider interface
    apple/pass.ts      ← builds the .pkpass from in-memory per-merchant buffers
    apple/apns.ts      ← empty push + 410 dead-token pruning
    apple/provider.ts  ← buildPass + notify
src/app/api/v1/...     ← Apple's pass web service (register / serials / latest / log)
src/app/api/enroll     ← create or re-issue a card, return the .pkpass
src/app/api/merchant   ← login / me / lookup / redeem / staff
src/app/(merchant)/    ← scan terminal · owner dashboard · staff management
src/app/enroll/[slug]  ← per-merchant customer sign-up
supabase/schema.sql    ← tables + apply_points / rate_limit_hit / merchant_stats
scripts/               ← seed.ts (merchant + owner + cashier) · upload-assets.ts
models/loyalty.pass    ← reference art (also the source of the bundled defaults)
```

## The mental model

The **pass doesn't store points — Postgres does.** The card is a live view of a
row. To change points: write a ledger row → update the cached balance → send an
empty APNs push → the iPhone calls back for the latest `.pkpass`. That's the
whole loop. The "LAST UPDATED" date refreshes on every re-issue.

## Setup

### 1. Apple ($99/yr developer account)
1. Create a **Pass Type ID** (Certificates, IDs & Profiles → Identifiers → Pass Type IDs), e.g. `pass.com.42nights.loyalty`.
2. Create a **Pass Type ID certificate** for it: generate a CSR (Keychain Access → Certificate Assistant, or `openssl`), upload it, download `pass.cer`.
3. Download Apple's intermediate cert **AppleWWDRCAG4.cer** from https://www.apple.com/certificateauthority/

### 2. Turn the certs into PEM (the part everyone gets stuck on)
```bash
# pass cert → PEM
openssl x509 -inform der -in pass.cer -out passcert.pem

# WWDR → PEM
openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem

# private key → PEM  (export your key+cert from Keychain as Certificates.p12 first)
openssl pkcs12 -in Certificates.p12 -nocerts -out passkey.pem -nodes

# base64 them for env vars (macOS):
base64 -i passcert.pem | pbcopy   # → PASS_SIGNER_CERT_PEM
base64 -i passkey.pem  | pbcopy   # → PASS_SIGNER_KEY_PEM
base64 -i wwdr.pem     | pbcopy   # → APPLE_WWDR_PEM
```
> The **same pass signing cert** authenticates APNs — no separate push cert needed.

### 3. Supabase
- Create a project, run `supabase/schema.sql` in the SQL editor.
- Grab the project URL + **service role** key into `.env`.

### 4. Env + run
```bash
cp .env.example .env        # fill everything in
npm install
npm run seed -- "Corgi Cafe" corgi 1.0 owner ownerpw cashier cashierpw   # merchant + owner + cashier
npm run dev
```

## Try it
- **Enroll a customer:** open `/enroll/<slug>` (e.g. `/enroll/corgi`) in Safari on iPhone → adds the branded card to Wallet.
- **Counter:** open `/scan` → log in → scan the customer's QR (or paste the serial) → tap a redeem button or enter a bill amount to earn → watch the card update in Wallet.
- **Owner:** `/dashboard` (metrics) and `/staff` (manage cashiers) — owner role only.

> Local dev can't push to Wallet over `http`. For real device updates, deploy
> behind **https** (Vercel works) and set `PUBLIC_BASE_URL` to that domain — the
> URL is baked into each pass as `webServiceURL`.

## Editing the buttons
Everything lives in `src/lib/config.ts`:
```ts
export const REDEMPTIONS = [
  { id: "drinks",         label: "Drinks",        points: -500,  kind: "redeem" },
  { id: "extra_side",     label: "Extra Side",    points: -1000, kind: "redeem" },
  { id: "fortune_cookie", label: "Fortune Cookie",points: -100,  kind: "redeem" },
  { id: "extra_sauce",    label: "Extra Sauce",   points: -100,  kind: "redeem" },
];
```
The 4 redeem buttons above are fixed. **Earning is points-per-dollar**: each
merchant has an `earn_rate`, and the `/scan` bill-amount input applies
`round(earn_rate × amount)` server-side.

## Hardening — status
- ✅ **Multi-tenant:** every merchant route is scoped by the logged-in staff's `merchant_id`; `apply_points()` enforces it in SQL too. See the IDOR audit in [RUNBOOK.md](RUNBOOK.md).
- ✅ **Rate-limit:** login / lookup / redeem are throttled via a Postgres limiter.
- ✅ **Idempotency:** redeem requires an `Idempotency-Key`, so a double-tap or retry can't double-apply.
- **Anti-replay (optional):** the QR encodes the raw serial. Since earn/redeem are staff-initiated this is fine; only encode a short-lived signed token if you ever allow customer self-scan.
- **`apns-push-type`:** currently `background`. If updates lag, test `alert`.
- Rotate `SESSION_SECRET` for production.

## NFC later (the tap)
When you want tap instead of scan:
1. Apply for the **NFC entitlement** at developer.apple.com/contact/passkit (slow, sometimes denied — apply once as the platform, covers all merchants).
2. Add an `nfc` block to the pass (encryptionPublicKey + message=serial).
3. Buy **VAS-certified readers** (Socket S550, VTAP…) per counter.
4. The reader hands you the decrypted serial → call the **same** `applyTransaction`. Nothing downstream changes.
```
