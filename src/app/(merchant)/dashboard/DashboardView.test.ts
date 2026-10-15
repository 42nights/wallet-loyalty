import { test } from "node:test";
import assert from "node:assert/strict";
import { alertLines, computeInsights, type DashboardData } from "./insights";

// 630 points given this period against 300 in the period before.
const base: DashboardData = {
  shop: "Test", date: "", time: "", weekday: "Wed", localDate: "2026-10-14", utcOffset: 0, today: null,
  stats: { members: 0, active_members: 0, points_issued: 0, points_redeemed: 0, top_redemptions: [], repeat_rate: 0 },
  seg: { counts: {}, customers: [] },
  staffRows: [],
  anomalies: [],
  funnel: { enrolled: 0, earned_once: 0, earned_3plus: 0, redeemed: 0 },
  ts: { bucket: "day", members: [], points: [10, 10, 10, 600].map((issued, i) => ({ t: `2026-10-0${i + 1}`, issued, redeemed: 0 })) },
  prev: { issued: 300, redeemed: 0, members: 0 },
  heat: [],
  topRewards: [],
  days: "7",
  bucket: "day",
  mode: "points",
  aiEnabled: false,
};
const growth = (d: DashboardData) => computeInsights(d).find((i) => i.text.startsWith("Points given"));

test("a rise in points given on the previous period is shown as growth when nothing is flagged", () => {
  assert.equal(growth(base)?.dir, "up");
  assert.equal(growth(base)?.text, "Points given are up 110% on the previous 7 days.");
});

test("the same rise next to a staff over-issue flag is neutral and points at the outlier", () => {
  const g = growth({ ...base, anomalies: [{ kind: "staff_over_issue", severity: "warn", detail: { staff: "cashier", issued: 6000 } }] });
  assert.equal(g?.dir, "info");
  assert.match(g?.text ?? "", /staff note/);
});

test("the busiest slot is named on the shop's clock, not UTC", () => {
  // Wednesday 19:00 UTC is noon in Los Angeles in October (UTC-7)
  const heat = [{ dow: 3, hour: 19, n: 52 }, { dow: 1, hour: 15, n: 10 }];
  const busiest = computeInsights({ ...base, heat, utcOffset: -420 }).find((i) => i.text.startsWith("Busiest"));
  assert.equal(busiest?.text, "Busiest: Wednesdays around noon.");
});

test("a jump past 4x names both totals instead of a runaway percentage", () => {
  assert.equal(growth({ ...base, prev: { ...base.prev, issued: 9 } })?.text, "Points given are far above the previous 7 days (630 vs 9).");
});

test("a spike on a UTC day the shop hasn't reached yet reads as today, never a future date", () => {
  const spike = (date: string, points: number) => ({ kind: "redemption_spike", severity: "warn", detail: { date, points, avg: 16 } });
  const line = (anomalies: DashboardData["anomalies"]) => alertLines({ anomalies, mode: "stamps", days: "30", localDate: "2026-10-14" })[0];
  assert.equal(line([spike("2026-10-15", 41)]), "Unusually many rewards today (41 stamps). A usual day is about 16 stamps.");
  assert.equal(line([spike("2026-10-15", 41), spike("2026-10-12", 30)]), "Unusually many rewards on Mon, Oct 12 (30 stamps) and today (41 stamps). A usual day is about 16 stamps.");
});
