import { canonicalTimezone } from "@/lib/config";
import { UUID_RE } from "@/lib/admin/merchant";
import { normalizePhone } from "@/app/api/enroll/validate";
import {
  CONSENT_METHODS, CONTACT_ROUTES, EMAIL_SOURCES, LOYALTY_NOW, NATIONAL_DNC, PARTNER_TYPES, PERSONAS,
  PERSON_KINDS, PHONE_SOURCES, PHONE_TYPES, POS_SEEN, RECORDING_CONSENT, SEGMENTS, SMS_CONSENT, STAGES,
  YES_NO_UNKNOWN, type Lead, type Person,
} from "./types";

// Input rules for sales leads and people: the API's trust boundary (create,
// PATCH, import). Pure. Strict mode returns the first error; lenient mode (CSV
// import) drops a bad value instead, so one odd cell never sinks a row.

type Rule = "text" | "long" | "date" | "ts" | "bool" | "int" | "uuid" | "phone" | "email" | "state" | "zip" | "tz" | readonly string[];

// Fields a request may set. Everything else on the row (id, name_key,
// do_not_contact, dnc_*, import_batch, last_contacted_at, timestamps, and the
// consent_at / national_dnc_checked_at stamps: rule 4 trusts the DNC date) is
// the server's, so it is silently stripped.
export const LEAD_RULES = {
  business_name: "text", segment: SEGMENTS, address: "text", city: "text", state: "state", zip: "zip",
  cluster: "text", phone: "phone", phone_type: PHONE_TYPES, phone_source: PHONE_SOURCES, email: "email",
  email_source: EMAIL_SOURCES, website: "text", instagram: "text", facebook: "text", social_active: "bool",
  owner_name: "text", owner_entity: "text", owner_present: YES_NO_UNKNOWN, owner_hours: "text",
  owner_contact_route: CONTACT_ROUTES, persona: PERSONAS, language: "text", pos_seen: POS_SEEN,
  loyalty_now: LOYALTY_NOW, franchise_brand: "text", fdd_loyalty_vendor: YES_NO_UNKNOWN, chain_size: "int",
  opened_on: "date", stage: STAGES, lost_reason: "text", assignee_id: "uuid", sourced_by_id: "uuid",
  referred_by_merchant_id: "uuid", merchant_id: "uuid", pilot_started_at: "ts", first_paid_at: "ts",
  month4_paid_at: "ts", source: "text", source_id: "text", source_pulled_at: "date", place_id: "text",
  recipient_tz: "tz", next_action: "text", next_action_at: "ts", email_unsubscribed: "bool",
  national_dnc_status: NATIONAL_DNC, sms_consent: SMS_CONSENT,
  consent_text: "long", consent_method: CONSENT_METHODS, consent_phone: "phone",
  recording_consent: RECORDING_CONSENT,
} as const satisfies Record<string, Rule>;

export type LeadKey = keyof typeof LEAD_RULES;
export type LeadInput = Partial<Pick<Lead, LeadKey>>;

const LEAD_NOT_NULL = new Set<string>([
  "business_name", "segment", "phone_type", "owner_present", "fdd_loyalty_vendor", "stage", "source",
  "email_unsubscribed", "national_dnc_status", "sms_consent",
]);

export const PERSON_RULES = {
  name: "text", kind: PERSON_KINDS, partner_type: PARTNER_TYPES, phone: "phone", email: "email",
  payout_terms: "text", active: "bool", started_on: "date", notes: "long",
} as const satisfies Record<string, Rule>;
export type PersonInput = Partial<Pick<Person, keyof typeof PERSON_RULES>>;
const PERSON_NOT_NULL = new Set<string>(["name", "kind", "active"]);

// Normalized name for dedupe (spec §3.3): lower-case, accents off, & → and,
// punctuation out (apostrophes vanish, so STARBUCK'S = starbucks), the words
// inc llc corp co the dropped, spaces collapsed.
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !["inc", "llc", "corp", "co", "the"].includes(w))
    .join(" ");
}

// A dialable number: E.164 via the enroll normalizer, and at least 10 digits.
// Placeholders such as "__________" or "91756477__" come back null.
export function salesPhone(raw: string): string | null {
  const p = normalizePhone(raw);
  return p && p.replace(/\D/g, "").length >= 10 ? p : null;
}

