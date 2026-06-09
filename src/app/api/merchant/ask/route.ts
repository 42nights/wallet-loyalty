import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import {
  anthropic,
  MODEL_ASK,
  MODEL_ASK_DEEP,
  AI_DAILY_TOKEN_CAP,
} from "@/lib/ai/anthropic";
import { TOOL_DEFS, runTool, ASK_SYSTEM, type ToolCallLog } from "@/lib/ai/tools";

export const runtime = "nodejs";

const MAX_TURNS = 6; // tool-use rounds before we force a stop

// POST /api/merchant/ask  body: { question, deep? }
// Owner-only natural-language analytics over THIS merchant's data. Claude runs a
// manual tool-use loop against a FIXED whitelist of p_merchant-scoped RPCs
// (src/lib/ai/tools.ts). merchant_id is injected from the session, never the
// model. Soft per-merchant daily token budget; every tool call is logged.
export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const m = owner.merchantId;

  // 20 questions/min/owner — the LLM call is the expensive part.
  if (!(await rateLimit(`ask:${owner.id}`, 20, 60)))
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const { question, deep } = await req.json().catch(() => ({}));
  const q = typeof question === "string" ? question.trim().slice(0, 500) : "";
  if (!q) return NextResponse.json({ error: "Empty question" }, { status: 400 });

  // Pre-call token budget gate (soft cost cap).
  const { data: usedToday } = await db.rpc("ai_usage_today", { p_merchant: m });
  if (Number(usedToday ?? 0) >= AI_DAILY_TOKEN_CAP)
    return NextResponse.json(
      { error: "Daily AI limit reached — try again tomorrow." },
      { status: 429 }
    );

  let client: Anthropic;
  try {
    client = anthropic();
  } catch {
    return NextResponse.json(
      { error: "AI is not configured (ANTHROPIC_API_KEY missing)." },
      { status: 503 }
    );
  }

  const model = deep === true ? MODEL_ASK_DEEP : MODEL_ASK;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: q }];
  const toolLog: ToolCallLog[] = [];
  let inTokens = 0;
  let outTokens = 0;
  let answer = "";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await client.messages.create({
        model,
        max_tokens: 1024,
        system: ASK_SYSTEM,
        tools: TOOL_DEFS,
        messages,
      });
      inTokens += resp.usage.input_tokens;
      outTokens += resp.usage.output_tokens;

      if (resp.stop_reason !== "tool_use") {
        answer = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        break;
      }

      // Execute every tool the model asked for, feed results back.
      messages.push({ role: "assistant", content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        const out = await runTool(
          block.name,
          (block.input ?? {}) as Record<string, unknown>,
          m
        );
        toolLog.push({ name: block.name, ok: !(out as { error?: string })?.error });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(out),
        });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error("ask failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  } finally {
    // Record usage even on partial failure so the budget reflects real spend.
    if (inTokens || outTokens)
      await db.rpc("ai_add_usage", { p_merchant: m, p_in: inTokens, p_out: outTokens });
    console.info(
      `ask m=${m} model=${model} tools=[${toolLog
        .map((t) => `${t.name}${t.ok ? "" : "!"}`)
        .join(",")}] tok=${inTokens}+${outTokens}`
    );
  }

  if (!answer)
    answer = "I couldn't find an answer to that with the available data.";
  return NextResponse.json({ answer, tools: toolLog.map((t) => t.name) });
}
