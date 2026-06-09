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
type SegCustomer = { serial: string; customer_name: string | null; segment: string };
type Segments = { counts: Record<string, number>; customers: SegCustomer[] };
type StaffRow = { username: string; role: string; txns: number; points_issued: number; points_redeemed: number };
type Anomaly = { kind: string; severity: string; detail: { date?: string; points?: number; avg?: number; staff?: string; issued?: number } };
type Funnel = { enrolled: number; earned_once: number; earned_3plus: number; redeemed: number };

function anomalyText(a: Anomaly): string {
  const d = a.detail;
  if (a.kind === "redemption_spike") return `Redemption spike ${d.date}: ${d.points} pts (avg ${d.avg})`;
  if (a.kind === "staff_over_issue") return `${d.staff} issued ${d.issued} pts — outlier`;
  return a.kind;
}

const EMPTY: Stats = {
  members: 0, active_members: 0, points_issued: 0, points_redeemed: 0, top_redemptions: [], repeat_rate: 0,
};

const SEGMENT_ORDER = ["vip", "regular", "new", "active", "at_risk", "lapsed", "dormant"];
const SEGMENT_LABEL: Record<string, string> = {
  vip: "VIP", regular: "Regular", new: "New", active: "Active",
  at_risk: "At-risk", lapsed: "Lapsed", dormant: "Dormant",
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
  const m = staff.merchantId;

  const [statsR, segR, staffR, anomR, funnelR] = await Promise.all([
    db.rpc("merchant_stats", { p_merchant: m }),
    db.rpc("merchant_segments", { p_merchant: m }),
    db.rpc("staff_activity", { p_merchant: m }),
    db.rpc("detect_anomalies", { p_merchant: m }),
    db.rpc("redemption_funnel", { p_merchant: m }),
  ]);
  const s = (statsR.data as Stats | null) ?? EMPTY;
  const seg = (segR.data as Segments | null) ?? { counts: {}, customers: [] };
  const staffRows = (staffR.data as StaffRow[] | null) ?? [];
  const anomalies = (anomR.data as Anomaly[] | null) ?? [];
  const funnel = (funnelR.data as Funnel | null) ?? { enrolled: 0, earned_once: 0, earned_3plus: 0, redeemed: 0 };

  const atRisk = seg.customers.filter((c) => c.segment === "at_risk").slice(0, 8);
  const lapsed = seg.customers.filter((c) => c.segment === "lapsed").slice(0, 8);

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>dashboard</small>
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        <Link className="btn btn-ghost" href="/customers">Customers</Link>
        <Link className="btn btn-ghost" href="/scan">Scan</Link>
        <Link className="btn btn-ghost" href="/staff">Staff</Link>
      </div>

      {anomalies.length > 0 && (
        <div className="card stack" style={{ marginBottom: 12, borderColor: "var(--bad)" }}>
          <div className="label" style={{ color: "var(--bad)" }}>⚠ Alerts ({anomalies.length})</div>
          {anomalies.map((a, i) => (
            <div key={i}>{anomalyText(a)}</div>
          ))}
        </div>
      )}

      <div className="grid2">
        <Stat label="Members" value={s.members} />
        <Stat label="Active (30d)" value={s.active_members} />
        <Stat label="Points issued" value={s.points_issued} />
        <Stat label="Points redeemed" value={s.points_redeemed} />
        <Stat label="Repeat rate" value={`${Math.round((s.repeat_rate ?? 0) * 100)}%`} />
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Segments</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {SEGMENT_ORDER.filter((k) => seg.counts[k]).map((k) => (
            <span key={k} className="label" style={{ border: "1px solid #2a2825", borderRadius: 8, padding: "4px 10px" }}>
              {SEGMENT_LABEL[k]}: <b style={{ color: "var(--fg)" }}>{seg.counts[k]}</b>
            </span>
          ))}
          {Object.keys(seg.counts).length === 0 && <span className="label">No data yet</span>}
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card stack">
          <div className="label">⚠ At-risk ({seg.counts["at_risk"] ?? 0})</div>
          {atRisk.length === 0 && <div className="label">none</div>}
          {atRisk.map((c) => (
            <Link key={c.serial} href={`/customers/${c.serial}`} style={{ color: "inherit" }}>
              {c.customer_name || "—"}
            </Link>
          ))}
        </div>
        <div className="card stack">
          <div className="label">💤 Lapsed ({seg.counts["lapsed"] ?? 0})</div>
          {lapsed.length === 0 && <div className="label">none</div>}
          {lapsed.map((c) => (
            <Link key={c.serial} href={`/customers/${c.serial}`} style={{ color: "inherit" }}>
              {c.customer_name || "—"}
            </Link>
          ))}
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Staff activity (30d)</div>
        {staffRows.length === 0 && <div className="label">none</div>}
        {staffRows.map((r) => (
          <div key={r.username} className="row" style={{ justifyContent: "space-between" }}>
            <div>{r.username} <span className="label">{r.role}</span></div>
            <div className="label">{r.txns} txns · +{r.points_issued} / −{r.points_redeemed}</div>
          </div>
        ))}
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Redemption funnel</div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span>Enrolled <b>{funnel.enrolled}</b></span>
          <span className="label">→</span>
          <span>Earned <b>{funnel.earned_once}</b></span>
          <span className="label">→</span>
          <span>3+ <b>{funnel.earned_3plus}</b></span>
          <span className="label">→</span>
          <span>Redeemed <b>{funnel.redeemed}</b></span>
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Top redemptions</div>
        {s.top_redemptions.length === 0 && <div className="label">No redemptions yet</div>}
        {s.top_redemptions.map((t) => (
          <div key={t.reason} className="row" style={{ justifyContent: "space-between" }}>
            <div>{actionLabel(t.reason)}</div>
            <div className="label">{t.count}× · {t.points} pts</div>
          </div>
        ))}
      </div>
    </div>
  );
}
