// Sales CRM types and enum values (admin-sales spec §1). Pure: safe to import
// from client components. The enum arrays mirror the schema.sql check
// constraints; the API validates against them before Postgres does.
//
// ---------------------------------------------------------------------------
// Route contracts. Every route is admin-only (401 {error} without the
// admin_session cookie) and answers errors as {error: string}.
//
// GET    /api/admin/sales/leads?stage&assignee&sourced_by&source&segment&cluster
//          &persona&city&state&has_phone=1&apollo=1&franchise=1&dnc=1&q&limit(≤200, 50)&offset
//          → {total, leads: LeadListRow[]}. Do-not-contact leads are hidden
//          unless dnc=1. assignee/sourced_by take a person id or "none"; city
//          is the whole value in any case; q also searches city.
// POST   /api/admin/sales/leads  body: LeadInput (business_name required,
//          source defaults to "manual") → 201 {lead}; 409 {error, id} duplicate
//          (same phone, or same name + ZIP); 409 {error:"suppressed"} opted out.
// PATCH  /api/admin/sales/leads  body: {ids: uuid[] (≤500), set: {assignee_id?,
//          cluster?, stage? (never pilot/paid)}} → {updated}. Bulk actions;
//          do-not-contact leads are skipped.
// GET    /api/admin/sales/leads/[id] → {lead, activities (newest 50), drafts
//          (newest 5), suppressed, recent: Recent}
// PATCH  /api/admin/sales/leads/[id]  body: LeadInput (partial). Strips id,
//          name_key, do_not_contact, dnc_*, import_batch, timestamps,
//          consent_at, national_dnc_checked_at (server-stamped) and
//          email_unsubscribed=false. 409 on a do-not-contact lead for stage,
//          next_action(_at), recording_consent or sms_consent. sms_consent ≠
//          none needs consent_text, consent_method and consent_phone in the
//          same body (WA: written).
//          A stage change logs a stage_change activity → {lead}; 409 {error}.
// POST   /api/admin/sales/leads/[id]/activities  body: {kind, outcome?, notes?,
//          occurred_at?, person_id?, next_action?, next_action_at?, stage?,
//          recorded?: boolean} → 201 {activity, lead, warnings}; 409 {error}
//          when checkContact() blocks, or a do-not-contact lead gets a stage
//          or next action. Outcome opt_out marks do-not-contact.
// POST   /api/admin/sales/leads/[id]/dnc  body: {channel: DncChannel, note?}
//          → {lead}. One way: nothing in the API clears it.
// POST   /api/admin/sales/leads/[id]/draft  body: {role: DraftRole, better?}
//          → 201 {draft: Draft}; 404 when ANTHROPIC_API_KEY is unset; 409 when
//          the role is not allowed for this lead; 429 rate/daily cap.
// GET    /api/admin/sales/import → {batches: ImportBatch[]}
// POST   /api/admin/sales/import  multipart: file (CSV ≤5 MB, ≤10,000 rows),
//          preset: PresetKey, dryRun: "true"|"false", options: JSON ImportOptions
//          → {report: ImportReport, preview (first 20 mapped rows), headers}
//          (dryRun) or {report, batch} (commit).
// DELETE /api/admin/sales/import/[batch] → {deleted, kept} (rows with
//          activities or do-not-contact are kept).
// GET    /api/admin/sales/people → {people: Person[]}
// POST   /api/admin/sales/people  body: PersonInput → 201 {person}
// PATCH  /api/admin/sales/people/[id]  body: PersonInput (partial) → {person}
// GET    /api/admin/sales/suppressions?q → {suppressions} (newest 200)
// POST   /api/admin/sales/suppressions  body: {value: phone | email, reason?}
//          → 201 {suppression, leadsMarked}. Also marks matching leads DNC.
// GET    /api/admin/sales/export?(same filters as the list) → text/csv
// ---------------------------------------------------------------------------

