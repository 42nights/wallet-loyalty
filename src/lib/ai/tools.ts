import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/supabase";

// ===========================================================================
// Safe LLM-query surface. The model NEVER sees raw SQL, DB creds, or another
// tenant. It may only pick one of these whitelisted, p_merchant-scoped RPCs and
// supply enum/int/date args, which we coerce/clamp server-side. p_merchant is
// injected by the dispatcher from the authenticated session — never from the
// model. Worst case the model picks a wrong-but-safe tool; it can never read
// another merchant or mutate anything.
// ===========================================================================

type ToolInput = Record<string, unknown>;

type ToolDef = {
  name: string;
  rpc: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
  // Build the RPC args from validated model input + the trusted merchantId.
  build: (input: ToolInput, merchantId: string) => Record<string, unknown>;
};

// --- coercion helpers (defensive: model input is untrusted) ----------------
function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
function pickEnum<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt;
}
function cleanStr(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, maxLen);
  return s.length ? s : null;
}
// Model gives a day count; we turn it into a concrete `p_from` timestamptz.
function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const SORTS = ["recent", "points", "lifetime", "name"] as const;
const BUCKETS = ["day", "week", "month"] as const;

export const TOOLS: ToolDef[] = [
  {
    name: "merchant_stats",
    rpc: "merchant_stats",
    description:
      "Headline metrics for the loyalty program: total members, members active in the last 30 days, lifetime points issued and redeemed, top redemptions, and repeat-visit rate. Use for 'how many members', 'how many points', overview questions.",
    input_schema: { type: "object", properties: {} },
    build: (_i, m) => ({ p_merchant: m }),
  },
  {
    name: "merchant_segments",
    rpc: "merchant_segments",
    description:
      "RFM/behavioral customer segments with counts and per-customer labels. Segments: vip, regular, new, active, at_risk, lapsed, dormant. Use for 'how many at-risk / VIP / lapsed customers', churn questions.",
    input_schema: { type: "object", properties: {} },
    build: (_i, m) => ({ p_merchant: m }),
  },
  {
    name: "redemption_funnel",
    rpc: "redemption_funnel",
    description:
      "Conversion funnel: enrolled -> earned once -> earned 3+ times -> redeemed at least once. Use for funnel / engagement / conversion questions.",
    input_schema: { type: "object", properties: {} },
    build: (_i, m) => ({ p_merchant: m }),
  },
  {
    name: "merchant_timeseries",
    rpc: "merchant_timeseries",
    description:
      "New members and points issued/redeemed over time, bucketed by day/week/month. Use for trends, growth, 'over the last N days/weeks'.",
    input_schema: {
      type: "object",
      properties: {
        bucket: { type: "string", enum: [...BUCKETS], description: "Time bucket size." },
        days: { type: "integer", description: "Look-back window in days (1-365)." },
      },
    },
    build: (i, m) => ({
      p_merchant: m,
      p_bucket: pickEnum(i.bucket, BUCKETS, "day"),
      p_from: daysAgoISO(clampInt(i.days, 1, 365, 30)),
    }),
  },
  {
    name: "activity_heatmap",
    rpc: "activity_heatmap",
    description:
      "Transaction counts by day-of-week (0=Sunday) and hour-of-day. Use for 'busiest day', 'busiest time', staffing questions.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", description: "Look-back window in days (1-365)." } },
    },
    build: (i, m) => ({ p_merchant: m, p_from: daysAgoISO(clampInt(i.days, 1, 365, 90)) }),
  },
  {
    name: "staff_activity",
    rpc: "staff_activity",
    description:
      "Per-staff transaction counts and points issued/redeemed over a window. Use for staff performance or over-issuing questions.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", description: "Look-back window in days (1-365)." } },
    },
    build: (i, m) => ({ p_merchant: m, p_from: daysAgoISO(clampInt(i.days, 1, 365, 30)) }),
  },
  {
    name: "detect_anomalies",
    rpc: "detect_anomalies",
    description:
      "Rule-based anomalies: redemption spikes (>2σ above the daily mean) and staff over-issuing outliers. Use for 'anything suspicious', fraud, unusual activity.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", description: "Look-back window in days (1-365)." } },
    },
    build: (i, m) => ({ p_merchant: m, p_from: daysAgoISO(clampInt(i.days, 1, 365, 30)) }),
  },
  {
    name: "merchant_customers",
    rpc: "merchant_customers",
    description:
      "Search/sort/paginate the customer list with per-customer points, lifetime earned/redeemed, visits, last seen. Use to find specific customers or list the top by points/lifetime/recency. Returns at most 50 rows.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional name or phone substring." },
        sort: { type: "string", enum: [...SORTS], description: "Sort order." },
        limit: { type: "integer", description: "Rows to return (1-50)." },
      },
    },
    build: (i, m) => ({
      p_merchant: m,
      p_search: cleanStr(i.search, 60),
      p_sort: pickEnum(i.sort, SORTS, "recent"),
      p_limit: clampInt(i.limit, 1, 50, 20),
      p_offset: 0,
    }),
  },
];

// Anthropic tool definitions (no `build`/`rpc` — those stay server-side).
export const TOOL_DEFS: Anthropic.Tool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

export type ToolCallLog = { name: string; ok: boolean };

// Dispatch one model tool call. p_merchant is forced from the trusted session;
// any merchant-ish field in `input` is ignored by every build().
export async function runTool(
  name: string,
  input: ToolInput,
  merchantId: string
): Promise<unknown> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { error: "unknown tool" };
  const args = def.build(input ?? {}, merchantId);
  const { data, error } = await db.rpc(def.rpc, args);
  if (error) {
    console.warn(`ask tool ${name} failed: ${error.message}`);
    return { error: "query failed" };
  }
  return data ?? null;
}

export const ASK_SYSTEM = `You are a concise data analyst for ONE restaurant's customer-loyalty program.

Answer the owner's question using ONLY the provided tools. Every tool returns aggregated data scoped to this merchant — you cannot see raw records, other merchants, or run arbitrary queries.

Rules:
- Call the tools you need, then answer in 1-3 short sentences with concrete numbers.
- If the data is empty or zero, say so plainly — never invent figures.
- "Spend"/revenue is estimated from points unless the data marks it real; call it "estimated" when unsure.
- Don't describe the tools or your process; just answer the question.`;
