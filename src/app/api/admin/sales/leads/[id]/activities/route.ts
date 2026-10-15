import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { UUID_RE } from "@/lib/admin/merchant";
import { DNC_LOCKED, checkContact, checkStage } from "@/lib/sales/compliance";
import {
  getLead, leadCompliance, leadRecent, logStageChange, markDoNotContact, postalAddressSet, stageChange,
} from "@/lib/sales/server";
import {
  ACTIVITY_KINDS, CHANNELS, OUTCOMES, STAGES, isOneOf, type ActivityKind, type DncChannel, type Lead,
} from "@/lib/sales/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// Which do-not-contact channel an opt-out arrived on.
const DNC_CHANNEL: Partial<Record<ActivityKind, DncChannel>> = {
  walk_in: "visit", call: "call", voicemail: "call", email: "email", text: "text", dm: "dm",
};
// Outcomes that end the conversation, so no next action is owed.
const NO_NEXT_ACTION = new Set(["no", "opt_out", "paid"]);

// POST /api/admin/sales/leads/{id}/activities
// body: {kind, outcome?, notes?, occurred_at?, person_id?, next_action?,
//        next_action_at?, stage?, recorded?} → 201 {activity, lead, warnings}
// The trust boundary for compliance: checkContact() runs here again and a
// blocked contact is 409 {error: reason}, whatever the UI showed. Outcome
// opt_out marks the lead do-not-contact (and suppresses its phone and email)
// before the activity is written.
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const kind = b.kind;
  if (!isOneOf(ACTIVITY_KINDS, kind)) return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  if (kind === "stage_change") return NextResponse.json({ error: "Stage changes are logged automatically: send stage" }, { status: 400 });
  const outcome = b.outcome ?? null;
  if (outcome !== null && !isOneOf(OUTCOMES, outcome)) return NextResponse.json({ error: "Unknown outcome" }, { status: 400 });
  const notes = typeof b.notes === "string" ? b.notes.replace(/\u0000/g, "").trim() : "";
  if (notes.length > 2000) return NextResponse.json({ error: "Notes: 2000 characters max" }, { status: 400 });
  const personId = b.person_id ?? null;
  if (personId !== null && !(typeof personId === "string" && UUID_RE.test(personId)))
    return NextResponse.json({ error: "Unknown person" }, { status: 400 });
  const stage = b.stage ?? null;
  if (stage !== null && !isOneOf(STAGES, stage)) return NextResponse.json({ error: "Unknown stage" }, { status: 400 });

  const now = new Date();
  const occurred = b.occurred_at ? new Date(String(b.occurred_at)) : now;
  if (!Number.isFinite(occurred.getTime()) || occurred.getTime() > now.getTime() + 5 * 60_000)
    return NextResponse.json({ error: "occurred_at must be a past date-time" }, { status: 400 });
  const nextAt = b.next_action_at ? new Date(String(b.next_action_at)) : null;
  if (nextAt && !Number.isFinite(nextAt.getTime())) return NextResponse.json({ error: "next_action_at is not a date-time" }, { status: 400 });
  const nextAction = typeof b.next_action === "string" ? b.next_action.trim().slice(0, 500) : "";

  const lead = await getLead((await params).id);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Judged at the time the contact happened (a call logged in the evening
  // was made in the afternoon). Rule 1: a do-not-contact lead takes notes
  // only. An opt-out is always recorded, whatever the channel's rules say.
  let warnings: string[] = [];
  if (outcome !== "opt_out" && (isOneOf(CHANNELS, kind) || (lead.do_not_contact && kind !== "note"))) {
    const channel = isOneOf(CHANNELS, kind) ? kind : "walk_in";
    const verdict = checkContact(await leadCompliance(lead), channel, occurred, await leadRecent(lead, occurred), {
      postalAddressSet: postalAddressSet(),
      recorded: b.recorded === true,
    });
    if (!verdict.allowed) return NextResponse.json({ error: verdict.reason }, { status: 409 });
    warnings = verdict.warnings;
  }
  // A do-not-contact lead takes notes, not plans: no next action, and
  // checkStage() keeps it Lost.
  if (lead.do_not_contact && outcome !== "opt_out" && (nextAction || nextAt))
    return NextResponse.json({ error: DNC_LOCKED }, { status: 409 });
  if (isOneOf(CHANNELS, kind) && !NO_NEXT_ACTION.has(outcome ?? "") && (!nextAction || !nextAt))
    return NextResponse.json({ error: "Set the next action and its date (not needed after no, opt out or paid)" }, { status: 400 });
  if (stage && stage !== lead.stage) {
    const why = checkStage(lead, stage);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
  }

  let current: Lead = lead;
  if (outcome === "opt_out") {
    try {
      current = await markDoNotContact(lead, DNC_CHANNEL[kind] ?? "other", notes || null, "opted out", now);
    } catch (e) {
      console.error((e as Error).message);
      return NextResponse.json({ error: "Could not record the opt-out. Try again: it is safe to repeat." }, { status: 500 });
    }
  }

  const { data: activity, error } = await db
    .from("sales_activities")
    .insert({
      lead_id: lead.id, kind, outcome, notes: notes || null, person_id: personId, occurred_at: occurred.toISOString(),
    })
    .select("*")
    .single();
  if (error || !activity) {
    if (error?.code === "23503") return NextResponse.json({ error: "Unknown person" }, { status: 400 });
    console.error("sales activity insert failed:", error?.message);
    return NextResponse.json({ error: "Could not save the activity" }, { status: 500 });
  }

  // Side effects on the lead. An opted-out lead keeps the state
  // markDoNotContact() gave it (lost, no next action).
  if (outcome !== "opt_out") {
    const patch: Partial<Lead> = {};
    if (isOneOf(CHANNELS, kind) && (!lead.last_contacted_at || occurred.toISOString() > lead.last_contacted_at))
      patch.last_contacted_at = occurred.toISOString();
    if (nextAction && nextAt) Object.assign(patch, { next_action: nextAction, next_action_at: nextAt.toISOString() });
    else if (NO_NEXT_ACTION.has(outcome ?? "")) Object.assign(patch, { next_action: null, next_action_at: null });
    const change = stage ? stageChange(lead, stage, now) : null;
    if (change) Object.assign(patch, change.patch);
    if (Object.keys(patch).length) {
      const { data, error: upErr } = await db
        .from("sales_leads")
        .update({ ...patch, updated_at: now.toISOString() })
        .eq("id", lead.id)
        .select("*")
        .single();
      if (upErr || !data) {
        console.error("sales lead side effects failed:", upErr?.message);
        return NextResponse.json({ error: "Activity saved, but the lead was not updated" }, { status: 500 });
      }
      current = data as Lead;
      if (change) await logStageChange(lead.id, change.note, personId);
    }
  }
  return NextResponse.json({ activity, lead: current, warnings }, { status: 201 });
}
