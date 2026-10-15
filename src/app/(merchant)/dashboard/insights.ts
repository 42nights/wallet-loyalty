import { unitLabel, type LoyaltyMode } from "@/lib/config";
import { segmentLabel } from "@/lib/segments";

// Dashboard data shapes and the plain-words logic (alerts, insights, shop
// clock). No JSX or CSS here, so node:test can load it.
export type Bucket = "day" | "week" | "month";
// The ranges and the buckets each allows (spec 6.1); page.tsx coerces the URL to these.
export const RANGES: Record<string, { label: string; buckets: Bucket[]; def: Bucket }> = {
  "7": { label: "7 days", buckets: ["day"], def: "day" },
  "30": { label: "30 days", buckets: ["day", "week"], def: "day" },
  "90": { label: "90 days", buckets: ["day", "week"], def: "week" },
  "365": { label: "12 months", buckets: ["week", "month"], def: "month" },
};
export type TopRedemption = { reason: string; count: number; points: number };
export type Stats = {
  members: number; active_members: number; points_issued: number;
  points_redeemed: number; top_redemptions: TopRedemption[]; repeat_rate: number;
};
export type SegCustomer = { serial: string; customer_name: string | null; segment: string; visits: number; recency_days: number | null };
export type Segments = { counts: Record<string, number>; customers: SegCustomer[] };
export type StaffRow = { username: string; role: string; txns: number; points_issued: number; points_redeemed: number };
export type Anomaly = { kind: string; severity: string; detail: { date?: string; points?: number; avg?: number; staff?: string; issued?: number } };
export type FunnelT = { enrolled: number; earned_once: number; earned_3plus: number; redeemed: number };
export type TimePoint = { t: string; issued: number; redeemed: number };
export type MemberPoint = { t: string; n: number };
export type TimeSeries = { bucket: string; members: MemberPoint[]; points: TimePoint[] };
export type HeatCell = { dow: number; hour: number; n: number };
export type TodayCounts = { visits: number; given: number; rewards: number; signups: number };
export type TopReward = { label: string; count: number; points: number };

export type DashboardData = {
  shop: string; date: string; time: string; weekday: string;
  localDate: string; // the shop's today as YYYY-MM-DD
  utcOffset: number; // shop clock minus UTC, in minutes, right now
  today: { now: TodayCounts; last: TodayCounts } | null;
  stats: Stats; seg: Segments; staffRows: StaffRow[]; anomalies: Anomaly[]; funnel: FunnelT;
  ts: TimeSeries; // the current range, one entry per bucket
  prev: { issued: number; redeemed: number; members: number }; // the range before it
  heat: HeatCell[]; // UTC, as activity_heatmap returns it
  topRewards: TopReward[];
  days: string; bucket: Bucket; mode: LoyaltyMode; aiEnabled: boolean;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Server component, so these run once on the server: no hydration mismatch.
export const nf = new Intl.NumberFormat("en-US").format;
// 1,070,775 → "1.1M" so a 7-digit value can't overflow a phone tile (the
// full number is in the tile's title). Below 100,000 the exact number fits.
export const COMPACT_FROM = 100_000;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format;
export const kpiNum = (n: number) => (n >= COMPACT_FROM ? compact(n) : nf(n));
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
export const utc = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(new Date(iso));
const list = (a: string[]) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
export const plural = (n: number, one: string, many: string) => `${nf(n)} ${n === 1 ? one : many}`;
export const Unit = (mode: LoyaltyMode) => (mode === "stamps" ? "Stamps" : "Points");
export const lastText = (days: string) => `last ${RANGES[days].label}`;
export const hourWords = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : `${h % 12} ${h < 12 ? "am" : "pm"}`);

// activity_heatmap buckets by UTC; the shop reads its own clock. One offset for
// the whole window, so the part of it across a DST switch is an hour off.
export function toShopClock(cells: HeatCell[], utcOffset: number): HeatCell[] {
  const shift = Math.round(utcOffset / 60);
  return cells.map(({ dow, hour, n }) => {
    const h = (((dow * 24 + hour + shift) % 168) + 168) % 168;
    return { dow: Math.floor(h / 24), hour: h % 24, n };
  });
}

