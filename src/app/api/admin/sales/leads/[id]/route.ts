import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { DNC_LOCKED, checkStage } from "@/lib/sales/compliance";
import { leadFields, nameKey } from "@/lib/sales/fields";
import { getLead, leadRecent, logStageChange, postalAddressSet, stageChange, suppressedValues } from "@/lib/sales/server";
import type { Lead } from "@/lib/sales/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

// GET /api/admin/sales/leads/{id} → {lead, activities (newest 50), drafts
// (newest 5), suppressed, recent, postalAddressSet, aiEnabled}: everything the
// lead page needs to run checkContact() for its buttons.
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return unauthorized();
  const lead = await getLead((await params).id);
  if (!lead) return notFound();
  const [acts, drafts, hit, recent] = await Promise.all([
    db.from("sales_activities").select("*").eq("lead_id", lead.id).order("occurred_at", { ascending: false }).limit(50),
    db.from("sales_ai_drafts").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(5),
    suppressedValues([lead.phone, lead.email]),
    leadRecent(lead),
  ]);
  if (acts.error || drafts.error) return NextResponse.json({ error: "Query failed" }, { status: 500 });
  return NextResponse.json({
    lead,
    activities: acts.data,
    drafts: drafts.data,
    suppressed: hit.size > 0,
    recent,
    postalAddressSet: postalAddressSet(),
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
  });
}

// PATCH /api/admin/sales/leads/{id}  body: any lead fields → {lead}
// Server-owned fields are stripped (id, name_key, do_not_contact, dnc_*,
// import_batch, timestamps, consent_at, national_dnc_checked_at):
// do-not-contact only ever goes one way, through /dnc or an opt_out activity,
// and only manual SQL reverses it (strategy §6). email_unsubscribed may be
// set, never cleared.
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return unauthorized();
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const body = b as Record<string, unknown>;
  if (body.email_unsubscribed === false || body.email_unsubscribed === "false") delete body.email_unsubscribed;
  const checked = leadFields(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const patch: Partial<Lead> = checked.value;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const cur = await getLead((await params).id);
  if (!cur) return notFound();
  const now = new Date();

  if (patch.business_name) patch.name_key = nameKey(patch.business_name);
  if (patch.name_key === "") return NextResponse.json({ error: "business_name needs letters or digits" }, { status: 400 });

  const newContact = [patch.phone !== cur.phone ? patch.phone : null, patch.email !== cur.email ? patch.email : null];
  if ((await suppressedValues(newContact)).size) return NextResponse.json({ error: "suppressed" }, { status: 409 });

  // A do-not-contact lead is read-only for anything that leads back to a
  // contact: next action, recording answer, text consent, and (checkStage
  // below) its stage.
  if (cur.do_not_contact && (["next_action", "next_action_at", "recording_consent"].some((k) => k in patch) || (patch.sms_consent && patch.sms_consent !== "none")))
    return NextResponse.json({ error: DNC_LOCKED }, { status: 409 });

  // Recording SMS consent needs the words, how it was given and the exact
  // number (rule 2 matches that number at send time). Washington needs it in
  // writing. The consent and DNC-check dates are always the server's clock.
  if (patch.sms_consent && patch.sms_consent !== "none") {
    if (!patch.consent_text || !patch.consent_method || !patch.consent_phone)
      return NextResponse.json({ error: "Text consent needs consent_text, consent_method and consent_phone" }, { status: 400 });
    if ((patch.state ?? cur.state) === "WA" && patch.consent_method !== "written_form" && patch.consent_method !== "signed_pilot")
      return NextResponse.json({ error: "Washington: texts need written consent (written form or signed pilot)." }, { status: 400 });
    patch.consent_at = now.toISOString();
  }
  if (patch.national_dnc_status && patch.national_dnc_status !== "not_checked")
    patch.national_dnc_checked_at = now.toISOString().slice(0, 10);

  let stageNote: string | null = null;
  if (patch.stage && patch.stage !== cur.stage) {
    const why = checkStage({ ...cur, ...patch }, patch.stage);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    const change = stageChange(cur, patch.stage, now);
    if (change) {
      Object.assign(patch, change.patch);
      stageNote = change.note;
    }
  }

  const { data, error } = await db
    .from("sales_leads")
    .update({ ...patch, updated_at: now.toISOString() })
    .eq("id", cur.id)
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return NextResponse.json({ error: "Another lead already has this phone (or name and ZIP)" }, { status: 409 });
    if (error?.code === "23503") return NextResponse.json({ error: "Unknown person or merchant id" }, { status: 400 });
    console.error("sales lead update failed:", error?.message);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  const lead = data as Lead;
  if (stageNote) await logStageChange(lead.id, stageNote);
  if (lead.email_unsubscribed && !cur.email_unsubscribed && lead.email) {
    const { error: sErr } = await db
      .from("sales_suppressions")
      .upsert({ value: lead.email, kind: "email", reason: "unsubscribed", lead_id: lead.id }, { onConflict: "value", ignoreDuplicates: true });
    if (sErr) console.error("sales email suppression failed:", sErr.message);
  }
  return NextResponse.json({ lead });
}
