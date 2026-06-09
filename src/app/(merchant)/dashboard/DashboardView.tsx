import Link from "next/link";
import { findAction } from "@/lib/config";
import { TrendChart, BarChart, Sparkline, Donut, Funnel, Heatmap, SEGMENT_COLORS } from "./charts";
import Controls from "./Controls";
import ThemeToggle from "./ThemeToggle";
import CommandBar from "./CommandBar";
import DigestCard from "./DigestCard";

// ---- shared data shapes (also imported by page.tsx) ------------------------
export type TopRedemption = { reason: string; count: number; points: number };
export type Stats = {
  members: number; active_members: number; points_issued: number;
  points_redeemed: number; top_redemptions: TopRedemption[]; repeat_rate: number;
};
export type SegCustomer = { serial: string; customer_name: string | null; segment: string };
export type Segments = { counts: Record<string, number>; customers: SegCustomer[] };
export type StaffRow = { username: string; role: string; txns: number; points_issued: number; points_redeemed: number };
export type Anomaly = { kind: string; severity: string; detail: { date?: string; points?: number; avg?: number; staff?: string; issued?: number } };
export type FunnelT = { enrolled: number; earned_once: number; earned_3plus: number; redeemed: number };
export type TimePoint = { t: string; issued: number; redeemed: number };
export type MemberPoint = { t: string; n: number };
export type TimeSeries = { bucket: string; members: MemberPoint[]; points: TimePoint[] };
export type HeatCell = { dow: number; hour: number; n: number };

export type DashboardData = {
  stats: Stats; seg: Segments; staffRows: StaffRow[]; anomalies: Anomaly[];
  funnel: FunnelT; ts: TimeSeries; heat: HeatCell[];
  days: string; bucket: string; theme: "light" | "dark";
};

