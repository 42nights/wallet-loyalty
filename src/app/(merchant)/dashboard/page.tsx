import { redirect } from "next/navigation";
import Link from "next/link";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { findAction } from "@/lib/config";

export const runtime = "nodejs";

type TopRedemption = { reason: string; count: number; points: number };
type Stats = {
  members: number;
  active_members: number;
  points_issued: number;
  points_redeemed: number;
  top_redemptions: TopRedemption[];
  repeat_rate: number;
};

const EMPTY: Stats = {
  members: 0,
  active_members: 0,
  points_issued: 0,
  points_redeemed: 0,
  top_redemptions: [],
  repeat_rate: 0,
};

function actionLabel(reason: string): string {
  const id = reason.split(":")[1] ?? reason;
  return findAction(id)?.label ?? id;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan");

  const { data } = await db.rpc("merchant_stats", { p_merchant: staff.merchantId });
  const s = (data as Stats | null) ?? EMPTY;

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>dashboard</small>
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        <Link className="btn btn-ghost" href="/scan">Scan</Link>
        <Link className="btn btn-ghost" href="/staff">Staff</Link>
      </div>

      <div className="grid2">
        <Stat label="Members" value={s.members} />
        <Stat label="Active (30d)" value={s.active_members} />
        <Stat label="Points issued" value={s.points_issued} />
        <Stat label="Points redeemed" value={s.points_redeemed} />
        <Stat label="Repeat rate" value={`${Math.round((s.repeat_rate ?? 0) * 100)}%`} />
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Top redemptions</div>
        {s.top_redemptions.length === 0 && (
          <div className="label">No redemptions yet</div>
        )}
        {s.top_redemptions.map((t) => (
          <div
            key={t.reason}
            className="row"
            style={{ justifyContent: "space-between" }}
          >
            <div>{actionLabel(t.reason)}</div>
            <div className="label">
              {t.count}× · {t.points} pts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