const STATE_NAMES: Record<string, string> = Object.fromEntries(
  ("AL alabama,AK alaska,AZ arizona,AR arkansas,CA california,CO colorado,CT connecticut,DE delaware," +
    "DC district of columbia,FL florida,GA georgia,HI hawaii,ID idaho,IL illinois,IN indiana,IA iowa,KS kansas," +
    "KY kentucky,LA louisiana,ME maine,MD maryland,MA massachusetts,MI michigan,MN minnesota,MS mississippi," +
    "MO missouri,MT montana,NE nebraska,NV nevada,NH new hampshire,NJ new jersey,NM new mexico,NY new york," +
    "NC north carolina,ND north dakota,OH ohio,OK oklahoma,OR oregon,PA pennsylvania,RI rhode island," +
    "SC south carolina,SD south dakota,TN tennessee,TX texas,UT utah,VT vermont,VA virginia,WA washington," +
    "WV west virginia,WI wisconsin,WY wyoming")
    .split(",")
    .map((s) => [s.slice(3), s.slice(0, 2)])
);

// "2023-05-01", "2023-05-01T00:00:00.000" (Socrata) or "5/1/2023" → "2023-05-01".
function toDate(v: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1], us[2]] : [];
  if (!y) return null;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return dt.getUTCMonth() === Number(m) - 1 && dt.getUTCDate() === Number(d) ? dt.toISOString().slice(0, 10) : null;
}

type Checked = { ok: true; value: unknown } | { ok: false; error: string };

function check(key: string, rule: Rule, raw: unknown): Checked {
  const bad = (what: string): Checked => ({ ok: false, error: `${key}: ${what}` });
  if (rule === "bool") {
    if (typeof raw === "boolean") return { ok: true, value: raw };
    if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
    return bad("must be true or false");
  }
  if (rule === "int") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 100_000 ? { ok: true, value: n } : bad("must be a whole number ≥ 1");
  }
  if (typeof raw !== "string" && typeof raw !== "number") return bad("must be text");
  // NUL and other control characters break the insert or the CSV; tabs and
  // newlines are kept only in long text.
  const s = String(raw)
    .replace(rule === "long" ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ")
    .trim();
  if (Array.isArray(rule)) {
    const hit = rule.find((x) => x.toLowerCase() === s.toLowerCase());
    return hit ? { ok: true, value: hit } : bad(`must be one of ${rule.join(", ")}`);
  }
  switch (rule) {
    case "text":
      return s.length <= (key === "business_name" ? 200 : 500) ? { ok: true, value: s } : bad("too long");
    case "long":
      return s.length <= 2000 ? { ok: true, value: s } : bad("too long");
    case "phone": {
      const p = salesPhone(s);
      return p ? { ok: true, value: p } : bad("not a valid phone number (10+ digits)");
    }
    case "email": {
      const e = s.toLowerCase();
      return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { ok: true, value: e } : bad("not a valid email");
    }
    case "state": {
      const code = /^[a-z]{2}$/i.test(s) ? s.toUpperCase() : STATE_NAMES[s.toLowerCase()];
      return code ? { ok: true, value: code } : bad("use a two-letter state code");
    }
    case "zip": {
      const z = /^(\d{5})(-?\d{4})?$/.exec(s);
      return z ? { ok: true, value: z[1] } : s.length <= 10 ? { ok: true, value: s } : bad("too long");
    }
    case "tz": {
      const tz = canonicalTimezone(s);
      return tz ? { ok: true, value: tz } : bad("unknown time zone");
    }
    case "date": {
      const d = toDate(s);
      return d ? { ok: true, value: d } : bad("use YYYY-MM-DD");
    }
    case "ts": {
      const t = Date.parse(s);
      return Number.isFinite(t) ? { ok: true, value: new Date(t).toISOString() } : bad("not a date-time");
    }
    case "uuid":
      return UUID_RE.test(s) ? { ok: true, value: s.toLowerCase() } : bad("not an id");
  }
  return bad("unknown field");
}

function validate(
  rules: Record<string, Rule>,
  notNull: Set<string>,
  input: Record<string, unknown>,
  lenient: boolean
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(rules)) {
    if (!(key in input) || input[key] === undefined) continue;
    const raw = input[key];
    if (raw === null || (typeof raw === "string" && !raw.trim())) {
      if (notNull.has(key)) {
        if (lenient) continue;
        return { ok: false, error: `${key} is required` };
      }
      out[key] = null;
      continue;
    }
    const r = check(key, rule, raw);
    if (r.ok) out[key] = r.value;
    else if (!lenient) return r;
  }
  return { ok: true, value: out };
}

export function leadFields(input: Record<string, unknown>, lenient = false) {
  return validate(LEAD_RULES, LEAD_NOT_NULL, input, lenient) as { ok: true; value: LeadInput } | { ok: false; error: string };
}

export function personFields(input: Record<string, unknown>) {
  return validate(PERSON_RULES, PERSON_NOT_NULL, input, false) as { ok: true; value: PersonInput } | { ok: false; error: string };
}
