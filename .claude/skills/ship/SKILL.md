---
name: ship
description: Commit all current changes and push to the 42nights/wallet-loyalty GitHub repo as ayaangazali. Use when the user says "/ship", "ship it", "commit and push", or after a feature/fix is complete and should be recorded + deployed. The repo is git-connected to Vercel, so pushing to main auto-deploys to production.
---

# ship — commit + push under the owner's identity

Run these steps in order. This is the project's standard way to record finished
work and deploy it (push to `main` → Vercel auto-builds prod).

1. **Pin the author identity** (local repo, every time, so commits are always attributed correctly):
   ```bash
   git config user.name "ayaangazali"
   git config user.email "ayaangazali.work@gmail.com"
   ```

2. **Stage everything:**
   ```bash
   git add -A
   ```

3. **Bail if nothing to commit:**
   ```bash
   git diff --cached --quiet && echo "nothing to commit" && exit 0
   ```
   If nothing is staged, tell the user and stop.

4. **Write a Conventional Commits message** from the staged diff
   (`git diff --cached --stat` + a quick look at the changes). Pick the right
   type — `feat` / `fix` / `chore` / `docs` / `refactor` — subject ≤ 72 chars,
   imperative. Add a short body only when the "why" isn't obvious from the subject.

5. **Commit** with the co-author trailer:
   ```
   <conventional subject>

   <optional why>

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

6. **Push** the current branch (normally `main`):
   ```bash
   git push origin HEAD
   ```

7. **Report**: the commit hash + short subject, and that the push triggers a
   Vercel production deploy (since the project is git-connected).

## Guardrails
- Never commit secrets. `.env`, `*.pem`, `*.p12`, `*.cer`, `.vercel`, `supabase/.temp`
  are already gitignored — keep them ignored; never `git add -f` them.
- Never force-push.
- One logical change per commit when practical; if the working tree mixes
  unrelated changes, group them into separate commits with clear messages.
- If the push is rejected (remote ahead), `git pull --rebase origin main` then
  push again; surface any conflicts instead of forcing.
