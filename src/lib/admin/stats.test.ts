import { test } from "node:test";
import assert from "node:assert/strict";
import { health } from "./stats";

// F6: the overview once read "0 active" and tagged busy merchants NEW, because
// "new" (under 7 days old) won over activity.
const DAY = 86_400_000;
const now = Date.parse("2026-10-13T12:00:00Z");
const created = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
const last = (daysAgo: number) => now - daysAgo * DAY;

test("activity in the last 30 days is active at any age", () => {
  assert.equal(health(created(400), 50, last(29), now), "active");
  assert.equal(health(created(2), 50, last(0.01), now), "newActive");
});

test("no activity: new, empty or quiet", () => {
  assert.equal(health(created(2), 0, 0, now), "new");
  assert.equal(health(created(400), 0, 0, now), "empty");
  assert.equal(health(created(400), 50, last(31), now), "quiet");
  assert.equal(health(created(400), 50, 0, now), "quiet");
});
