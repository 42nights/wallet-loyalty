import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import DashboardView, {
  DashboardData, Stats, Segments, StaffRow, Anomaly, FunnelT, TimeSeries, HeatCell,
} from "./DashboardView";

export const runtime = "nodejs";

const EMPTY: Stats = { members: 0, active_members: 0, points_issued: 0, points_redeemed: 0, top_redemptions: [], repeat_rate: 0 };
const RANGES = new Set(["7", "30", "90", "365"]);
const BUCKETS = new Set(["day", "week", "month"]);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; bucket?: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan");
  const m = staff.merchantId;

  const sp = await searchParams;
  const days = RANGES.has(sp.days ?? "") ? (sp.days as string) : "30";
  const bucket = BUCKETS.has(sp.bucket ?? "") ? (sp.bucket as string) : "day";
  const from = new Date(Date.now() - Number(days) * 86_400_000).toISOString();

  const theme = ((await cookies()).get("theme")?.value === "light" ? "light" : "dark") as "light" | "dark";

  const [statsR, segR, staffR, anomR, funnelR, tsR, heatR] = await Promise.all([
    db.rpc("merchant_stats", { p_merchant: m }),
    db.rpc("merchant_segments", { p_merchant: m }),
    db.rpc("staff_activity", { p_merchant: m, p_from: from }),
    db.rpc("detect_anomalies", { p_merchant: m, p_from: from }),
    db.rpc("redemption_funnel", { p_merchant: m }),
    db.rpc("merchant_timeseries", { p_merchant: m, p_bucket: bucket, p_from: from }),
    db.rpc("activity_heatmap", { p_merchant: m, p_from: from }),
  ]);

  const data: DashboardData = {
    stats: (statsR.data as Stats | null) ?? EMPTY,
    seg: (segR.data as Segments | null) ?? { counts: {}, customers: [] },
    staffRows: (staffR.data as StaffRow[] | null) ?? [],
    anomalies: (anomR.data as Anomaly[] | null) ?? [],
    funnel: (funnelR.data as FunnelT | null) ?? { enrolled: 0, earned_once: 0, earned_3plus: 0, redeemed: 0 },
    ts: (tsR.data as TimeSeries | null) ?? { bucket, members: [], points: [] },
    heat: (heatR.data as HeatCell[] | null) ?? [],
    days, bucket, theme,
  };

  return <DashboardView data={data} />;
}
