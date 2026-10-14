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
