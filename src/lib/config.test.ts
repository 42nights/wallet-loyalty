import { test } from "node:test";
import assert from "node:assert/strict";
import { REDEMPTIONS, ALL_ACTIONS, findAction } from "./config";

// Guards the locked decision (CLAUDE.md): the 4 redeem buttons stay fixed, and
// redemptions are always negative deltas. A regression here would mis-charge
// points at the counter.

test("there are exactly 4 redemption buttons", () => {
  assert.equal(REDEMPTIONS.length, 4);
});

test("every redemption is a negative-delta redeem with a unique id", () => {
  const ids = new Set<string>();
  for (const a of REDEMPTIONS) {
    assert.equal(a.kind, "redeem", `${a.id} must be a redeem`);
    assert.ok(a.points < 0, `${a.id} delta must be negative`);
    assert.ok(Number.isInteger(a.points), `${a.id} delta must be an integer`);
    assert.ok(!ids.has(a.id), `${a.id} duplicated`);
    ids.add(a.id);
  }
});

test("findAction resolves known ids and rejects unknown", () => {
  for (const a of REDEMPTIONS) {
    assert.equal(findAction(a.id), a);
  }
  assert.equal(findAction("does_not_exist"), undefined);
  assert.equal(findAction(""), undefined);
});

test("ALL_ACTIONS contains the redemptions", () => {
  for (const a of REDEMPTIONS) assert.ok(ALL_ACTIONS.includes(a), `${a.id} present`);
});
