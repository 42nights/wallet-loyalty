import { DEFAULT_TIMEZONE, localTime } from "@/lib/config";
import type { ActivityKind, DraftRole, Outcome, Stage } from "@/lib/sales/types";

// Plain-English labels for the Sales pages. Pure: server and client share it.

// "business_listed" → "Business listed"
export const human = (v: string | null | undefined) => (v ? (v[0].toUpperCase() + v.slice(1)).replace(/_/g, " ") : "");

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New", researched: "Researched", contacted: "Contacted", conversation: "Talking", demo: "Demo", pilot: "Pilot",
  paid: "Paying", nurture: "Nurture", lost: "Lost", closed_business: "Shop closed", franchisor_only: "Franchisor only",
  waiting_l6: "Waiting for multi-location",
};

export const KIND_LABEL: Record<ActivityKind, string> = {
  walk_in: "Visit", call: "Call", voicemail: "Voicemail", email: "Email", text: "Text", dm: "DM", postcard: "Postcard",
  partner_intro: "Partner intro", note: "Note", stage_change: "Stage change",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  no_answer: "No answer", gatekeeper: "Spoke to staff", owner_spoke: "Spoke to the owner", left_material: "Left material",
  booked: "Booked a visit", demo: "Gave a demo", pilot: "Started a pilot", paid: "Started paying", replied: "They replied",
  bounced: "Bounced", no: "Said no", opt_out: "Opted out",
};

export const PERSONA_LABEL: Record<string, string> = {
  P1: "P1 · Family operator", P2: "P2 · Semi-absentee owner", P3: "P3 · Career owner-operator",
  P4: "P4 · Mini-chain (2-5 shops)", P5: "P5 · Single-unit franchisee", P6: "P6 · Emerging franchisor",
  P7: "P7 · Multi-unit franchisee",
};

export const ROLE_LABEL: Record<DraftRole, { name: string; what: string }> = {
  brief: { name: "Call prep", what: "5 lines: the shop, persona, reward set, likely objection and the answer, best window" },
  opener: { name: "Opener", what: "One counter or phone opener, under 80 words" },
  followup: { name: "Follow-up email", what: "A recap after the last logged touch" },
  owner_email: { name: "Owner email", what: "For an owner who isn't in every day (P2)" },
};

// The AI panel's fixed text, kept out of lib/sales/ai.ts so the prompts never
// ship to the browser. The draft route answers with AI_OFF too.
export const AI_OFF = "AI drafting is off: set ANTHROPIC_API_KEY";
export const AI_CAPTION = "Drafts from your notes only. Check names and facts. Nothing is sent. AI cannot call or text anyone.";
// postCheck()'s flags, in words.
export const FLAG_TEXT: Record<string, string> = {
  price: "Contains a price: remove before sending.",
  speed: "Claims speed: remove before sending.",
  planned: "Mentions a Planned feature (Android, NFC, texting, POS): remove before sending.",
  unfilled: "Has [blanks] for you to fill in.",
};

// "Oct 14, 3:05 PM" on Ayaan's clock: the same text from the server and the
// browser, so hydration never disagrees.
export const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: DEFAULT_TIMEZONE })
    : "";

// Date-time inputs are on Ayaan's clock too (labelled Pacific), not the
// browser's: ISO ↔ a datetime-local value ("2026-10-14T15:05").
const pad = (n: number) => String(n).padStart(2, "0");
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const l = localTime(DEFAULT_TIMEZONE, new Date(iso));
  return `${l.year}-${pad(l.month)}-${pad(l.day)}T${pad(Math.floor(l.minutes / 60))}:${pad(l.minutes % 60)}`;
}
export function fromLocalInput(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const l = localTime(DEFAULT_TIMEZONE, new Date(guess));
  return new Date(2 * guess - (Date.UTC(l.year, l.month - 1, l.day) + l.minutes * 60_000)).toISOString();
}
