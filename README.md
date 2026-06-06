# 42nights — Apple Wallet Loyalty (scaffold)

[![Repo](https://img.shields.io/badge/GitHub-42nights%2Fwallet--loyalty-181717?logo=github)](https://github.com/42nights/wallet-loyalty)

A working skeleton for digital loyalty cards that live in **Apple Wallet** with
**live points updates**. No customer app. QR-based earn/redeem at the counter.

> NFC tap is deliberately **not** wired in — it needs Apple's VAS entitlement +
> certified reader hardware. The identify step here (QR scan → serial) is the
> exact piece NFC would later replace, so the points engine doesn't change when
> you upgrade. See **NFC later** at the bottom.

## What's inside

```
src/lib/
  config.ts      ← your 4 redeem buttons + earn presets (edit this)
  pass.ts        ← signs the .pkpass (passkit-generator)
  apns.ts        ← empty push so Wallet re-fetches a changed pass
  points.ts      ← the ledger: apply a delta, update balance, push
  auth.ts        ← staff username/password → JWT cookie
  supabase.ts    ← server db client
src/app/api/v1/...   ← Apple's pass web service (register / serials / latest / log)
src/app/api/enroll   ← create a card, return the .pkpass
src/app/api/merchant ← login / lookup / redeem
src/app/(merchant)/  ← login + scan terminal (camera QR + buttons)
src/app/enroll       ← customer sign-up page
supabase/schema.sql  ← the tables
models/loyalty.pass  ← pass template + placeholder icon/logo (swap the art)
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
npm run seed -- "Corgi Cafe" cashier hunter2   # creates a staff login
npm run dev
```

## Try it
- **Enroll a customer:** open `/enroll` (in Safari on iPhone) → adds the card to Wallet.
- **Counter:** open `/scan` → log in (`cashier` / `hunter2`) → scan the customer's QR (or paste the serial) → tap a redeem/earn button → watch the card update in Wallet.

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
I added a basic **earn** flow (`+ Visit` + a custom amount) since you only gave
redemptions — change it to points-per-dollar or whatever your model is.

## Hardening before you ship to 50 venues
- **Anti-replay:** the QR currently encodes the raw serial. Encode a short-lived
  signed token instead so a screenshot can't farm points.
- **Multi-tenant:** scope passes/staff by `merchant_id` everywhere (rows exist;
  the lookup/redeem routes should filter by the logged-in staff's merchant).
- **Rate-limit** the merchant routes; rotate `SESSION_SECRET`.
- **`apns-push-type`**: currently `background`. If updates lag, test `alert`.

## NFC later (the tap)
When you want tap instead of scan:
1. Apply for the **NFC entitlement** at developer.apple.com/contact/passkit (slow, sometimes denied — apply once as the platform, covers all merchants).
2. Add an `nfc` block to the pass (encryptionPublicKey + message=serial).
3. Buy **VAS-certified readers** (Socket S550, VTAP…) per counter.
4. The reader hands you the decrypted serial → call the **same** `applyTransaction`. Nothing downstream changes.
```
