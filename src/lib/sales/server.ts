import { db } from "@/lib/supabase";
import { UUID_RE } from "@/lib/admin/merchant";
import { recentFromActivities, recipientZone, type LeadCompliance, type Recent } from "./compliance";
import { salesEnv } from "./scripts";
import {
  PERSONAS, SEGMENTS, STAGES, isOneOf, type Activity, type DncChannel, type ImportBatch, type Lead, type Stage,
} from "./types";

// Server-only Sales CRM helpers shared by the /api/admin/sales routes (service
// role; every caller has already passed isAdmin()). NEVER import into a client
// component.

export const LEAD_LIST_SELECT =
  "*, assignee:sales_people!assignee_id(id,name), sourced_by:sales_people!sourced_by_id(id,name)";

// Search text goes into a PostgREST or() filter, where , ( ) . : * and quotes
// are syntax: keep letters, digits, spaces, & ' and -.
const searchText = (q: string) => q.replace(/[^\p{L}\p{N} &'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);

// The lead list's filters (spec §2.2), shared by GET /leads and the export so
// the CSV is exactly the filtered view. Do-not-contact leads are hidden unless
// dnc=1.
export function leadsQuery(sp: URLSearchParams, select: string, count = false) {
  let q = db.from("sales_leads").select(select, count ? { count: "exact" } : undefined);
  const one = (k: string) => sp.get(k)?.trim() || null;
  const stage = one("stage");
  if (isOneOf(STAGES, stage)) q = q.eq("stage", stage);
  for (const [param, col] of [["assignee", "assignee_id"], ["sourced_by", "sourced_by_id"]] as const) {
    const v = one(param);
    if (v === "none") q = q.is(col, null);
    else if (v && UUID_RE.test(v)) q = q.eq(col, v);
  }
  const segment = one("segment");
  if (isOneOf(SEGMENTS, segment)) q = q.eq("segment", segment);
  const persona = one("persona");
  if (isOneOf(PERSONAS, persona)) q = q.eq("persona", persona);
  for (const col of ["source", "cluster"] as const) {
    const v = one(col);
    if (v) q = q.eq(col, v);
  }
  // City: the whole value, any case ("brooklyn" = "BROOKLYN"). % _ * are
  // wildcards to PostgREST's ilike, so they go.
  const city = one("city")?.replace(/[%_*\\]/g, "").trim().slice(0, 80);
  if (city) q = q.ilike("city", city);
  const state = one("state");
  if (state && /^[a-z]{2}$/i.test(state)) q = q.eq("state", state.toUpperCase());
  if (one("has_phone") === "1") q = q.not("phone", "is", null);
  // Apollo numbers are filed as people_search (owner's own line, hand-dial only).
  if (one("apollo") === "1") q = q.eq("phone_source", "people_search");
  if (one("franchise") === "1") q = q.not("franchise_brand", "is", null);
  if (one("dnc") !== "1") q = q.eq("do_not_contact", false);
  const search = searchText(one("q") ?? "");
  if (search) {
    const digits = search.replace(/\D/g, "");
    const ors = [`business_name.ilike.*${search}*`, `owner_name.ilike.*${search}*`, `city.ilike.*${search}*`];
    if (digits.length >= 3) ors.push(`phone.ilike.*${digits}*`);
    if (/^\d{5}$/.test(search)) ors.push(`zip.eq.${search}`);
    q = q.or(ors.join(","));
  }
  return q;
}

export async function getLead(id: string): Promise<Lead | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await db.from("sales_leads").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`sales lead read failed: ${error.message}`);
  return (data as Lead | null) ?? null;
}

// Which of these phone numbers / emails have opted out (chunked: PostgREST
// puts in() lists in the URL).
export async function suppressedValues(values: (string | null | undefined)[]): Promise<Set<string>> {
  const list = [...new Set(values.filter((v): v is string => !!v))];
  const hit = new Set<string>();
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await db.from("sales_suppressions").select("value").in("value", list.slice(i, i + 200));
    if (error) throw new Error(`suppression lookup failed: ${error.message}`);
    for (const r of data ?? []) hit.add(r.value as string);
  }
  return hit;
}

export async function leadCompliance(lead: Lead): Promise<LeadCompliance> {
  const hit = await suppressedValues([lead.phone, lead.email]);
  return { ...lead, suppressed: hit.size > 0 };
}

