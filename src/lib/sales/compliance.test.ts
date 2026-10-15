import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContact, checkStage, recentFromActivities, type LeadCompliance, type Recent } from "./compliance";
import { CHANNELS, type Channel } from "./types";

// 15:00 in New York (EDT): inside quiet hours and the café window.
const NOW = new Date("2026-10-14T19:00:00Z");
const OK_CTX = { postalAddressSet: true };
const NONE: Recent = { callsToday: 0, callsThisWeek: 0, touchesNoReply: 0 };

// A lead every channel may contact. Each test changes one thing.
const base: LeadCompliance = {
  do_not_contact: false, dnc_at: null, dnc_channel: null,
  phone: "+12125550100", phone_type: "business_listed", phone_source: "open_data",
  national_dnc_status: "not_checked", national_dnc_checked_at: null,
  sms_consent: "marketing", consent_phone: "+12125550100", consent_method: "written_form",
  state: "NY", recipient_tz: "America/New_York",
  email_unsubscribed: false, email_source: "public_on_site", segment: "cafe",
  recording_consent: null, stage: "contacted", franchise_brand: null, fdd_loyalty_vendor: "unknown",
  suppressed: false,
};

const verdict = (patch: Partial<LeadCompliance>, ch: Channel, recent = NONE, now = NOW, ctx = OK_CTX) =>
  checkContact({ ...base, ...patch }, ch, now, recent, ctx);

const blocked = (v: ReturnType<typeof checkContact>, reason: RegExp) => {
  assert.equal(v.allowed, false);
  assert.match(v.reason ?? "", reason);
};

test("the base lead may be contacted on every channel", () => {
  for (const ch of CHANNELS) assert.equal(verdict({}, ch).allowed, true, ch);
});

test("rule 1: do-not-contact blocks every channel", () => {
  for (const ch of CHANNELS)
    blocked(verdict({ do_not_contact: true, dnc_at: "2026-10-01T10:00:00Z", dnc_channel: "email" }, ch), /^Do-not-contact since 2026-10-01 \(email\)/);
});

test("rule 2: no text without consent for this exact number", () => {
  blocked(verdict({ sms_consent: "none" }, "text"), /No logged text consent/);
  blocked(verdict({ consent_phone: "+12125550199" }, "text"), /No logged text consent/);
});

test("rule 3: Washington texts need written consent", () => {
  blocked(verdict({ state: "WA", recipient_tz: "America/Los_Angeles", consent_method: "verbal_logged" }, "text"), /Washington/);
  assert.equal(verdict({ state: "WA", recipient_tz: "America/Los_Angeles", consent_method: "signed_pilot" }, "text").allowed, true);
});

test("rule 4: mobile/unknown numbers need a National DNC check at most 31 days old", () => {
  for (const ch of ["call", "voicemail"] as const) {
    blocked(verdict({ phone_type: "mobile" }, ch), /National DNC check/);
    blocked(verdict({ phone_type: "unknown", national_dnc_status: "clear", national_dnc_checked_at: "2026-09-01" }, ch), /National DNC check/);
    assert.equal(verdict({ phone_type: "unknown", national_dnc_status: "clear", national_dnc_checked_at: "2026-10-01" }, ch).allowed, true);
  }
});

test("rule 5: calls only 9:00-20:00 on the recipient's clock", () => {
  // 21:00 in New York.
  blocked(verdict({}, "call", NONE, new Date("2026-10-15T01:00:00Z")), /Quiet hours: it is 21:00 for them/);
  // No zone and no state: block rather than guess.
  blocked(verdict({ recipient_tz: null, state: null }, "voicemail"), /time zone/);
  // The state default is used when recipient_tz is empty.
  assert.equal(verdict({ recipient_tz: null }, "call").allowed, true);
});

test("rule 6: at most 1 call a day and 3 a week per number", () => {
  blocked(verdict({}, "call", { ...NONE, callsToday: 1 }), /Max 1 call a day/);
  blocked(verdict({}, "call", { ...NONE, callsThisWeek: 3 }), /Max 1 call a day/);
});

test("rule 7: email blocked when unsubscribed, suppressed, guessed or without a postal address", () => {
  blocked(verdict({ email_unsubscribed: true }, "email"), /Email blocked: unsubscribed/);
  blocked(verdict({ suppressed: true }, "email"), /Email blocked: unsubscribed/);
  blocked(verdict({ email_source: "guessed" }, "email"), /Email blocked: guessed address/);
  blocked(verdict({}, "email", NONE, NOW, { postalAddressSet: false }), /no CAN-SPAM address set/);
});

test("rule 8: six touches with no reply finish the sequence", () => {
  for (const ch of CHANNELS) blocked(verdict({}, ch, { ...NONE, touchesNoReply: 6 }), /Sequence finished/);
});

test("rule 9: a franchise unit cannot become a pilot before the FDD check", () => {
  assert.match(checkStage({ ...base, stage: "franchisor_only" }, "pilot") ?? "", /Franchise/);
  assert.match(checkStage({ ...base, franchise_brand: "Bean Co", fdd_loyalty_vendor: "unknown" }, "pilot") ?? "", /Franchise/);
  assert.equal(checkStage({ ...base, franchise_brand: "Bean Co", fdd_loyalty_vendor: "no" }, "pilot"), null);
  assert.equal(checkStage({ ...base, stage: "lost", do_not_contact: true }, "demo"), "This lead is do-not-contact.");
});

test("recent counts: today's calls, the week, touches since the last reply", () => {
  const at = (iso: string, kind: string, outcome: string | null = null) =>
    ({ occurred_at: iso, kind, outcome }) as Parameters<typeof recentFromActivities>[0][number];
  const r = recentFromActivities(
    [
      at("2026-10-14T14:00:00Z", "call", "no_answer"), // 10:00 NY today
      at("2026-10-14T03:00:00Z", "voicemail"), // 23:00 NY yesterday
      at("2026-10-10T18:00:00Z", "walk_in", "gatekeeper"),
      at("2026-10-09T18:00:00Z", "walk_in", "left_material"),
      at("2026-10-01T18:00:00Z", "walk_in", "owner_spoke"),
      at("2026-09-30T18:00:00Z", "email"),
    ],
    NOW,
    "America/New_York"
  );
  assert.deepEqual(r, { callsToday: 1, callsThisWeek: 2, touchesNoReply: 4, ownerMissedVisits: 2 });
});
