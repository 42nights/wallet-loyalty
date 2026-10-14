import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsights, type DashboardData } from "./DashboardView";

// Points issued per day: 20 in the first half, 610 in the second.
const base: DashboardData = {
  stats: { members: 0, active_members: 0, points_issued: 0, points_redeemed: 0, top_redemptions: [], repeat_rate: 0 },
  seg: { counts: {}, customers: [] },
  staffRows: [],
  anomalies: [],
  funnel: { enrolled: 0, earned_once: 0, earned_3plus: 0, redeemed: 0 },
  ts: { bucket: "day", members: [], points: [10, 10, 10, 600].map((issued, i) => ({ t: `2026-10-0${i + 1}`, issued, redeemed: 0 })) },
  heat: [],
  days: "7",
  bucket: "day",
  theme: "dark",
  aiEnabled: false,
};
const growth = (d: DashboardData) => computeInsights(d).find((i) => i.text.startsWith("Points issued"));

test("a rise in points issued is shown as growth when nothing is flagged", () => {
  assert.equal(growth(base)?.dir, "up");
});

test("the same rise next to a staff over-issue flag is neutral and points at the outlier", () => {
  const g = growth({ ...base, anomalies: [{ kind: "staff_over_issue", severity: "warn", detail: { staff: "cashier", issued: 6000 } }] });
  assert.equal(g?.dir, "info");
  assert.match(g?.text ?? "", /staff outlier/);
});
