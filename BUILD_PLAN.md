# BUILD PLAN — 42nights Apple Wallet Loyalty (one-shot brief)

This is the brief to hand an agent (or yourself) to take the scaffold to a
shippable, multi-tenant product in one pass. Read top to bottom. The scaffold
already covers the happy path; this doc is the gaps, the decisions, the assets,
and the order.

---

## 0. Decisions to make BEFORE coding (these block everything)

These can't be guessed — lock them or the build will thrash:

1. **Earn model.** You only defined redemptions. Pick one:
   - **points per dollar** (recommended) — staff enters the bill, `points += rate * amount`. Configurable `EARN_RATE` per merchant.
   - flat per visit (e.g. +200)
   - per item
   Recommendation: points-per-dollar with a per-merchant rate, plus keep the redeem buttons fixed as you specified.
2. **Who earns/redeems** — staff-initiated only (default, low fraud) vs customer self-scan (needs anti-farming, see §7).
3. **Android?** Half your ME customers' customers are on Android → they need **Google Wallet** too. Same UX, different API (JWT "save" link, no signing certs). Scope as Phase 2, but design the pass/points layer provider-agnostic now.
4. **One pass type for all merchants, or one per merchant?** Recommendation: **one Pass Type ID** (`pass.com.42nights.loyalty`), branding driven by per-merchant assets/colors at issue time. Simpler certs, one APNs topic.

---

## 1. Definition of done

- A café owner is onboarded: merchant record + branding + staff logins + a public enroll link.
- A customer opens the enroll link in Safari → adds a branded card to Apple Wallet.
- Staff log in to `/scan`, scan the customer's QR, see balance, tap earn/redeem → **the card updates in Wallet within seconds**.
- Owner sees a dashboard: members, points issued/redeemed, top redemptions, repeat rate.
- Multi-tenant: every row scoped by `merchant_id`; staff only see their own café.
- Deployed on https; live pushes work on a real iPhone.

---

## 2. Accounts & prerequisites (with lead times)

| Item | Cost | Lead time | Notes |
|---|---|---|---|
| Apple Developer Program | $99/yr | same day | Pass Type ID + cert + WWDR |
| Domain + https host (Vercel) | ~free | same day | `webServiceURL` MUST be https |
| Supabase project | free tier ok | minutes | Postgres + storage |
| **NFC/VAS entitlement** | free | **weeks–months** | **APPLY NOW** if you ever want tap — it's the long pole and can be denied. Apply once as the platform. |
| Google Wallet API (Phase 2) | free | hours | service account + Issuer ID |

---

## 3. Required assets

### Apple Wallet pass images (per merchant — these define the card look)
| File | @1x | @2x | @3x | Required? |
|---|---|---|---|---|
| `icon.png` | 29×29 | 58×58 | 87×87 | **Yes** (notifications/share sheet) |
| `logo.png` | ≤160×50 | ≤320×100 | — | top-left of card |
| `strip.png` | 375×123 | 750×246 | 1125×369 | the band behind the points (the "stars" area) |

Plus per merchant: `backgroundColor`, `foregroundColor`, `labelColor` (rgb()).
A default set (orange icon, star strip) ships in `models/loyalty.pass/` and `assets/` — replace per merchant.

> **Multi-tenant implication:** don't sign from the static `models/` folder.
> Store each merchant's images + colors in Supabase storage / a `merchants` row,
> and **build the pass in-memory from buffers** at issue time (see §6.2). This
> also fixes the Vercel file-tracing problem.

### App assets
- favicon + PWA manifest + maskable icon (192/512) so staff can "add to home screen" → feels like a native till app.
- 42nights wordmark for login/scan headers.

### Customer-facing
- A printable **"Scan to join"** QR card/table-tent per merchant (generate from the enroll URL). Optional but it's how cafés actually drive sign-ups.

---

## 4. Architecture (lock this)

```
Customer phone  ── Apple Wallet ── (register / pull latest) ──► /api/v1/*  (Node runtime)
                                                                     │
Staff phone/iPad ─ /scan (PWA) ─ scan QR ─► /api/merchant/* ─► points engine
                                                                     │
                                              Postgres (ledger = source of truth)
                                                                     │
                                                          empty push ─► APNs ─► wallet refetches
```

Principles:
- **Ledger is truth.** `passes.points` is a cache; it must always equal `sum(transactions.delta)`. Recompute via atomic SQL (§6.1).
- **Pass = a view.** Never trust client balance; always read/write server-side.
- **Provider-agnostic points layer** so Google Wallet drops in later.

---

## 5. Gaps in the scaffold → the real work

The scaffold does single-tenant happy path. To ship, close these:

