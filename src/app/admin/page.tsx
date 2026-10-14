import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { REDEEM_TEMPLATES } from "@/lib/config";
import { platformOverview, type Health } from "@/lib/admin/stats";
import { AdminHeader, DailyCharts, HealthBadge, KpiTiles, HEALTH_HELP, ago, nf } from "./ui";
import s from "./admin.module.css";

export const runtime = "nodejs";

// Needs-attention first: a quiet merchant is the one about to churn.
const ORDER: Health[] = ["quiet", "empty", "new", "active"];

export default async function AdminOverview() {
  if (!(await isAdmin())) redirect("/admin/login");
  const { merchantCount, kpis, daily, merchants } = await platformOverview();
  const rows = [...merchants].sort(
    (a, b) => ORDER.indexOf(a.health) - ORDER.indexOf(b.health) || a.name.localeCompare(b.name)
  );

  return (
    <div className="dash">
      <AdminHeader />
      <div className={s.head}>
        <div>
          <h1 className={s.title}>Platform</h1>
          <div className={s.sub}>Live from the ledger. Windows are rolling: 30d = the last 30 × 24 hours.</div>
        </div>
        <Link href="/admin/merchants/new" className="btn btn-primary" style={{ width: "auto", padding: "12px 18px", textDecoration: "none" }}>
          + New merchant
        </Link>
      </div>

      <KpiTiles
        k={kpis}
        lead={{ k: "Merchants", v: nf(merchantCount), sub: `${merchants.filter((m) => m.health === "active").length} active` }}
      />
      <DailyCharts daily={daily} />

      <div className="panel">
        <div className="panel-h">
          <span className="panel-t">Merchants</span>
          <div className={s.chips}>
            {ORDER.map((h) => {
              const n = merchants.filter((m) => m.health === h).length;
              return n ? (
                <span key={h} className={s.chipNote} title={HEALTH_HELP[h]}>
                  <HealthBadge health={h} /> {n}
                </span>
              ) : null;
            })}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className={s.emptyState}>
            <p>No merchants yet. Onboard the first one: it takes about two minutes.</p>
            <Link href="/admin/merchants/new" className="btn btn-primary" style={{ width: "auto", textDecoration: "none" }}>
              Create the first merchant
            </Link>
          </div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Health</th>
                  <th>Template</th>
                  <th className={s.num}>Earn / $1</th>
                  <th className={s.num}>Cards</th>
                  <th className={s.num}>Active 30d</th>
                  <th>Last activity</th>
                  <th className={s.num}>Staff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/admin/merchants/${m.id}`} className={s.mname}>{m.name}</Link>
                      <span className={s.slug}>/enroll/{m.slug ?? "—"}</span>
                    </td>
                    <td><HealthBadge health={m.health} /></td>
                    <td>{REDEEM_TEMPLATES[m.template].label}</td>
                    <td className={s.num}>{nf(m.earnRate)}</td>
                    <td className={s.num}>{nf(m.cards)}</td>
                    <td className={s.num}>{nf(m.active30)}</td>
                    <td>{ago(m.lastActivity)}</td>
                    <td className={s.num}>{m.staff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
