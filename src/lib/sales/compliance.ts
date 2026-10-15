import { localTime, type US_TIMEZONES } from "@/lib/config";
import { CHANNELS, isOneOf, type Activity, type Channel, type Lead, type Stage } from "./types";

// The outreach compliance engine (admin-sales spec §4; strategy §6). Pure, no
// I/O: the activity form calls it to disable buttons and the activities API
// calls it again and answers 409 with `reason`, so the UI is never the only
// gate. Statements about law are orientation, not legal advice.

export type LeadCompliance = Pick<
  Lead,
  | "do_not_contact" | "dnc_at" | "dnc_channel" | "phone" | "phone_type" | "phone_source"
  | "national_dnc_status" | "national_dnc_checked_at" | "sms_consent" | "consent_phone"
  | "consent_method" | "state" | "recipient_tz" | "email_unsubscribed" | "email_source"
  | "segment" | "recording_consent" | "stage" | "franchise_brand" | "fdd_loyalty_vendor"
> & {
  // The lead's phone or email is in sales_suppressions (the caller looks it up).
  suppressed: boolean;
};

export type Recent = {
  callsToday: number; // calls + voicemails on the recipient's calendar day
  callsThisWeek: number; // calls + voicemails in the last 7 days
  touchesNoReply: number; // outreach since the last reply (90-day window)
  ownerMissedVisits?: number; // latest walk-ins in a row without the owner
};

export type ContactContext = {
  postalAddressSet: boolean; // SALES_POSTAL_ADDRESS (CAN-SPAM footer) is set
  recorded?: boolean; // the person ticked "this call is recorded"
};

export type Verdict = { allowed: boolean; reason?: string; warnings: string[] };

type Zone = (typeof US_TIMEZONES)[number]["id"];
const E: Zone = "America/New_York", C: Zone = "America/Chicago", M: Zone = "America/Denver";
const P: Zone = "America/Los_Angeles";

// State → its default zone. Multi-zone states take their largest metro's zone
// and the caller shows "check zone"; recipient_tz on the lead overrides both.
const STATE_TZ: Record<string, Zone> = {
  CT: E, DE: E, DC: E, FL: E, GA: E, IN: E, KY: E, ME: E, MD: E, MA: E, MI: E, NH: E, NJ: E,
  NY: E, NC: E, OH: E, PA: E, RI: E, SC: E, VT: E, VA: E, WV: E,
  AL: C, AR: C, IL: C, IA: C, KS: C, LA: C, MN: C, MS: C, MO: C, NE: C, ND: C, OK: C, SD: C,
  TN: C, TX: C, WI: C,
  CO: M, ID: M, MT: M, NM: M, UT: M, WY: M,
  AZ: "America/Phoenix", CA: P, NV: P, OR: P, WA: P, AK: "America/Anchorage", HI: "Pacific/Honolulu",
};
const MULTI_ZONE = new Set(["AK", "FL", "ID", "IN", "KS", "KY", "MI", "ND", "NE", "OR", "SD", "TN", "TX"]);

export function stateTimezone(state: string | null): Zone | null {
  return (state && STATE_TZ[state.toUpperCase()]) || null;
}

// The zone a call is judged in: the lead's own, else the state default.
export function recipientZone(lead: Pick<Lead, "recipient_tz" | "state">): { tz: string | null; checkZone: boolean } {
  if (lead.recipient_tz) return { tz: lead.recipient_tz, checkZone: false };
  const tz = stateTimezone(lead.state);
  return { tz, checkZone: !!tz && MULTI_ZONE.has(lead.state!.toUpperCase()) };
}

// Best walk-in / call windows, recipient local time, in minutes (strategy §4.2).
export const BEST_WINDOWS: Partial<Record<Lead["segment"], [number, number]>> = {
  restaurant: [14 * 60 + 30, 16 * 60 + 30],
  cafe: [13 * 60 + 30, 15 * 60],
  retail: [10 * 60, 12 * 60],
};

export const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// "best 14:30-16:30 · recipient local time now 15:10" for the Today list.
export function callWindowHint(lead: Pick<Lead, "segment" | "recipient_tz" | "state">, now: Date): string {
  const { tz } = recipientZone(lead);
  const w = BEST_WINDOWS[lead.segment];
  const best = w ? `best ${hhmm(w[0])}-${hhmm(w[1])}` : "no best window";
  return tz ? `${best} · recipient local time now ${hhmm(localTime(tz, now).minutes)}` : `${best} · set the time zone`;
}

const DNC_MAX_AGE_DAYS = 31;
const DAY_MS = 86_400_000;