- [ ] **Multi-tenant scoping** — filter `lookup`/`redeem`/dashboard by `staff.merchantId`; enroll under `/enroll/[merchantSlug]`; passes carry `merchant_id`.
- [ ] **Per-merchant branding** — store assets+colors per merchant; build pass from buffers.
- [ ] **Atomic balance** — replace read-then-write in `points.ts` with an RPC (§6.1) to kill race conditions / lost updates when two cashiers act at once.
- [ ] **Idempotency / double-tap guard** — disable the button mid-request (client) + accept an `Idempotency-Key` per tap (server) to prevent duplicate transactions on retry.
- [ ] **APNs token pruning** — on `410 Gone`, delete that device + its registrations.
- [ ] **Node runtime pins** — add `export const runtime = "nodejs"` to every route that signs a pass or calls APNs (passkit-generator + http2 don't run on edge).
- [ ] **Earn flow** — implement the model you picked in §0.1 (bill-amount input if points-per-dollar).
- [ ] **Owner dashboard** — `/dashboard` with the metrics in §1, queries over `transactions`.
- [ ] **Roles** — `owner` vs `cashier` on the `staff` table; dashboard is owner-only.
- [ ] **Enrollment dedupe** — one card per phone per merchant.
- [ ] **Staff management** — owner can add/remove cashiers, reset passwords.

---

## 6. Critical patterns (paste-ready — these prevent the common one-shot failures)

### 6.1 Atomic, race-safe balance (Postgres function)
```sql
create or replace function apply_points(p_serial text, p_delta int, p_reason text, p_staff uuid)
returns int language plpgsql as $$
declare new_balance int;
begin
  update passes
     set points = points + p_delta, updated_at = now()
   where serial = p_serial and points + p_delta >= 0
   returning points into new_balance;
  if new_balance is null then
    raise exception 'INSUFFICIENT';   -- either no card or would go negative
  end if;
  insert into transactions(serial, delta, reason, staff_id)
       values (p_serial, p_delta, p_reason, p_staff);
  return new_balance;
end $$;
```
Call with `db.rpc("apply_points", {...})` and push after. One statement = no lost updates.

### 6.2 Build the pass from buffers (multi-tenant + Vercel-safe)
```ts
import { PKPass } from "passkit-generator";
const pass = new PKPass(
  {
    "pass.json": Buffer.from(JSON.stringify(passJsonForMerchant)),
    "icon.png": iconBuf, "icon@2x.png": icon2Buf,
    "logo.png": logoBuf, "strip.png": stripBuf, // …all @2x/@3x
  },
  certificates,
  { serialNumber, authenticationToken, webServiceURL }
);
```
Fetch the buffers from Supabase storage by `merchant_id`. No disk model → no `outputFileTracingIncludes` headache on serverless.

### 6.3 APNs dead-token pruning
```ts
if (status === 410) {
  await db.from("devices").delete().eq("push_token", pushToken);
}
```

### 6.4 Vercel runtime pin (every pass/APNs route)
```ts
export const runtime = "nodejs"; // NOT edge — passkit + http2 need Node
```

---

## 7. Edge cases & failure modes (test each)

- **Insufficient points** → reject, show balance (handled via §6.1).
- **Double tap / retry** → idempotency guard; no duplicate transaction.
- **Two cashiers, same card, same second** → atomic RPC, no lost update.
- **Card not found / deleted** → graceful "not found".
- **Dead push token (410)** → prune.
- **Pass not updating** — checklist: `webServiceURL` is https? `authToken` matches? push returned 200? device registered? check `/api/v1/log`.
- **Clock/timezone** on "LAST UPDATED" — pick merchant TZ, format consistently.
- **Anti-farming** — only relevant **if** you allow customer self-scan; with staff-initiated earn the serial-in-QR is fine (staff verifies presence). If self-scan: signed token + per-pass rate limit. Don't over-build this for the staff flow.
- **Enroll on Android / desktop** — `.pkpass` won't add; show "open in Safari on iPhone" (and Google Wallet path in Phase 2).
- **Wallet sharing** — `sharingProhibited: true` is set so customers can't hand cards around.

---

## 8. Security checklist
- [ ] Certs + service-role key in env/secrets, never in repo (`.gitignore` covers `*.pem`).
- [ ] Cookies `httpOnly` + `secure` in prod; rotate `SESSION_SECRET`.
- [ ] All merchant routes require session + merchant scope (no IDOR — a cashier can't touch another café's serial).
- [ ] Rate-limit `lookup`/`redeem`/`login`.
- [ ] Supabase RLS on if you ever expose anon keys; service-role stays server-only.
- [ ] Audit: every transaction logs `staff_id` (already in schema).

## 9. Deploy
- Vercel, Node runtime functions. Set all env vars. `PUBLIC_BASE_URL` = the prod https domain (it's baked into each pass).
- APNs prod host for real devices; sandbox for TestFlight-style testing.
- Supabase: run `schema.sql` + the `apply_points` function.

## 10. Testing plan
1. **Local**: manual-serial entry on `/scan`, mock APNs (don't push).
2. **Real device pre-deploy**: tunnel (`cloudflared`/ngrok) https → set `PUBLIC_BASE_URL` to the tunnel → add a pass to a real iPhone → redeem → confirm it updates. This is the only way to verify the register→push→pull loop.
3. **Deploy**: repeat on the prod domain.
4. Run through every case in §7.

## 11. Acceptance criteria
- New merchant onboarded end-to-end in < 10 min.
- Customer adds card from enroll link on iPhone.
- Redeem/earn reflects in Wallet < 5s.
- Two-cashier concurrent test never loses points; `passes.points == sum(transactions.delta)` always.
- Dashboard numbers reconcile with the ledger.
- A cashier cannot read/modify another merchant's cards.

---

## 12. Build order (each ≈ one PR/issue)

1. Schema + `apply_points` fn + seed (merchant, owner, cashier).
2. Per-merchant branding model + buffer-based pass builder (§6.2).
3. Enroll `/enroll/[slug]` → branded pass.
4. Apple web service routes + `runtime=nodejs` + APNs prune.
5. Refactor `points.ts` onto `apply_points`; idempotency guard.
6. Multi-tenant scope on lookup/redeem; earn model.
7. Roles + staff management.
8. Owner dashboard.
9. Hardening (rate limits, anti-farming if self-scan).
10. Deploy + real-device test pass.
11. (Phase 2) Google Wallet provider + NFC once entitlement lands.

---

### Reminder on the two long poles
- **NFC entitlement**: apply today if you want tap — weeks to months, may be denied. The scaffold's QR identify-layer is exactly what NFC replaces, so nothing downstream changes when it lands.
- **Real-device testing**: you can't fully validate Wallet updates on localhost. Budget a tunnel + a test iPhone early.