export const SEGMENTS = ["cafe", "restaurant", "retail", "other"] as const;
export const PHONE_TYPES = ["business_listed", "mobile", "unknown"] as const;
export const PHONE_SOURCES = [
  "open_data", "shop_listing", "owner_gave_it", "card_at_visit", "inbound", "referral", "purchased_list", "people_search",
] as const;
export const EMAIL_SOURCES = ["public_on_site", "owner_gave_it", "verified_vendor", "guessed"] as const;
export const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;
export const CONTACT_ROUTES = ["counter", "manager", "email", "linkedin", "whatsapp", "phone"] as const;
export const PERSONAS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"] as const;
export const POS_SEEN = ["square", "toast", "clover", "other", "none", "unknown"] as const;
export const LOYALTY_NOW = ["paper", "square", "toast", "clover", "other", "none", "unknown"] as const;
export const STAGES = [
  "new", "researched", "contacted", "conversation", "demo", "pilot", "paid",
  "nurture", "lost", "closed_business", "franchisor_only", "waiting_l6",
] as const;
export const DNC_CHANNELS = ["call", "text", "email", "visit", "dm", "other"] as const;
export const NATIONAL_DNC = ["registered", "clear", "not_checked"] as const;
export const SMS_CONSENT = ["none", "informational", "marketing"] as const;
export const CONSENT_METHODS = ["written_form", "signed_pilot", "verbal_logged", "inbound_text"] as const;
export const RECORDING_CONSENT = ["accepted", "declined"] as const;
// The outreach channels checkContact() rules on (spec §4).
export const CHANNELS = ["walk_in", "call", "voicemail", "email", "text", "dm", "postcard"] as const;
export const ACTIVITY_KINDS = [...CHANNELS, "partner_intro", "note", "stage_change"] as const;
export const OUTCOMES = [
  "no_answer", "gatekeeper", "owner_spoke", "left_material", "booked", "demo",
  "pilot", "paid", "replied", "bounced", "no", "opt_out",
] as const;
export const PERSON_KINDS = ["rep", "partner"] as const;
export const PARTNER_TYPES = ["bookkeeper", "printer", "agency", "iso", "chamber", "merchant", "other"] as const;
export const DRAFT_ROLES = ["brief", "opener", "followup", "owner_email"] as const;

export type Segment = (typeof SEGMENTS)[number];
export type Stage = (typeof STAGES)[number];
export type Channel = (typeof CHANNELS)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type DncChannel = (typeof DNC_CHANNELS)[number];
export type DraftRole = (typeof DRAFT_ROLES)[number];

// A full sales_leads row (dates and timestamps as Postgres returns them).
export type Lead = {
  id: string;
  business_name: string;
  name_key: string;
  segment: Segment;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  cluster: string | null;
  phone: string | null;
  phone_type: (typeof PHONE_TYPES)[number];
  phone_source: (typeof PHONE_SOURCES)[number] | null;
  email: string | null;
  email_source: (typeof EMAIL_SOURCES)[number] | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  social_active: boolean | null;
  owner_name: string | null;
  owner_entity: string | null;
  owner_present: (typeof YES_NO_UNKNOWN)[number];
  owner_hours: string | null;
  owner_contact_route: (typeof CONTACT_ROUTES)[number] | null;
  persona: (typeof PERSONAS)[number] | null;
  language: string | null;
  pos_seen: (typeof POS_SEEN)[number] | null;
  loyalty_now: (typeof LOYALTY_NOW)[number] | null;
  franchise_brand: string | null;
  fdd_loyalty_vendor: (typeof YES_NO_UNKNOWN)[number];
  chain_size: number | null;
  opened_on: string | null;
  stage: Stage;
  lost_reason: string | null;
  assignee_id: string | null;
  sourced_by_id: string | null;
  referred_by_merchant_id: string | null;
  merchant_id: string | null;
  pilot_started_at: string | null;
  first_paid_at: string | null;
  month4_paid_at: string | null;
  source: string;
  source_id: string | null;
  source_pulled_at: string | null;
  import_batch: string | null;
  place_id: string | null;
  recipient_tz: string | null;
  next_action: string | null;
  next_action_at: string | null;
  last_contacted_at: string | null;
  do_not_contact: boolean;
  dnc_at: string | null;
  dnc_channel: DncChannel | null;
  dnc_note: string | null;
  email_unsubscribed: boolean;
  national_dnc_status: (typeof NATIONAL_DNC)[number];
  national_dnc_checked_at: string | null;
  sms_consent: (typeof SMS_CONSENT)[number];
  consent_text: string | null;
  consent_at: string | null;
  consent_method: (typeof CONSENT_METHODS)[number] | null;
  consent_phone: string | null;
  recording_consent: (typeof RECORDING_CONSENT)[number] | null;
  // generated: rough % that the phone / email reaches the owner (schema.sql)
  owner_phone_odds: number;
  owner_email_odds: number;
  created_at: string;
  updated_at: string;
};

// What GET /api/admin/sales/leads returns per row: the lead plus the names of
// its assignee and sourcer.
export type LeadListRow = Lead & {
  assignee: { id: string; name: string } | null;
  sourced_by: { id: string; name: string } | null;
};

export type Activity = {
  id: number;
  lead_id: string;
  person_id: string | null;
  kind: ActivityKind;
  outcome: Outcome | null;
  notes: string | null;
  occurred_at: string;
  created_at: string;
};

export type Person = {
  id: string;
  name: string;
  kind: (typeof PERSON_KINDS)[number];
  partner_type: (typeof PARTNER_TYPES)[number] | null;
  phone: string | null;
  email: string | null;
  payout_terms: string | null;
  active: boolean;
  started_on: string | null;
  notes: string | null;
  created_at: string;
};

export type Draft = {
  id: number;
  lead_id: string;
  role: DraftRole;
  model: string;
  body: string;
  flags: string[];
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};

export type Suppression = {
  value: string;
  kind: "phone" | "email";
  reason: string;
  lead_id: string | null;
  created_at: string;
};

export type ImportBatch = { batch: string; source: string; rows: number; imported_at: string };

export const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);