function dncCheckFresh(lead: LeadCompliance, now: Date): boolean {
  if (lead.national_dnc_status !== "clear" || !lead.national_dnc_checked_at) return false;
  const checked = Date.parse(`${lead.national_dnc_checked_at.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(checked) && now.getTime() - checked <= DNC_MAX_AGE_DAYS * DAY_MS;
}

export function checkContact(
  lead: LeadCompliance,
  channel: Channel,
  now: Date,
  recent: Recent,
  ctx: ContactContext
): Verdict {
  const block = (reason: string): Verdict => ({ allowed: false, reason, warnings: [] });
  const phoneCall = channel === "call" || channel === "voicemail";
  const zone = recipientZone(lead);
  const state = lead.state?.toUpperCase() ?? null;

  // 1. Opt-outs are global and permanent: every channel, forever.
  if (lead.do_not_contact)
    return block(
      `Do-not-contact since ${lead.dnc_at ? lead.dnc_at.slice(0, 10) : "an unknown date"} ` +
        `(${lead.dnc_channel ?? "unknown channel"}). Never contact again.`
    );

  if (channel === "text") {
    // 2. Consent is per number: a yes logged for another number counts for nothing.
    if (lead.sms_consent === "none" || !lead.phone || lead.consent_phone !== lead.phone)
      return block("No logged text consent for this number.");
    // 3. RCW 19.190.040 has no B2B exemption.
    if (state === "WA" && lead.consent_method !== "written_form" && lead.consent_method !== "signed_pilot")
      return block("Washington: texts need written consent.");
  }

  if (phoneCall) {
    // 4. Mobile or unknown numbers are treated as residential.
    if (lead.phone_type !== "business_listed" && !dncCheckFresh(lead, now))
      return block("Mobile/unknown number: run a National DNC check first (≤31 days old).");
    // 5. Quiet hours on the recipient's clock.
    if (!zone.tz) return block("Set the recipient's time zone.");
    const t = localTime(zone.tz, now).minutes;
    if (t < 9 * 60 || t >= 20 * 60) return block(`Quiet hours: it is ${hhmm(t)} for them. Calls 9:00-20:00 only.`);
    // 6. Frequency cap per number. A voicemail is a dialled call too.
    if (recent.callsToday >= 1 || recent.callsThisWeek >= 3) return block("Max 1 call a day and 3 a week per number.");
  }

  // 7. CAN-SPAM: the footer needs a postal address; never guessed addresses.
  if (channel === "email") {
    const why = lead.email_unsubscribed || lead.suppressed
      ? "unsubscribed"
      : lead.email_source === "guessed"
        ? "guessed address"
        : !ctx.postalAddressSet
          ? "no CAN-SPAM address set"
          : null;
    if (why) return block(`Email blocked: ${why}.`);
  }

  // 8. The sequence is 7 touches over 14 days; after 6 with no reply, stop.
  if (recent.touchesNoReply >= 6) return block("Sequence finished (6 touches, no reply). Move to nurture.");

  const warnings: string[] = [];
  if ((channel === "walk_in" || channel === "call") && zone.tz) {
    const w = BEST_WINDOWS[lead.segment];
    const t = localTime(zone.tz, now).minutes;
    if (w && (t < w[0] || t >= w[1]))
      warnings.push(`Outside the best window (${hhmm(w[0])}-${hhmm(w[1])} their time; now ${hhmm(t)}).`);
  }
  if (phoneCall && zone.checkZone) warnings.push(`Time zone guessed from ${state}: check zone.`);
  if ((phoneCall || channel === "text") && (state === "TX" || state === "OK"))
    warnings.push("Book the visit only. No price, no close, no payment on the phone.");
  if (phoneCall && state === "MD") warnings.push("Maryland: 8am-8pm, max 3 calls/24h.");
  if (channel === "call" && ctx.recorded && !lead.recording_consent)
    warnings.push("Recorded call: announce the recording at the start and log their answer.");
  if (channel === "walk_in" && (recent.ownerMissedVisits ?? 0) >= 2)
    warnings.push("Probably semi-absentee (P2). Use the manager hand-off script.");
  if ((phoneCall || channel === "text") && (lead.phone_source === "people_search" || lead.phone_source === "purchased_list"))
    warnings.push("Personal number: hand-dial only after the DNC check; never text.");
  return { allowed: true, warnings };
}

// A stage change. A do-not-contact lead stays Lost: the stage is locked, like
// every channel. 9. A franchise unit cannot become a pilot until the FDD
// check clears it.
export const DNC_LOCKED = "This lead is do-not-contact.";
export function checkStage(
  lead: Pick<Lead, "stage" | "franchise_brand" | "fdd_loyalty_vendor" | "do_not_contact">,
  stage: Stage
): string | null {
  if (lead.do_not_contact) return DNC_LOCKED;
  if (stage === "pilot" && (lead.stage === "franchisor_only" || (lead.franchise_brand && lead.fdd_loyalty_vendor !== "no")))
    return "Franchise: needs FDD check and franchisor approval first.";
  return null;
}

const REPLY_OUTCOMES = new Set(["owner_spoke", "booked", "demo", "pilot", "paid", "replied"]);
const MISSED_OUTCOMES = new Set(["no_answer", "gatekeeper", "left_material"]);
const SEQUENCE_WINDOW_DAYS = 90;

// The `recent` counts from a lead's activities (pass at least the last 90
// days). Touches older than 90 days don't count, so a nurture lead can be
// tried again "in a few months" (script D).
export function recentFromActivities(
  activities: Pick<Activity, "kind" | "outcome" | "occurred_at">[],
  now: Date,
  tz: string | null
): Recent {
  const zone = tz ?? "UTC";
  const today = localTime(zone, now);
  const sameDay = (d: Date) => {
    const l = localTime(zone, d);
    return l.year === today.year && l.month === today.month && l.day === today.day;
  };
  const sorted = [...activities].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const r: Recent = { callsToday: 0, callsThisWeek: 0, touchesNoReply: 0, ownerMissedVisits: 0 };
  let replied = false;
  let streak = true;
  for (const a of sorted) {
    const at = new Date(a.occurred_at);
    const age = now.getTime() - at.getTime();
    if (a.kind === "call" || a.kind === "voicemail") {
      if (sameDay(at)) r.callsToday++;
      if (age <= 7 * DAY_MS) r.callsThisWeek++;
    }
    if (a.outcome && REPLY_OUTCOMES.has(a.outcome)) replied = true;
    if (!replied && isOneOf(CHANNELS, a.kind) && age <= SEQUENCE_WINDOW_DAYS * DAY_MS) r.touchesNoReply++;
    if (streak && a.kind === "walk_in") {
      if (a.outcome && MISSED_OUTCOMES.has(a.outcome)) r.ownerMissedVisits!++;
      else streak = false;
    }
  }
  return r;
}