const SEGMENT_ORDER = ["vip", "regular", "new", "active", "at_risk", "lapsed", "dormant"];
const SEGMENT_LABEL: Record<string, string> = {
  vip: "VIP", regular: "Regular", new: "New", active: "Active", at_risk: "At-risk", lapsed: "Lapsed", dormant: "Dormant",
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const nf = (n: number) => n.toLocaleString("en-US");
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function anomalyText(a: Anomaly): string {
  const d = a.detail;
  if (a.kind === "redemption_spike") return `Redemption spike ${d.date}: ${d.points} pts (avg ${d.avg}).`;
  if (a.kind === "staff_over_issue") return `${d.staff} issued ${d.issued} pts — an outlier worth a look.`;
  return a.kind;
}
function actionLabel(reason: string): string {
  const id = reason.split(":")[1] ?? reason;
  return findAction(id)?.label ?? id;
}

type Insight = { dir: "up" | "down" | "warn" | "info"; text: string };
const INS_ICON: Record<Insight["dir"], string> = { up: "↑", down: "↓", warn: "⚠", info: "→" };

// Rule-based insights computed straight from the aggregates — no LLM needed for
// the headline trends (the AI digest panel does the deeper write-up).
function computeInsights(d: DashboardData): Insight[] {
  const out: Insight[] = [];

  const issued = d.ts.points.map((p) => p.issued);
  if (issued.length >= 4) {
    const half = Math.floor(issued.length / 2);
    const recent = sum(issued.slice(half));
    const prior = sum(issued.slice(0, half));
    if (recent > 0 || prior > 0) {
      const p = prior <= 0 ? 100 : Math.round(((recent - prior) / prior) * 100);
      out.push({ dir: p >= 0 ? "up" : "down", text: `Points issued ${p >= 0 ? "up" : "down"} ${Math.abs(p)}% vs the previous period.` });
    }
  }

  if (d.heat.length) {
    const top = d.heat.reduce((a, b) => (b.n > a.n ? b : a));
    out.push({ dir: "info", text: `Busiest around ${DOW[top.dow]} ${top.hour}:00 (${top.n} scans).` });
  }

  const active = Object.entries(d.seg.counts).filter(([k]) => k !== "dormant");
  if (active.length) {
    const [k, v] = active.reduce((a, b) => (b[1] > a[1] ? b : a));
    out.push({ dir: "info", text: `Largest active group: ${v} ${(SEGMENT_LABEL[k] ?? k).toLowerCase()}.` });
  }

  const f = d.funnel;
  const steps: Array<[string, number, number]> = [
    ["enrolled → earned", f.enrolled, f.earned_once],
    ["earned → 3+ visits", f.earned_once, f.earned_3plus],
    ["3+ → redeemed", f.earned_3plus, f.redeemed],
  ];
  let worst: string | null = null;
  let worstPct = 0;
  for (const [name, a, b] of steps) {
    if (a > 0) {
      const drop = Math.round((1 - b / a) * 100);
      if (drop > worstPct) { worstPct = drop; worst = name; }
    }
  }
  if (worst) out.push({ dir: worstPct >= 60 ? "down" : "info", text: `Biggest funnel drop-off: ${worst} (−${worstPct}%).` });

  if (d.stats.members > 0) {
    const r = Math.round((100 * d.stats.active_members) / d.stats.members);
    out.push({ dir: r >= 40 ? "up" : "down", text: `${r}% of members were active in the last 30 days.` });
  }

  for (const a of d.anomalies) out.push({ dir: "warn", text: anomalyText(a) });
  if (!out.length) out.push({ dir: "info", text: "Not enough data yet — check back after a few more scans." });
  return out;
}

function Kpi({ k, v, spark }: { k: string; v: string | number; spark?: React.ReactNode }) {
  return (
    <div className="panel kpi">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {spark && <div className="spark">{spark}</div>}
    </div>
  );
}

export default function DashboardView({ data }: { data: DashboardData }) {
  const { stats: s, seg, staffRows, funnel, ts, heat, days, bucket, theme } = data;

  const issued = ts.points.map((p) => p.issued);
  const redeemed = ts.points.map((p) => p.redeemed);
  const memberSeries = ts.members.map((p) => p.n);
  const memberLabels = ts.members.map((p) => new Date(p.t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }));

  const segSegments = SEGMENT_ORDER.map((k) => ({ label: SEGMENT_LABEL[k], color: SEGMENT_COLORS[k], value: seg.counts[k] ?? 0 }));
  const atRisk = seg.customers.filter((c) => c.segment === "at_risk").slice(0, 8);
  const lapsed = seg.customers.filter((c) => c.segment === "lapsed").slice(0, 8);
  const insights = computeInsights(data);

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="brand" style={{ margin: 0 }}>
          <span className="dot" /> 42nights <small>analytics</small>
        </div>
        <nav className="dash-nav">
          <Link href="/customers">Customers</Link>
          <Link href="/campaigns">Campaigns</Link>
          <Link href="/scan">Scan</Link>
          <Link href="/staff">Staff</Link>
        </nav>
        <ThemeToggle initial={theme} />
      </div>

      <Controls days={days} bucket={bucket} />

      <div className="kpi-row">
        <Kpi k="Members" v={nf(s.members)} spark={memberSeries.length > 1 ? <Sparkline data={memberSeries} color="var(--c-members)" /> : undefined} />
        <Kpi k="Active · 30d" v={nf(s.active_members)} />
        <Kpi k="Points issued" v={nf(s.points_issued)} spark={issued.length > 1 ? <Sparkline data={issued} color="var(--c-issued)" /> : undefined} />
        <Kpi k="Points redeemed" v={nf(s.points_redeemed)} spark={redeemed.length > 1 ? <Sparkline data={redeemed} color="var(--c-redeemed)" /> : undefined} />
        <Kpi k="Repeat rate" v={`${Math.round((s.repeat_rate ?? 0) * 100)}%`} />
      </div>

      <div className="dash-grid">
        <div className="panel col-8">
          <div className="panel-h"><span className="panel-t">Points flow</span><span className="label" style={{ margin: 0 }}>last {days} days</span></div>
          <TrendChart caption={`per ${bucket}`} series={[{ label: "Issued", color: "var(--c-issued)", data: issued }, { label: "Redeemed", color: "var(--c-redeemed)", data: redeemed }]} />
        </div>

        <div className="panel col-4">
          <div className="panel-h"><span className="panel-t">Segments</span><span className="label" style={{ margin: 0 }}>all time</span></div>
          <Donut label="members" segments={segSegments} />
        </div>

        <div className="panel col-8">
          <div className="panel-h"><span className="panel-t">When you&apos;re busy</span><span className="label" style={{ margin: 0 }}>day × hour</span></div>
          <Heatmap cells={heat} />
        </div>

        <div className="panel col-4">
          <div className="panel-h"><span className="panel-t">New members</span><span className="label" style={{ margin: 0 }}>per {bucket}</span></div>
          <BarChart data={memberSeries} labels={memberLabels} color="var(--accent)" />
        </div>

        <div className="panel col-6">
          <div className="panel-h"><span className="panel-t">✦ Insights</span></div>
          <div className="ins">
            {insights.map((it, i) => (
              <div className={`ins-item ${it.dir}`} key={i}>
                <span className="ins-ico">{INS_ICON[it.dir]}</span>
                <span>{it.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel col-6">
          <div className="panel-h"><span className="panel-t">Redemption funnel</span><span className="label" style={{ margin: 0 }}>all time</span></div>
          <Funnel steps={[
            { label: "Enrolled", value: funnel.enrolled },
            { label: "Earned once", value: funnel.earned_once },
            { label: "Earned 3+", value: funnel.earned_3plus },
            { label: "Redeemed", value: funnel.redeemed },
          ]} />
        </div>

        <div className="panel col-4">
          <div className="panel-h"><span className="panel-t">⚠ At-risk ({seg.counts["at_risk"] ?? 0})</span></div>
          {atRisk.length === 0 && <div className="label">none</div>}
          {atRisk.map((c) => (<div className="lrow" key={c.serial}><Link href={`/customers/${c.serial}`}>{c.customer_name || "—"}</Link></div>))}
        </div>

        <div className="panel col-4">
          <div className="panel-h"><span className="panel-t">💤 Lapsed ({seg.counts["lapsed"] ?? 0})</span></div>
          {lapsed.length === 0 && <div className="label">none</div>}
          {lapsed.map((c) => (<div className="lrow" key={c.serial}><Link href={`/customers/${c.serial}`}>{c.customer_name || "—"}</Link></div>))}
        </div>

        <div className="panel col-4">
          <div className="panel-h"><span className="panel-t">Top redemptions</span></div>
          {s.top_redemptions.length === 0 && <div className="label">none yet</div>}
          {s.top_redemptions.slice(0, 6).map((t) => (
            <div className="lrow" key={t.reason}><span>{actionLabel(t.reason)}</span><span className="label" style={{ margin: 0 }}>{t.count}× · {nf(t.points)}</span></div>
          ))}
        </div>

        <div className="panel col-6">
          <div className="panel-h"><span className="panel-t">Staff · 30d</span></div>
          {staffRows.length === 0 && <div className="label">none</div>}
          {staffRows.map((r) => (
            <div className="lrow" key={r.username}>
              <span>{r.username} <span className="label" style={{ display: "inline", margin: 0 }}>{r.role}</span></span>
              <span className="label" style={{ margin: 0 }}>{r.txns} txns · +{nf(r.points_issued)} / −{nf(r.points_redeemed)}</span>
            </div>
          ))}
        </div>

        <div className="col-6"><DigestCard /></div>
      </div>

      <CommandBar />
    </div>
  );
}
