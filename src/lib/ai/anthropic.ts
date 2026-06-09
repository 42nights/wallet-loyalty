import Anthropic from "@anthropic-ai/sdk";

// Server-only Anthropic client. NEVER import into a client component.
//
// Built lazily (mirrors supabase.ts): importing this module never constructs the
// client, so `next build` works without ANTHROPIC_API_KEY. Any actual use throws
// loudly if the key is missing — no silent placeholder.
let _client: Anthropic | undefined;
export function anthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

// Model IDs — current as of 2026 (confirmed via the claude-api skill). Do NOT
// append date suffixes. Per the approved plan:
//   - Sonnet 4.6 → interactive "ask your data" panel (fast, cheap, tool-use loop)
//   - Haiku 4.5  → on-demand digests / one-liners (cheapest)
//   - Opus 4.8   → deep multi-step analysis, behind an explicit `deep` flag
export const MODEL_ASK = "claude-sonnet-4-6";
export const MODEL_ASK_DEEP = "claude-opus-4-8";
export const MODEL_DIGEST = "claude-haiku-4-5";

// Per-merchant soft daily token cap (input + output) for the ask panel. A cost
// backstop, not a hard guarantee — enforced as a pre-call gate in the route.
export const AI_DAILY_TOKEN_CAP = Number(process.env.AI_DAILY_TOKEN_CAP) || 200_000;
