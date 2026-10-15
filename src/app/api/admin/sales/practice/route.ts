import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { isAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { anthropic, MODEL_ASK, MODEL_DIGEST } from "@/lib/ai/anthropic";
import {
  COACH_SYSTEM, PRACTICE_MAX_TURNS, PRACTICE_MIN_TURNS, PRACTICE_OFF, SCORE_TOOL,
  isPersona, ownerSystem, readScorecard, readTurns, scoreRequest,
} from "@/app/admin/sales/practice/coach";

export const runtime = "nodejs";

const RETRY = "The practice partner didn't answer. Try again in a moment.";

// POST /api/admin/sales/practice  body: {persona, messages: [{role, content}],
// score?: true} → {reply} or {scorecard}
// Claude Haiku plays the owner from a hidden brief; with score, Claude Sonnet
// grades the transcript through a forced tool call. The conversation lives
// only in the request body: nothing is stored or sent anywhere. 404 when
// ANTHROPIC_API_KEY is unset (the page shows the off state). Rate-limited per
// minute and per day, since there is no token ledger to cap.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: PRACTICE_OFF }, { status: 404 });

  const b = await req.json().catch(() => null);
  if (!isPersona(b?.persona)) return NextResponse.json({ error: "Pick who you're pitching." }, { status: 400 });
  const turns = readTurns(b?.messages);
  if (typeof turns === "string") return NextResponse.json({ error: turns }, { status: 400 });
  const score = b?.score === true;
  const yours = turns.filter((x) => x.role === "user").length;
  if (score && yours < PRACTICE_MIN_TURNS)
    return NextResponse.json({ error: `The scorecard needs at least ${PRACTICE_MIN_TURNS} of your turns.` }, { status: 400 });
  if (!score && (turns[turns.length - 1].role !== "user" || yours > PRACTICE_MAX_TURNS))
    return NextResponse.json({ error: `That's ${PRACTICE_MAX_TURNS} turns: get your scorecard.` }, { status: 400 });

  if (!(await rateLimit("sales-practice", 20, 60)) || !(await rateLimit("sales-practice-day", 300, 86_400)))
    return NextResponse.json({ error: "That's a lot of practice at once. Wait a minute." }, { status: 429 });

  try {
    if (!score) {
      const resp = await anthropic().messages.create({
        model: MODEL_DIGEST,
        max_tokens: 200,
        system: ownerSystem(b.persona),
        messages: turns,
      });
      const reply = resp.content
        .filter((c): c is Anthropic.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      return reply ? NextResponse.json({ reply }) : NextResponse.json({ error: RETRY }, { status: 502 });
    }
    const resp = await anthropic().messages.create({
      model: MODEL_ASK,
      max_tokens: 1000,
      system: COACH_SYSTEM,
      tools: [SCORE_TOOL],
      tool_choice: { type: "tool", name: SCORE_TOOL.name },
      messages: [{ role: "user", content: scoreRequest(b.persona, turns) }],
    });
    const call = resp.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    const scorecard = readScorecard(call?.input);
    return scorecard ? NextResponse.json({ scorecard }) : NextResponse.json({ error: RETRY }, { status: 502 });
  } catch (e) {
    console.error("sales practice failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: RETRY }, { status: 502 });
  }
}
