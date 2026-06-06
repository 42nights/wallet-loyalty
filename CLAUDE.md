# CLAUDE.md — 42nights Wallet Loyalty

Auto-loaded every session. Full spec is **BUILD_PLAN.md** (source of truth:
scope, gaps, code patterns, acceptance criteria). Task prompts are in
**PROMPTS.md**. **Read BUILD_PLAN.md before starting any task.**

## What this is
A multi-tenant Apple Wallet loyalty product for restaurants/cafés. Customers add
a branded card to Apple Wallet, earn/redeem points via QR scan at the counter,
and the card updates live. Sold per-merchant.

## Locked decisions — do not change, do not ask
- **Earn model** = points-per-dollar with a per-merchant `earn_rate`. The 4 redeem buttons in `src/lib/config.ts` stay fixed as defined.
- **One Pass Type ID** for all merchants; branding (logo/strip/colors) is per-merchant, loaded from Supabase storage at issue time.
- **Apple Wallet only** for now. Keep the pass/points layer provider-agnostic so Google Wallet can drop in later — but do not build it.
- **Roles**: `owner` and `cashier`. Dashboard is owner-only.
- **Multi-tenant**: every query scoped by `merchant_id`. A cashier must never read or modify another merchant's data.

## Hard rules
- **Never invent** passkit-generator or APNs APIs. Read the installed package's types in `node_modules` or its README — don't guess signatures.
- `export const runtime = "nodejs"` on every route that signs a pass or calls APNs (they fail on edge).
- The `transactions` ledger is the **source of truth**. All balance changes go through the atomic `apply_points()` SQL function (BUILD_PLAN §6.1). Never read-then-write a balance in app code.
- Build passes from **in-memory buffers** (BUILD_PLAN §6.2), not the static `models/` folder.
- No secrets in code. No localStorage/sessionStorage. TypeScript strict; avoid `any`.

## Conventions
- Work the build order in BUILD_PLAN §12 — one phase per commit, conventional commit messages.
- Run `npm run build` after each phase; fix errors before continuing.
- Small, reviewable changes.

## The human handles — do not fake these
Apple Developer certs, the Supabase project + storage buckets, per-merchant
artwork, and the real-device test. Where these are needed, stub cleanly and
state exactly what to provide.

## Testing limitation (important)
You **cannot** verify Wallet live-updates yourself — it needs https + a physical
iPhone. When a task depends on it, implement it, then give the exact manual test
steps. Never claim the update loop "works" without that test.

## Starting a build session
Use **plan mode** (Shift+Tab) and **`ultrathink`** for the planning pass: read
BUILD_PLAN.md + the scaffold, propose a plan, wait for approval, then execute.
Don't jump straight to code.