// The alert bar: at most two lines, rewards first. Anomaly days are UTC days.
// West of UTC, after the shop's clock passes UTC midnight the newest day is a
// date the shop hasn't reached yet; all of it happened today, so it says so.
// The two most recent spikes are named, oldest first.
export function alertLines(d: Pick<DashboardData, "anomalies" | "mode" | "days" | "localDate">): string[] {
  const u = unitLabel(d.mode, 2);
  const out: string[] = [];
  const spikes = d.anomalies.filter((a) => a.kind === "redemption_spike")
    .sort((a, b) => (a.detail.date ?? "").localeCompare(b.detail.date ?? ""));
  if (spikes.length) {
    // A UTC day on or after the shop's local date is "today" there; merge them so one line never names both.
    const day = (iso = "") => (iso >= d.localDate ? "today" : utc(iso, { weekday: "short", month: "short", day: "numeric" }));
    const days: { label: string; points: number }[] = [];
    for (const a of spikes) {
      const label = day(a.detail.date);
      const last = days[days.length - 1];
      if (last?.label === label) last.points += a.detail.points ?? 0;
      else days.push({ label, points: a.detail.points ?? 0 });
    }
    const shown = days.slice(-2).map((x) => `${x.label} (${nf(x.points)} ${u})`);
    const rest = days.length - shown.length;
    const on = shown[0].startsWith("today") ? "" : "on ";
    out.push(`Unusually many rewards ${on}${list(shown)}${rest ? `, plus ${plural(rest, "earlier day", "earlier days")}` : ""}. A usual day is about ${nf(spikes[0].detail.avg ?? 0)} ${u}.`);
  }
  const staff = d.anomalies.filter((a) => a.kind === "staff_over_issue");
  if (staff.length === 1)
    out.push(`${staff[0].detail.staff} rang up a bill over 5× your usual one in the ${lastText(d.days)} and gave ${nf(staff[0].detail.issued ?? 0)} ${u} in all. Worth a look.`);
  else if (staff.length)
    out.push(`${list(staff.map((a) => a.detail.staff ?? ""))} each rang up a bill over 5× your usual one in the ${lastText(d.days)}. Worth a look.`);
  return out;
}

export type Insight = { dir: "up" | "down" | "info"; text: string };
const RANK: Record<Insight["dir"], number> = { down: 0, up: 1, info: 2 };
export const INS_ICON = { up: "arrow-up", down: "arrow-down", info: "info" } as const;
const MOST: Record<string, string> = { vip: "VIPs", regular: "Regulars", new: "new", active: "occasional visitors", at_risk: "at risk", lapsed: "lapsed" };

// Rule-based insights from the aggregates — no LLM needed for the headline
// trends. Warnings live in the alert bar, so these are trends and facts only.
export function computeInsights(d: DashboardData): Insight[] {
  const out: Insight[] = [];
  const prior = `the previous ${RANGES[d.days].label}`;

  const given = sum(d.ts.points.map((p) => p.issued));
  if (d.prev.issued > 0) {
    const p = Math.round(((given - d.prev.issued) / d.prev.issued) * 100);
    // Past 4× a percentage stops meaning anything ("up 6,697%"): show both numbers.
    const change = p > 300 ? `far above ${prior} (${nf(given)} vs ${nf(d.prev.issued)})` : `${p > 0 ? "up" : "down"} ${nf(Math.abs(p))}% on ${prior}`;
    // detect_anomalies covers the same window: a rise next to a staff
    // over-issue flag is no growth to celebrate, so it reads neutral.
    if (p > 0 && d.anomalies.some((a) => a.kind === "staff_over_issue"))
      out.push({ dir: "info", text: `${Unit(d.mode)} given are ${change}. Check the staff note above before reading it as growth.` });
    else if (p === 0) out.push({ dir: "info", text: `${Unit(d.mode)} given are level with ${prior}.` });
    else out.push({ dir: p > 0 ? "up" : "down", text: `${Unit(d.mode)} given are ${change}.` });
  }

  const heat = toShopClock(d.heat, d.utcOffset);
  if (heat.length) {
    const top = heat.reduce((a, b) => (b.n > a.n ? b : a));
    out.push({ dir: "info", text: `Busiest: ${DAY_NAMES[top.dow]}s around ${hourWords(top.hour)}.` });
  }

  const groups = Object.entries(d.seg.counts).filter(([k]) => k !== "dormant");
  if (groups.length) {
    const [k, v] = groups.reduce((a, b) => (b[1] > a[1] ? b : a));
    const total = sum(Object.values(d.seg.counts));
    out.push({
      dir: "info",
      text: v * 2 > total ? `Most of your customers (${nf(v)}) are ${MOST[k] ?? segmentLabel(k)}.` : `Your biggest group is ${segmentLabel(k)} (${plural(v, "customer", "customers")}).`,
    });
  }

  const f = d.funnel;
  const steps: Array<[number, number, (p: number) => string]> = [
    [f.enrolled, f.earned_once, (p) => `${p}% of sign-ups never come in for a first visit`],
    [f.earned_once, f.earned_3plus, (p) => `${p}% never get from their first visit to a third`],
    [f.earned_3plus, f.redeemed, (p) => `${p}% of customers with 3+ visits never claim a reward`],
  ];
  let worst: { p: number; text: string } | null = null;
  for (const [a, b, text] of steps) {
    const p = a > 0 ? Math.round((1 - b / a) * 100) : 0;
    if (p > (worst?.p ?? 0)) worst = { p, text: text(p) };
  }
  if (worst) out.push({ dir: worst.p >= 60 ? "down" : "info", text: `Biggest drop: ${worst.text}.` });

  if (d.stats.members > 0) {
    const r = pct(d.stats.active_members, d.stats.members);
    out.push({ dir: r >= 40 ? "up" : "down", text: `${r}% of customers visited in the last 30 days.` });
  }

  if (!out.length) return [{ dir: "info", text: "Not enough data yet. Check back after a few more visits." }];
  return out.sort((a, b) => RANK[a.dir] - RANK[b.dir]).slice(0, 4);
}
