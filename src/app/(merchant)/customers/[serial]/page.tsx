import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { findAction } from "@/lib/config";
import AdjustPoints from "./AdjustPoints";
import CustomerCRM from "./CustomerCRM";

export const runtime = "nodejs";

type Txn = { delta: number; reason: string; created_at: string };
type Profile = {
  serial: string;
  name: string | null;
  phone: string | null;
  points: number;
  enrolled_at: string;
  lifetime_earned: number;
  lifetime_redeemed: number;
  visits: number;
  first_seen: string | null;
  last_seen: string | null;
  estimated_spend: number | null;
  favorite_redemption: string | null;
  recent: Txn[];
};

function label(reason: string): string {
  if (reason === "earn:purchase") return "Earn";
  if (reason === "adjust:manual") return "Adjustment";
  if (reason.startsWith("campaign:")) return "Campaign";
  const id = reason.split(":")[1] ?? reason;
  return findAction(id)?.label ?? reason;
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="card">
      <div className="label">{k}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div>
    </div>
  );
}

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan");

  const { serial } = await params;
  const { data } = await db.rpc("customer_profile", {
    p_merchant: staff.merchantId,
    p_serial: serial,
  });
  const p = data as Profile | null;
  if (!p) notFound();

  const d = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>customer</small>
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        <Link className="btn btn-ghost" href="/customers">← Customers</Link>
        <Link className="btn btn-ghost" href="/dashboard">Dashboard</Link>
      </div>

      <div className="card stack">
        <div>
          <div className="label">{p.name || "Customer"}</div>
          <div className="balance">{p.points}</div>
          <div className="label">points · {p.phone || "no phone"}</div>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <Stat k="Visits" v={p.visits} />
        <Stat k="Lifetime earned" v={p.lifetime_earned} />
        <Stat k="Lifetime redeemed" v={p.lifetime_redeemed} />
        <Stat k="Est. spend" v={p.estimated_spend != null ? `~${p.estimated_spend}` : "—"} />
        <Stat k="First seen" v={d(p.first_seen)} />
        <Stat k="Last seen" v={d(p.last_seen)} />
      </div>

      <div style={{ marginTop: 12 }}>
        <AdjustPoints serial={p.serial} />
      </div>

      <div style={{ marginTop: 12 }}>
        <CustomerCRM serial={p.serial} />
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Recent activity</div>
        {p.recent.length === 0 && <div className="label">No activity yet</div>}
        {p.recent.map((t, i) => (
          <div key={i} className="row" style={{ justifyContent: "space-between" }}>
            <div>{label(t.reason)}</div>
            <div className="row" style={{ gap: 10 }}>
              <span style={{ fontWeight: 700, color: t.delta >= 0 ? "var(--ok)" : "var(--bad)" }}>
                {t.delta >= 0 ? "+" : ""}{t.delta}
              </span>
              <span className="label">{new Date(t.created_at).toLocaleDateString("en-GB")}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="label" style={{ marginTop: 8, fontSize: 11 }}>
        Est. spend is inferred from points ÷ earn rate until exact bill amounts are stored.
      </div>
    </div>
  );
}
