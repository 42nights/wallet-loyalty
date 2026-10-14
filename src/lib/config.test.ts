import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REDEEM_TEMPLATES,
  REDEMPTIONS,
  ALL_ACTIONS,
  DEFAULT_TEMPLATE,
  findAction,
  redemptionsFor,
  templateKey,
  US_TIMEZONES,
  birthdayBonus,
  birthdaysOn,
  canonicalTimezone,
  describeHappyHour,
  happyHourMultiplier,
  localTime,
  parseHappyHour,
  type HappyHour,
} from "./config";

// Redeem buttons come from per-merchant templates. A regression here would
// mis-charge points at the counter or let one merchant redeem another
// template's reward.

test("every template has exactly 4 redeem buttons", () => {
  for (const [key, t] of Object.entries(REDEEM_TEMPLATES)) {
    assert.equal(t.actions.length, 4, `${key} must have 4 buttons`);
  }
});

test("every action is a negative-integer redeem and ids are unique across templates", () => {
  const ids = new Set<string>();
  for (const a of ALL_ACTIONS) {
    assert.equal(a.kind, "redeem", `${a.id} must be a redeem`);
    assert.ok(a.points < 0, `${a.id} delta must be negative`);
    assert.ok(Number.isInteger(a.points), `${a.id} delta must be an integer`);
    assert.ok(!ids.has(a.id), `${a.id} duplicated`);
    ids.add(a.id);
  }
});

test("the default template is the original restaurant set", () => {
  assert.equal(DEFAULT_TEMPLATE, "restaurant");
  assert.deepEqual(
    REDEMPTIONS.map((a) => [a.id, a.points]),
    [["drinks", -500], ["extra_side", -1000], ["fortune_cookie", -100], ["extra_sauce", -100]]
  );
});

test("unknown, missing or prototype-key templates fall back to the default", () => {
  for (const v of [undefined, null, "", "nope", "toString", "__proto__", 42]) {
    assert.equal(templateKey(v), DEFAULT_TEMPLATE, String(v));
  }
  assert.equal(templateKey("cafe"), "cafe");
});

test("redemptionsFor scopes buttons to the merchant's template", () => {
  const cafeIds = redemptionsFor("cafe").map((a) => a.id);
  assert.ok(cafeIds.includes("free_coffee"));
  assert.ok(!cafeIds.includes("drinks"), "a cafe merchant cannot redeem restaurant buttons");
  assert.ok(!redemptionsFor("restaurant").some((a) => a.id === "off_10"));
});

test("findAction resolves labels from any template and rejects unknown", () => {
  for (const a of ALL_ACTIONS) assert.equal(findAction(a.id), a);
  assert.equal(findAction("does_not_exist"), undefined);
  assert.equal(findAction(""), undefined);
});

// Earn boosters. Times are fixed UTC instants: 2026-10-14 is a Wednesday and
// Los Angeles is on PDT (UTC-7), New York on EDT (UTC-4).
test("happy hour is read on the shop's clock, end exclusive, and strictly validated", () => {
  const window = { days: [1, 2, 3, 4, 5], start: "15:00", end: "17:00", multiplier: 2 };
  const la = { happy_hour: window, timezone: "America/Los_Angeles" };
  assert.equal(happyHourMultiplier(la, new Date("2026-10-14T22:30:00Z")), 2, "Wed 3:30 pm in LA");
  assert.equal(happyHourMultiplier({ ...la, timezone: "America/New_York" }, new Date("2026-10-14T22:30:00Z")), 1, "6:30 pm in NY");
  assert.equal(happyHourMultiplier(la, new Date("2026-10-15T00:00:00Z")), 1, "5:00 pm sharp is outside");
  assert.equal(happyHourMultiplier(la, new Date("2026-10-18T22:30:00Z")), 1, "Sunday");
  assert.equal(happyHourMultiplier({ happy_hour: undefined }, new Date()), 1, "column missing");
  assert.equal(happyHourMultiplier({ happy_hour: { ...window, multiplier: 5 }, timezone: "x" }), 1, "malformed stored value");

  assert.deepEqual(parseHappyHour({ days: [5, 1], start: "09:05", end: "23:59", multiplier: 3 }), { days: [1, 5], start: "09:05", end: "23:59", multiplier: 3 });
  assert.equal(parseHappyHour(null), null);
  for (const bad of [
    [], "2x", { ...window, days: [] }, { ...window, days: [7] }, { ...window, days: [1, 1] }, { ...window, days: [1.5] },
    { ...window, start: "3pm" }, { ...window, end: "24:00" }, { ...window, start: "17:00", end: "15:00" },
    { ...window, start: "15:00", end: "15:00" }, { ...window, multiplier: 1.5 }, { ...window, multiplier: "2" },
    { ...window, extra: true },
  ])
    assert.equal(typeof parseHappyHour(bad), "string", JSON.stringify(bad));

  assert.equal(describeHappyHour(parseHappyHour(window) as HappyHour), "2× points Mon–Fri 3–5 pm");
  assert.equal(describeHappyHour({ days: [0, 6], start: "11:30", end: "13:00", multiplier: 3 }), "3× points Sat, Sun 11:30 am–1 pm");
  assert.equal(describeHappyHour({ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "02:00", multiplier: 2 }), "2× points every day 12–2 am");
});

test("birthdays: today on the shop's clock, Feb 29 on Feb 28 in common years, bonus = cheapest reward", () => {
  // 07:59 UTC on Mar 1 is still Feb 28 in Los Angeles (PST, UTC-8)
  const t = localTime("America/Los_Angeles", new Date("2026-03-01T07:59:00Z"));
  assert.deepEqual([t.year, t.month, t.day], [2026, 2, 28]);
  assert.deepEqual(birthdaysOn(t), ["2000-02-28", "2000-02-29"]);
  assert.deepEqual(birthdaysOn({ year: 2028, month: 2, day: 28 }), ["2000-02-28"]);
  assert.deepEqual(birthdaysOn({ year: 2028, month: 2, day: 29 }), ["2000-02-29"]);
  assert.deepEqual(birthdaysOn({ year: 2026, month: 3, day: 1 }), ["2000-03-01"]);

  assert.deepEqual(["cafe", "restaurant", "retail", "nope"].map((k) => birthdayBonus({ redeem_template: k })), [80, 100, 300, 100]);

  for (const z of US_TIMEZONES) assert.equal(canonicalTimezone(z.id), z.id);
  assert.equal(canonicalTimezone("america/chicago"), "America/Chicago");
  for (const bad of ["Mars/Olympus", "", null, 42]) assert.equal(canonicalTimezone(bad), null);
});
