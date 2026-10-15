import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { UUID_RE } from "@/lib/admin/merchant";
import { leadFields, nameKey } from "@/lib/sales/fields";
import { LEAD_LIST_SELECT, leadsQuery, logStageChange, suppressedValues } from "@/lib/sales/server";
import { STAGES, isOneOf, type Lead, type LeadListRow } from "@/lib/sales/types";

export const runtime = "nodejs";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const CREATE_LOCKED = [
  "stage", "sms_consent", "national_dnc_status", "recording_consent", "consent_text", "consent_method",
  "consent_phone", "pilot_started_at", "first_paid_at", "month4_paid_at",
] as const;

// GET /api/admin/sales/leads?stage&assignee&sourced_by&source&segment&cluster
//     &persona&city&state&has_phone=1&franchise=1&dnc=1&q&limit&offset → {total, leads}
// Newest first; "load more" pages with offset (same pattern as the merchant
// customer list).
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get("limit") || "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(sp.get("offset") || "0", 10) || 0, 0);
  const { data, count, error } = await leadsQuery(sp, LEAD_LIST_SELECT, true)
    .order("created_at", { ascending: false })
    .order("id")
    .range(offset, offset + limit - 1);
  if (error) {
    console.error("sales leads list failed:", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
  return NextResponse.json({ total: count ?? 0, leads: (data ?? []) as unknown as LeadListRow[] });
}

// POST /api/admin/sales/leads  body: lead fields (business_name required;
// source defaults to "manual") → 201 {lead}
// Same dedupe as the import: phone first, else name + ZIP. A phone or email
// that opted out is refused, so an opt-out can't come back by typing it in.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  // Consent, DNC status, stage and paid dates carry rules (checkContact, checkStage)
  // that only the lead page runs; a new lead always starts at their defaults.
  const locked = CREATE_LOCKED.find((k) => k in b);
  if (locked) return NextResponse.json({ error: `Set ${locked} on the lead page` }, { status: 400 });
  const checked = leadFields({ source: "manual", ...b });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const lead = checked.value;
  if (!lead.business_name) return NextResponse.json({ error: "business_name is required" }, { status: 400 });
  const key = nameKey(lead.business_name);
  if (!key) return NextResponse.json({ error: "business_name needs letters or digits" }, { status: 400 });

  if ((await suppressedValues([lead.phone, lead.email])).size)
    return NextResponse.json({ error: "suppressed" }, { status: 409 });
  // An opt-out is per shop, not per phone: the same name + ZIP stays suppressed
  // whatever number is typed in (the import matches the same way).
  const optedOut = db.from("sales_leads").select("id").eq("name_key", key).eq("do_not_contact", true);
  const { data: dnc } = await (lead.zip ? optedOut.eq("zip", lead.zip) : optedOut.is("zip", null)).limit(1).maybeSingle();
  if (dnc) return NextResponse.json({ error: "suppressed" }, { status: 409 });

  const dupe = lead.phone
    ? db.from("sales_leads").select("id").eq("phone", lead.phone)
    : lead.zip
      ? db.from("sales_leads").select("id").eq("name_key", key).eq("zip", lead.zip)
      : db.from("sales_leads").select("id").eq("name_key", key).is("zip", null);
  const { data: same } = await dupe.limit(1).maybeSingle();
  if (same) return NextResponse.json({ error: "duplicate", id: same.id }, { status: 409 });

  const { data, error } = await db
    .from("sales_leads")
    .insert({ ...lead, name_key: key })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return NextResponse.json({ error: "duplicate" }, { status: 409 });
    if (error?.code === "23503") return NextResponse.json({ error: "Unknown person or merchant id" }, { status: 400 });
    console.error("sales lead create failed:", error?.message);
    return NextResponse.json({ error: "Could not create lead" }, { status: 500 });
  }
  return NextResponse.json({ lead: data as Lead }, { status: 201 });
}

// PATCH /api/admin/sales/leads  body: {ids: uuid[], set: {assignee_id?, cluster?, stage?}}
// → {updated}. Bulk actions on the list (spec §2.2). Pilot and paid need the
// lead page (they stamp dates and pass the franchise check). Do-not-contact
// leads are read-only here: skipped, never counted in `updated`.
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const b = await req.json().catch(() => null);
  const ids: unknown = b?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((id) => typeof id === "string" && UUID_RE.test(id)))
    return NextResponse.json({ error: "ids must be 1-500 lead ids" }, { status: 400 });
  const set = (b?.set ?? {}) as Record<string, unknown>;
  const allowed = Object.fromEntries(Object.entries(set).filter(([k]) => ["assignee_id", "cluster", "stage"].includes(k)));
  const checked = leadFields(allowed);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const patch = checked.value;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  if (patch.stage === "pilot" || patch.stage === "paid")
    return NextResponse.json({ error: "Set pilot or paid on the lead page" }, { status: 400 });
  if (patch.stage !== undefined && !isOneOf(STAGES, patch.stage))
    return NextResponse.json({ error: "Unknown stage" }, { status: 400 });

  const { data: before, error: readErr } = await db.from("sales_leads").select("id, stage").in("id", ids).eq("do_not_contact", false);
  if (readErr) return NextResponse.json({ error: "Query failed" }, { status: 500 });
  const { data, error } = await db
    .from("sales_leads")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("do_not_contact", false)
    .select("id");
  if (error) {
    if (error.code === "23503") return NextResponse.json({ error: "Unknown person id" }, { status: 400 });
    console.error("sales bulk update failed:", error.message);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  if (patch.stage)
    for (const l of before ?? []) if (l.stage !== patch.stage) await logStageChange(l.id, `${l.stage} → ${patch.stage}`);
  return NextResponse.json({ updated: data?.length ?? 0 });
}
