import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { allRows } from "@/lib/admin/stats";
import {
  STAMP_REWARD_ID, findAction, loyaltyMode, localTime, merchantRedemptions, stampReward, timezoneOf,
} from "@/lib/config";
import DashboardView from "./DashboardView";
import {
  RANGES, type Bucket, type DashboardData, type Stats, type Segments, type StaffRow, type Anomaly,
  type FunnelT, type TimeSeries, type HeatCell, type TodayCounts, type TopReward,
} from "./insights";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Dashboard" };

const DAY = 86_400_000;
const EMPTY: Stats = { members: 0, active_members: 0, points_issued: 0, points_redeemed: 0, top_redemptions: [], repeat_rate: 0 };

// Bucket starts at or after `from`, as Postgres date_trunc makes them (UTC; ISO
// weeks start Monday), so a bucket with no rows still gets a zero on the chart.
function bucketStarts(bucket: Bucket, from: number, now: number): number[] {
  const f = new Date(from);
  const t = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), bucket === "month" ? 1 : f.getUTCDate()));
  if (bucket === "week") t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  const next = () => (bucket === "month" ? t.setUTCMonth(t.getUTCMonth() + 1) : t.setUTCDate(t.getUTCDate() + (bucket === "week" ? 7 : 1)));
  if (t.getTime() < from) next();
  const out: number[] = [];
  for (; t.getTime() <= now; next()) out.push(t.getTime());
  return out;
}

type Txn = { reason: string | null; delta: number };

