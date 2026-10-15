import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { anthropic, MODEL_ASK, MODEL_DIGEST } from "@/lib/ai/anthropic";
import { checkContact } from "@/lib/sales/compliance";
import { SALES_AI_DAILY_TOKEN_CAP, SALES_AI_MAX_TOKENS, draftPrompt, postCheck } from "@/lib/sales/ai";
import { AI_OFF } from "@/app/admin/sales/leads/labels";
import { footerText, salesEnv } from "@/lib/sales/scripts";
import { getLead, leadCompliance, leadRecent } from "@/lib/sales/server";
import { CHANNELS, DRAFT_ROLES, isOneOf, type Activity, type Draft } from "@/lib/sales/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const RETRY = "Couldn't write the draft right now. Try again in a moment.";

// POST /api/admin/sales/leads/{id}/draft  body: {role, better?} → 201 {draft}
// One no-tools call on the lead's own fields and last 10 touches. Haiku by
// default, Sonnet with better=true, never Opus. 404 when ANTHROPIC_API_KEY is
// unset (the panel hides). The email roles need email to be allowed by
// checkContact(); the code appends the CAN-SPAM footer, the model never writes
// it. Every draft is stored with its token use, which is also the daily cap.
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: AI_OFF }, { status: 404 });
  const b = await req.json().catch(() => null);
  const role = b?.role;
  if (!isOneOf(DRAFT_ROLES, role)) return NextResponse.json({ error: `role must be one of ${DRAFT_ROLES.join(", ")}` }, { status: 400 });
  const model = b?.better === true ? MODEL_ASK : MODEL_DIGEST;

  if (!(await rateLimit("sales-draft", 20, 60)))
    return NextResponse.json({ error: "Too many drafts at once. Wait a minute." }, { status: 429 });

  const lead = await getLead((await params).id);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const env = salesEnv();
  const compliance = await leadCompliance(lead);
  const recent = await leadRecent(lead, now);
  const verdicts = CHANNELS.map((ch) => ({ ch, v: checkContact(compliance, ch, now, recent, { postalAddressSet: !!env.postalAddress }) }));
  if (lead.do_not_contact) return NextResponse.json({ error: verdicts[0].v.reason }, { status: 409 });
  const email = verdicts.find((x) => x.ch === "email")!.v;
  if ((role === "followup" || role === "owner_email") && !email.allowed)
    return NextResponse.json({ error: email.reason }, { status: 409 });
  if (role === "owner_email" && lead.persona !== "P2" && lead.owner_present !== "no")
    return NextResponse.json({ error: "The owner email is for semi-absentee owners (persona P2 or owner not present)." }, { status: 409 });

  // The cap counts today's drafts (UTC day), checked before the call.
  const { data: today, error: capErr } = await db
    .from("sales_ai_drafts")
    .select("input_tokens, output_tokens")
    .gte("created_at", `${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (capErr) return NextResponse.json({ error: "Query failed" }, { status: 500 });
  const used = (today ?? []).reduce((s, r) => s + r.input_tokens + r.output_tokens, 0);
  if (used >= SALES_AI_DAILY_TOKEN_CAP) return NextResponse.json({ error: "Daily AI limit reached" }, { status: 429 });

  const { data: acts } = await db
    .from("sales_activities")
    .select("kind, outcome, notes, occurred_at")
    .eq("lead_id", lead.id)
    .order("occurred_at", { ascending: false })
    .limit(10);
  const blocked = verdicts.filter((x) => !x.v.allowed).map((x) => `${x.ch}: ${x.v.reason}`);
  const prompt = draftPrompt(role, lead, (acts ?? []) as Pick<Activity, "kind" | "outcome" | "notes" | "occurred_at">[], blocked);

  let text = "";
  let inTok = 0;
  let outTok = 0;
  try {
    const resp = await anthropic().messages.create({
      model,
      max_tokens: SALES_AI_MAX_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
    inTok = resp.usage.input_tokens;
    outTok = resp.usage.output_tokens;
    text = resp.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
  } catch (e) {
    console.error("sales draft failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: RETRY }, { status: 502 });
  }
  if (!text) return NextResponse.json({ error: RETRY }, { status: 502 });

  const flags = postCheck(text);
  const body = role === "followup" || role === "owner_email" ? `${text}\n\n${footerText(lead, env.postalAddress!)}` : text;
  const { data: draft, error } = await db
    .from("sales_ai_drafts")
    .insert({ lead_id: lead.id, role, model, body, flags, input_tokens: inTok, output_tokens: outTok })
    .select("*")
    .single();
  if (error || !draft) {
    console.error("sales draft save failed:", error?.message);
    return NextResponse.json({ error: RETRY }, { status: 500 });
  }
  return NextResponse.json({ draft: draft as Draft }, { status: 201 });
}