// checkContact()'s `recent` counts, from the last 90 days of activities.
export async function leadRecent(lead: Lead, now = new Date()): Promise<Recent> {
  const { data, error } = await db
    .from("sales_activities")
    .select("kind, outcome, occurred_at")
    .eq("lead_id", lead.id)
    .gte("occurred_at", new Date(now.getTime() - 90 * 86_400_000).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`sales activity read failed: ${error.message}`);
  return recentFromActivities((data ?? []) as Pick<Activity, "kind" | "outcome" | "occurred_at">[], now, recipientZone(lead).tz);
}

export const postalAddressSet = () => !!salesEnv().postalAddress;

// What a stage change also writes (spec §7): the first pilot and the first
// payment are stamped once, and the change is logged as an activity.
export function stageChange(lead: Lead, stage: Stage, now: Date): { patch: Partial<Lead>; note: string } | null {
  if (stage === lead.stage) return null;
  const patch: Partial<Lead> = { stage };
  if (stage === "pilot" && !lead.pilot_started_at) patch.pilot_started_at = now.toISOString();
  if (stage === "paid" && !lead.first_paid_at) patch.first_paid_at = now.toISOString();
  return { patch, note: `${lead.stage} → ${stage}` };
}

export async function logStageChange(leadId: string, note: string, personId: string | null = null) {
  const { error } = await db.from("sales_activities").insert({ lead_id: leadId, kind: "stage_change", notes: note, person_id: personId });
  if (error) console.error("sales stage_change log failed:", error.message);
}

// Do-not-contact, one way (spec §4 opt-out handling). Writes in a safe order:
// the flag first, so a later failure can never leave the lead contactable;
// then the global suppressions; then the stage-change log. Every step is
// idempotent, so a retry after a 500 finishes the job.
// ponytail: three writes, not one transaction; an RPC if partial failures show up.
export async function markDoNotContact(
  lead: Lead,
  channel: DncChannel,
  note: string | null,
  lostReason: string,
  now = new Date()
): Promise<Lead> {
  const patch: Partial<Lead> = {
    do_not_contact: true,
    stage: "lost",
    next_action: null,
    next_action_at: null,
    updated_at: now.toISOString(),
  };
  // A second opt-out keeps the original date, channel and reason.
  if (!lead.do_not_contact) Object.assign(patch, { dnc_at: now.toISOString(), dnc_channel: channel, dnc_note: note, lost_reason: lostReason });
  const { data, error } = await db.from("sales_leads").update(patch).eq("id", lead.id).select("*").single();
  if (error || !data) throw new Error(`do-not-contact update failed: ${error?.message}`);

  const rows: { value: string; kind: "phone" | "email"; lead_id: string }[] = [];
  if (lead.phone) rows.push({ value: lead.phone, kind: "phone", lead_id: lead.id });
  if (lead.email) rows.push({ value: lead.email.toLowerCase(), kind: "email", lead_id: lead.id });
  if (rows.length) {
    const { error: sErr } = await db.from("sales_suppressions").upsert(rows, { onConflict: "value", ignoreDuplicates: true });
    if (sErr) throw new Error(`suppression insert failed: ${sErr.message}`);
  }
  if (lead.stage !== "lost") await logStageChange(lead.id, `${lead.stage} → lost (do not contact)`);
  return data as Lead;
}

// Import history (spec §2.4): one line per batch, newest first. Paged through
// PostgREST's 1,000-row cap; counted here because aggregates are off.
export async function importBatches(): Promise<ImportBatch[]> {
  const byBatch = new Map<string, ImportBatch>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("sales_leads")
      .select("import_batch, source, created_at")
      .not("import_batch", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`import history failed: ${error.message}`);
    for (const r of data ?? []) {
      const b = byBatch.get(r.import_batch) ?? { batch: r.import_batch, source: r.source, rows: 0, imported_at: r.created_at };
      b.rows++;
      if (r.created_at < b.imported_at) b.imported_at = r.created_at;
      byBatch.set(r.import_batch, b);
    }
    if (!data?.length) break;
  }
  return [...byBatch.values()].sort((a, b) => b.imported_at.localeCompare(a.imported_at));
}