// Today's counter numbers between two instants. Undone taps still count (the
// undo is its own row); the Today panel says so.
async function counts(m: string, a: number, b: number): Promise<TodayCounts> {
  const [a$, b$] = [new Date(a).toISOString(), new Date(b).toISOString()];
  const [rows, signups] = await Promise.all([
    allRows<Txn>((from, to) =>
      db.from("transactions").select("reason, delta").eq("merchant_id", m).gte("created_at", a$).lt("created_at", b$)
        .order("id").range(from, to).overrideTypes<Txn[], { merge: false }>()),
    db.from("passes").select("serial", { count: "exact", head: true }).eq("merchant_id", m).gte("created_at", a$).lt("created_at", b$),
  ]);
  if (signups.error) throw new Error(signups.error.message);
  const c: TodayCounts = { visits: 0, given: 0, rewards: 0, signups: signups.count ?? 0 };
  for (const r of rows) {
    if (r.reason?.startsWith("earn:")) { c.visits++; c.given += Math.max(0, r.delta); }
    else if (r.reason?.startsWith("redeem:")) c.rewards++;
  }
  return c;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; bucket?: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");
  const m = staff.merchantId;

  const sp = await searchParams;
  const days = sp.days && Object.hasOwn(RANGES, sp.days) ? sp.days : "30";
  const range = RANGES[days];
  const bucket = range.buckets.find((b) => b === sp.bucket) ?? range.def;
  const now = Date.now();
  const span = Number(days) * DAY;
  const from = now - span;
  const fromIso = new Date(from).toISOString();

  // "*": the stamp card and timezone columns may not exist yet
  const merchantP = Promise.resolve(db.from("merchants").select("*").eq("id", m).maybeSingle()).then((r) => r.data);
  const todayP = merchantP.then(async (mr) => {
    const t = localTime(timezoneOf(mr?.timezone), new Date(now));
    // shop-local midnight; on a DST-change day it is an hour off
    const start = now - t.minutes * 60_000 - (now % 60_000);
    const [cur, last] = await Promise.all([counts(m, start, now), counts(m, start - 7 * DAY, now - 7 * DAY)]);
    return { now: cur, last };
  }).catch((e: unknown) => {
    console.error("dashboard today failed:", e instanceof Error ? e.message : e);
    return null;
  });

  const [statsR, segR, staffR, anomR, funnelR, tsR, heatR, mr, today] = await Promise.all([
    db.rpc("merchant_stats", { p_merchant: m }),
    db.rpc("merchant_segments", { p_merchant: m }),
    db.rpc("staff_activity", { p_merchant: m, p_from: fromIso }),
    db.rpc("detect_anomalies", { p_merchant: m, p_from: fromIso }),
    db.rpc("redemption_funnel", { p_merchant: m }),
    // twice the range: the half before `from` is the previous period for the deltas
    db.rpc("merchant_timeseries", { p_merchant: m, p_bucket: bucket === "day" ? "hour" : bucket, p_from: new Date(from - span).toISOString() }),
    db.rpc("activity_heatmap", { p_merchant: m, p_from: fromIso }),
    merchantP,
    todayP,
  ]);

  const tz = timezoneOf(mr?.timezone);
  const lt = localTime(tz, new Date(now));
  const utcOffset = Math.round((Date.UTC(lt.year, lt.month - 1, lt.day) + lt.minutes * 60_000 - (now - (now % 60_000))) / 60_000);
  const mode = loyaltyMode(mr?.loyalty_mode);
  const stats = (statsR.data as Stats | null) ?? EMPTY;
  const raw = (tsR.data as TimeSeries | null) ?? { bucket, members: [], points: [] };

  // Days come back hourly and are regrouped on the shop's clock, so the chart's
  // last day is the shop's today. Weeks and months stay UTC (a few hours off at
  // their edges). Keys are shop-local midnights written as UTC instants.
  const off = bucket === "day" ? utcOffset * 60_000 : 0;
  const key = (t: number) => (off ? t + off - ((t + off) % DAY) : t);
  const lo = from + off;
  const issued = new Map<number, number>(), redeemed = new Map<number, number>(), joined = new Map<number, number>();
  const add = (into: Map<number, number>, k: number, v: number) => into.set(k, (into.get(k) ?? 0) + v);
  const prev = { issued: 0, redeemed: 0, members: 0 };
  for (const p of raw.points) {
    const k = key(Date.parse(p.t));
    if (k >= lo) { add(issued, k, p.issued); add(redeemed, k, p.redeemed); }
    else if (k >= lo - span) { prev.issued += p.issued; prev.redeemed += p.redeemed; }
  }
  for (const p of raw.members) {
    const k = key(Date.parse(p.t));
    if (k >= lo) add(joined, k, p.n);
    else if (k >= lo - span) prev.members += p.n;
  }
  const starts = bucketStarts(bucket, lo, now + off);
  const ts: TimeSeries = {
    bucket,
    points: starts.map((t) => ({ t: new Date(t).toISOString(), issued: issued.get(t) ?? 0, redeemed: redeemed.get(t) ?? 0 })),
    members: starts.map((t) => ({ t: new Date(t).toISOString(), n: joined.get(t) ?? 0 })),
  };

  // Every reward the shop offers, claimed or not, plus any older ones still in the ledger.
  const claimed = new Map(stats.top_redemptions.map((r) => [r.reason.slice("redeem:".length), r]));
  const ids = [...new Set([...merchantRedemptions(mr ?? {}).map((a) => a.id), ...claimed.keys()])];
  const topRewards: TopReward[] = ids
    .map((id) => ({
      label: id === STAMP_REWARD_ID ? stampReward(mr?.stamp_reward) : findAction(id)?.label ?? id,
      count: claimed.get(id)?.count ?? 0,
      points: claimed.get(id)?.points ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  const data: DashboardData = {
    shop: mr?.name ?? "Your shop",
    date: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(now),
    time: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(now),
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now),
    localDate: new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now),
    utcOffset,
    today,
    stats,
    seg: (segR.data as Segments | null) ?? { counts: {}, customers: [] },
    staffRows: (staffR.data as StaffRow[] | null) ?? [],
    anomalies: (anomR.data as Anomaly[] | null) ?? [],
    funnel: (funnelR.data as FunnelT | null) ?? { enrolled: 0, earned_once: 0, earned_3plus: 0, redeemed: 0 },
    ts, prev,
    heat: (heatR.data as HeatCell[] | null) ?? [],
    topRewards,
    days, bucket, mode,
    // Decided here, not in the browser: without a key the AI routes can only
    // fail, so the command bar and digest card aren't shown at all.
    aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  return <DashboardView data={data} />;
}
