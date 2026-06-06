# PROMPTS — driving the build with Claude Code

How to use this: paste **KICKOFF** once at the start of a session (it locks
context, decisions, and guardrails). Then either run **ONE-SHOT** to do it all,
or fire the **PHASE** prompts one per worktree/issue. Use Claude Code's plan
mode first so it proposes before it writes.

> If `CLAUDE.md` is in the repo, the KICKOFF context is **auto-loaded** every
> session — you don't need to paste it. Just start in plan mode with `ultrathink`
> and your task. KICKOFF below is kept as a fallback / for non-Claude-Code agents.

---

## KICKOFF  (paste first, every session)

```
You're building the 42nights Apple Wallet loyalty product. The repo already
contains a working single-tenant scaffold and a full spec.

FIRST, before writing any code:
1. Read BUILD_PLAN.md in full — it is the source of truth for scope, decisions,
   gaps, code patterns, and acceptance criteria.
2. Read the scaffold: src/lib/* (pass, apns, points, auth, config, supabase),
   src/app/api/v1/* (Apple web service), src/app/api/merchant/*, the (merchant)
   pages, and supabase/schema.sql.
Then summarize your understanding and your plan. Do not write code yet.

LOCKED DECISIONS (do not ask, do not change):
- Earn model = points-per-dollar with a per-merchant configurable EARN_RATE.
  Keep the 4 fixed redeem buttons in config.ts exactly as they are.
- ONE Pass Type ID for all merchants. Branding (logo, strip, colors) is
  per-merchant, loaded from Supabase storage at issue time.
- Apple Wallet ONLY for phase 1. Keep the pass/points layer provider-agnostic
  so Google Wallet can drop in later, but DO NOT build Google Wallet now.
- Staff roles: owner and cashier. Dashboard is owner-only.
- Multi-tenant: every query scoped by merchant_id. A cashier must never read or
  modify another merchant's data.

HARD RULES:
- Do NOT invent passkit-generator or APNs APIs. If unsure of a signature, read
  the installed package's types in node_modules or its README. Never guess.
- Add `export const runtime = "nodejs"` to every route that signs a pass or
  calls APNs.
- The transactions ledger is the source of truth. All balance changes go through
  the atomic apply_points() SQL function (BUILD_PLAN §6.1). Never read-then-write
  a balance in app code.
- Build passes from in-memory buffers (BUILD_PLAN §6.2), not the static models/
  folder.
- No secrets in code. No localStorage. TypeScript strict; avoid `any`.

WHAT I HANDLE (don't fake these — stub cleanly and tell me what to provide):
- Apple Developer certs, the Supabase project + storage buckets, per-merchant
  artwork, and the real-device test.
- You CANNOT verify Wallet live-updates yourself (needs https + a physical
  iPhone). When a task depends on that, implement it, then give me the exact
  manual test steps. Do not claim it works.

WORKFLOW: work the build order in BUILD_PLAN §12, one phase per commit,
conventional commit messages, run `npm run build` after each phase and fix
errors before continuing.

Start with the reading and your plan. Wait for my "go" before writing code.
```

---

## ONE-SHOT  (use instead of waiting between phases)

Append this after KICKOFF instead of "wait for my go":

```
Execute the ENTIRE BUILD_PLAN §12 build order now, phase by phase, committing
after each phase. Do not stop to confirm between phases. When finished, give me:
(1) a summary of every change, (2) the exact manual steps I must do (certs,
Supabase setup, artwork, device test), and (3) a list of anything you stubbed
or could not verify.
```

> Reality check: the *code* can be one-shot. The product cannot fully ship from
> one prompt — certs, assets, Supabase, and the on-device update test need you.
> Expect the agent to finish the code and hand you a short checklist.

---

## PHASE prompts  (one per worktree/issue — KICKOFF context assumed)

```
P1 — Schema. Add owner/cashier role to `staff`, `earn_rate` to `merchants`, and
the apply_points() function (BUILD_PLAN §6.1). Update seed.ts to create a
merchant (with rate), one owner, one cashier. Done = schema.sql runs clean and
`npm run seed` creates all three.
```
```
P2 — Per-merchant branding + buffer pass builder. Add a merchant branding model
(logo/strip/colors, stored in Supabase storage; paths/colors on the merchant
row). Rewrite lib/pass.ts to build the .pkpass from in-memory buffers fetched by
merchant_id (BUILD_PLAN §6.2). Done = buildPass(merchantId, serial) returns a
signed pass using that merchant's art and colors.
```
```
P3 — Enrollment per merchant. Move enroll to /enroll/[slug]; resolve slug →
merchant; create the card with merchant_id; dedupe one card per phone per
merchant. Done = visiting a merchant's enroll link issues their branded pass.
```
```
P4 — Apple web service hardening. Add runtime=nodejs to the v1 + pass-signing
routes. On APNs 410, delete the dead device + its registrations (BUILD_PLAN
§6.3). Done = invalid tokens get pruned; routes run on Node.
```
```
P5 — Points engine refactor. Move points.ts onto apply_points(). Add an
Idempotency-Key guard on /api/merchant/redeem so a double-tap or retry can't
double-apply. Done = concurrent/duplicate calls never lose or double points.
```
```
P6 — Multi-tenant scope + earn. Scope lookup/redeem by the logged-in staff's
merchant_id (reject cross-merchant serials). Implement points-per-dollar earn:
a bill-amount input on /scan that applies round(earn_rate * amount). Done = a
cashier can't touch another café's card; earn works.
```
```
P7 — Roles + staff management. Add owner-only routes/pages to add/remove
cashiers and reset passwords. Done = owner can manage staff; cashier cannot.
```
```
P8 — Owner dashboard. /dashboard (owner-only): members, active members, points
issued vs redeemed, top redemptions, repeat-visit rate — all from transactions.
Done = numbers reconcile with the ledger.
```
```
P9 — Hardening. Rate-limit login/lookup/redeem. Secure cookies in prod. Confirm
no IDOR anywhere. Done = security checklist (BUILD_PLAN §8) passes.
```
```
P10 — Deploy + device test. Add a PWA manifest + icons so /scan installs to home
screen. Write the deploy + tunnel + real-iPhone test runbook from BUILD_PLAN §10
and §1, then walk me through it. Done = a pass updates on a real device in <5s.
```

---

## Tips for the best one-shot
- Run **plan mode** first; approve the plan, then let it execute.
- Keep the repo + BUILD_PLAN.md in context — the prompts lean on them.
- If it ever asks about an API signature, tell it to read node_modules types, not guess.
- For parallel work, P1→P2→P3 are sequential (schema → pass → enroll); P7/P8/P10 can run in their own worktrees once P6 lands.
- More prompting technique: https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview
```
