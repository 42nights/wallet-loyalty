import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { STAMP_REWARD_ID, findAction, loyaltyMode, stampGoal, stampReward, unitLabel } from "@/lib/config";
import { formatMoney, formatPhone } from "@/lib/format";
import AdjustPoints from "./AdjustPoints";
import CustomerCRM from "./CustomerCRM";
import SendCardPanel from "@/components/SendCardPanel";

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

// `reward` names redeem:stamp_reward, the one reward of a stamp card.
function label(reason: string, reward: string): string {
  if (reason.startsWith("undo:")) return `Undo: ${label(reason.slice(5), reward)}`;
  if (reason === "earn:purchase") return "Earn";
  if (reason === "earn:stamp") return "Stamp";
  if (reason === `redeem:${STAMP_REWARD_ID}`) return reward;
  if (reason === "adjust:manual") return "Adjustment";
  if (reason.startsWith("campaign:")) return "Campaign";
  if (reason === "bonus:birthday") return "Birthday treat";
  const id = reason.split(":")[1] ?? reason;
  return findAction(id)?.label ?? reason;
}

// Server component: these locale calls run once on the server.
const nf = (n: number) => n.toLocaleString();
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—");

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="card">
      <div className="label">{k}</div>
      <div style={{ fontSize: 22, fontWeight: 800, overflowWrap: "anywhere" }}>{v}</div>
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
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");

  const { serial } = await params;
  const [{ data }, { data: merchant }] = await Promise.all([
    db.rpc("customer_profile", { p_merchant: staff.merchantId, p_serial: serial }),
    // "*": the stamp card columns may not exist yet (then it's points)
    db.from("merchants").select("*").eq("id", staff.merchantId).maybeSingle(),
  ]);
  const p = data as Profile | null;
  if (!p) notFound();
  // A stamp card has no bills, so "spend" would be made up: it shows how far
  // the next reward is instead.
  const mode = loyaltyMode(merchant?.loyalty_mode);
  const goal = stampGoal(merchant?.stamp_goal);
  const reward = stampReward(merchant?.stamp_reward);

  return (
    <div className="wrap">
      <Link className="label" href="/customers" style={{ display: "inline-block", marginBottom: 12, textDecoration: "none" }}>
        ← All customers
      </Link>

      <div className="card stack">
        <div>
          <div className="label">{p.name || "Customer"}</div>
          <div className="balance">{nf(p.points)}</div>
          <div className="label">{unitLabel(mode, p.points)} · {formatPhone(p.phone) || "no phone"}</div>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <Stat k="Visits" v={nf(p.visits)} />
        <Stat k="Lifetime earned" v={nf(p.lifetime_earned)} />
        <Stat k="Lifetime redeemed" v={nf(p.lifetime_redeemed)} />
        {mode === "stamps" ? (
          <Stat k="Next reward" v={p.points >= goal ? `${reward}: ready` : `${goal - p.points} to go`} />
        ) : (
          <Stat
            k="Est. spend"
            v={p.estimated_spend != null ? `~${formatMoney(p.estimated_spend)}` : "—"}
          />
        )}
        <Stat k="First seen" v={d(p.first_seen)} />
        <Stat k="Last seen" v={d(p.last_seen)} />
      </div>

      <div style={{ marginTop: 12 }}>
        <AdjustPoints serial={p.serial} balance={p.points} mode={mode} />
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Lost card? Send it to the customer&apos;s iPhone</div>
        <SendCardPanel serial={p.serial} />
      </div>

      <div style={{ marginTop: 12 }}>
        <CustomerCRM serial={p.serial} />
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Recent activity</div>
        {p.recent.length === 0 && <div className="label">No activity yet</div>}
        {p.recent.map((t, i) => (
          <div key={i} className="row" style={{ justifyContent: "space-between" }}>
            <div>{label(t.reason, reward)}</div>
            <div className="row" style={{ gap: 10 }}>
              <span style={{ fontWeight: 700, color: t.delta >= 0 ? "var(--ok)" : "var(--bad)" }}>
                {t.delta >= 0 ? "+" : ""}{nf(t.delta)}
              </span>
              <span className="label">{d(t.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
      {mode === "points" && (
        <div className="label" style={{ marginTop: 8, fontSize: 11 }}>
          Est. spend is inferred from points ÷ earn rate until exact bill amounts are stored.
        </div>
      )}
    </div>
  );
}
