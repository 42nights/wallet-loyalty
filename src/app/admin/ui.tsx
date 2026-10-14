import Link from "next/link";
import { TrendChart } from "@/app/(merchant)/dashboard/charts";
import type { Daily, Health, Kpis } from "@/lib/admin/stats";
import s from "./admin.module.css";

// Presentational pieces shared by the overview and the merchant page. No hooks,
// so they render on the server and ship no JS.

export const nf = (n: number) => n.toLocaleString("en-US");
export const dollars = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// "3h ago". null = nothing inside the 60-day window the stats look at.
export function ago(iso: string | null): string {
  if (!iso) return "none in 60d";
  const mins = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export const HEALTH_LABEL: Record<Health, string> = { new: "New", active: "Active", quiet: "Quiet", empty: "Empty" };
export const HEALTH_HELP: Record<Health, string> = {
  new: "Created less than 7 days ago",
  active: "Activity in the last 14 days",
  quiet: "No activity for 14+ days",
  empty: "No cards issued yet",
};

export function HealthBadge({ health }: { health: Health }) {
  return (
    <span className={`${s.badge} ${s[health]}`} title={HEALTH_HELP[health]}>
      {HEALTH_LABEL[health]}
    </span>
  );
}

function Kpi({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="panel kpi">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className={s.kpiSub}>{sub}</div>}
    </div>
  );
}

// `lead` is the first tile: "Merchants" on the overview, "Last activity" on a
// merchant page, so both grids stay 8 tiles (4x2 desktop, 2x4 phone).
export function KpiTiles({ k, lead }: { k: Kpis; lead: { k: string; v: string; sub?: string } }) {
  const redeemPct = k.issued30 ? Math.round((100 * k.redeemed30) / k.issued30) : 0;
  const walletPct = k.cards ? Math.round((100 * k.inWallet) / k.cards) : 0;
  return (
    <div className={`kpi-row ${s.kpis}`}>
      <Kpi {...lead} />
      <Kpi k="Cards issued" v={nf(k.cards)} sub="all time" />
      <Kpi k="In Wallet now" v={nf(k.inWallet)} sub={`${walletPct}% of cards`} />
      <Kpi k="Active cards · 30d" v={nf(k.active30)} sub="earned at least once" />
      <Kpi k="Transactions · 30d" v={nf(k.txns30)} />
      <Kpi k="Points issued · 30d" v={nf(k.issued30)} sub={`vs ${nf(k.redeemed30)} redeemed (${redeemPct}%)`} />
      <Kpi k="Tracked revenue · 30d" v={dollars(k.revenue30)} sub="bill totals entered at /scan" />
      <Kpi k="New cards · 30d" v={nf(k.newCards30)} />
    </div>
  );
}

export function DailyCharts({ daily }: { daily: Daily }) {
  const span = `${daily.days[0]} → ${daily.days[daily.days.length - 1]} · UTC`;
  return (
    <div className="dash-grid" style={{ marginBottom: 14 }}>
      <div className="panel col-6">
        <div className="panel-h">
          <span className="panel-t">New cards / day</span>
          <span className="label" style={{ margin: 0 }}>60 days</span>
        </div>
        <TrendChart caption={span} series={[{ label: "New cards", color: "var(--c-members)", data: daily.newCards }]} />
      </div>
      <div className="panel col-6">
        <div className="panel-h">
          <span className="panel-t">Transactions / day</span>
          <span className="label" style={{ margin: 0 }}>60 days</span>
        </div>
        <TrendChart caption={span} series={[{ label: "Transactions", color: "var(--c-issued)", data: daily.txns }]} />
      </div>
    </div>
  );
}

export function AdminHeader() {
  return (
    <div className="dash-top">
      <Link href="/admin" className="brand" style={{ margin: 0, color: "var(--ink)", textDecoration: "none" }}>
        <span className="dot" /> 42nights <small>creator</small>
      </Link>
      <nav className="dash-nav">
        <Link href="/admin">Overview</Link>
        <Link href="/admin/merchants/new">+ New merchant</Link>
        <form action="/api/admin/logout" method="post" className={s.logout}>
          <button type="submit">Log out</button>
        </form>
      </nav>
    </div>
  );
}
