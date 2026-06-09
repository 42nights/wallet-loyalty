import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { anthropic, MODEL_DIGEST } from "@/lib/ai/anthropic";

export const runtime = "nodejs";

// GET  /api/merchant/digest  → latest stored digest (or null)
export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data } = await db
    .from("digests")
    .select("body, model, created_at")
    .eq("merchant_id", owner.merchantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ digest: data ?? null });
}

// POST /api/merchant/digest → generate a fresh Haiku summary, store, return it.
// Single no-tools call: we assemble this merchant's aggregates server-side and
// ask Haiku to turn them into plain-English bullets. p_merchant scoped throughout.
export async function POST() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const m = owner.merchantId;

  if (!(await rateLimit(`digest:${owner.id}`, 6, 60)))
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  let client: Anthropic;
  try {
    client = anthropic();
  } catch {
    return NextResponse.json(
      { error: "AI is not configured (ANTHROPIC_API_KEY missing)." },
      { status: 503 }
    );
  }

  const [statsR, segR, anomR, funnelR] = await Promise.all([
    db.rpc("merchant_stats", { p_merchant: m }),
    db.rpc("merchant_segments", { p_merchant: m }),
    db.rpc("detect_anomalies", { p_merchant: m }),
    db.rpc("redemption_funnel", { p_merchant: m }),
  ]);
  const context = {
    stats: statsR.data ?? {},
    segments: (segR.data as { counts?: unknown } | null)?.counts ?? {},
    anomalies: anomR.data ?? [],
    funnel: funnelR.data ?? {},
  };

  let body = "";
  let inTok = 0;
  let outTok = 0;
  try {
    const resp = await client.messages.create({
      model: MODEL_DIGEST,
      max_tokens: 600,
      system:
        "You write a weekly loyalty-program digest for a busy restaurant owner. Given JSON metrics for THIS shop, return exactly 5 short bullet points (start each with '- '): what's going well, what needs attention (at-risk/lapsed customers, any anomalies), and one concrete suggested action. Use the real numbers. No preamble, no closing line, no fabrication — if a number is zero or missing, say so.",
      messages: [{ role: "user", content: JSON.stringify(context) }],
    });
    inTok = resp.usage.input_tokens;
    outTok = resp.usage.output_tokens;
    body = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  } catch (e) {
    console.error("digest failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }

  await db.rpc("ai_add_usage", { p_merchant: m, p_in: inTok, p_out: outTok });
  if (!body) return NextResponse.json({ error: "Empty digest" }, { status: 502 });

  const { data: saved } = await db
    .from("digests")
    .insert({ merchant_id: m, body, model: MODEL_DIGEST })
    .select("body, model, created_at")
    .single();

  return NextResponse.json({ digest: saved ?? { body, model: MODEL_DIGEST, created_at: null } });
}
