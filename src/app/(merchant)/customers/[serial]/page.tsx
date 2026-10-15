import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import {
  STAMP_REWARD_ID, findAction, localTime, loyaltyMode, stampGoal, stampReward, timezoneOf, unitLabel,
} from "@/lib/config";
import { formatPhone } from "@/lib/format";
import Icon from "@/components/Icon";
import SendCardPanel from "@/components/SendCardPanel";
import AdjustPoints from "./AdjustPoints";
import CustomerCRM from "./CustomerCRM";
import CardStatus from "./CardStatus";
import d from "./detail.module.css";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Customer" };

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
  spend_is_real: boolean;
  favorite_redemption: string | null;
  recent: Txn[];
};

// `reward` names redeem:stamp_reward, the one reward of a stamp card.
function label(reason: string, reward: string): string {
  if (reason.startsWith("undo:")) return `Undo: ${label(reason.slice(5), reward)}`;
  if (reason.startsWith("earn:")) return "Visit";
  if (reason === `redeem:${STAMP_REWARD_ID}`) return reward;
  if (reason === "adjust:manual") return "Adjustment";
  if (reason.startsWith("campaign:")) return "Campaign bonus";
  if (reason === "bonus:birthday") return "Birthday treat";
  const id = reason.split(":")[1] ?? reason;
  return findAction(id)?.label ?? reason;
}

const nf = (n: number) => n.toLocaleString("en-US");
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

// Dates and times on the shop's own clock: the server runs on UTC.
function shopClock(tz: string) {
  const f = (o: Intl.DateTimeFormatOptions, locale = "en-US") => new Intl.DateTimeFormat(locale, { timeZone: tz, ...o });
  const keyF = f({ year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA"); // 2026-10-14
  const timeF = f({ hour: "numeric", minute: "2-digit" });
  const dayF = f({ weekday: "short", month: "short", day: "numeric" });
  const shortF = f({ month: "short", day: "numeric" });
  const monF = f({ month: "short" });
  const dateF = f({ month: "short", day: "numeric", year: "numeric" });
  const now = localTime(tz);
  const iso = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
  const today = iso(now.year, now.month, now.day);
  const yesterday = iso(now.year, now.month, now.day - 1);
  const key = (s: string) => keyF.format(new Date(s));
  const thisYear = (s: string) => key(s).slice(0, 4) === today.slice(0, 4);
  const time = (s: string) => timeF.format(new Date(s)).toLowerCase(); // "2:14 pm"
  const date = (s: string) => dateF.format(new Date(s)); // "Aug 30, 2026"
  // "3 days ago", "Last week", "5 months ago"
  const ago = (s: string) => {
    const n = Math.max(0, Math.round((Date.parse(today) - Date.parse(key(s))) / 864e5));
    const [v, unit]: [number, Intl.RelativeTimeFormatUnit] =
      n < 7 ? [n, "day"] : n < 30 ? [Math.floor(n / 7), "week"]
        : n < 365 ? [Math.floor(n / 30), "month"] : [Math.floor(n / 365), "year"];
    const t = rtf.format(-v, unit);
    return t[0].toUpperCase() + t.slice(1);
  };
  return {
    time,
    date,
    // "Today", "Yesterday", "Mon, Oct 12", or "Mon, Oct 12, 2025" in another year
    day: (s: string) => {
      const k = key(s);
      if (k === today) return "Today";
      if (k === yesterday) return "Yesterday";
      return thisYear(s) ? dayF.format(new Date(s)) : `${dayF.format(new Date(s))}, ${k.slice(0, 4)}`;
    },
    // A stat tile's [value, sub]. The value stays under ~125px at 36px, so it
    // fits a 6-across tile (~145px): "Yesterday" (167px) moves to the sub.
    // ["Today", "2:14 pm"], ["Oct 13", "Yesterday, 2:14 pm"], ["Sep 30", "2 weeks ago"], ["Dec '25", "Dec 28, 2025"]
    tile: (s: string): [string, string] => {
      const k = key(s);
      if (k === today) return ["Today", time(s)];
      if (k === yesterday) return [shortF.format(new Date(s)), `Yesterday, ${time(s)}`];
      return thisYear(s) ? [shortF.format(new Date(s)), ago(s)] : [`${monF.format(new Date(s))} '${k.slice(2, 4)}`, date(s)];
    },
  };
}

function Stat({ k, v, sub, extra }: { k: string; v: ReactNode; sub?: string; extra?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {extra}
      {sub && <div className="sub">{sub}</div>}
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
  const c = shopClock(timezoneOf(merchant?.timezone));
  // customer_profile() predates deactivation; read it off the row. select("*")
  // so a database without passes.voided_at yet shows every card as active.
  const { data: row } = await db
    .from("passes")
    .select("*")
    .eq("serial", p.serial)
    .eq("merchant_id", staff.merchantId)
    .single();
  const voided = row?.voided_at
    ? { since: c.date(row.voided_at as string), reason: (row.void_reason as string | null) ?? null }
    : null;

  const unit = unitLabel(mode, 2);
  const Unit = unit[0].toUpperCase() + unit.slice(1);
  const units = (n: number) => (n === 1 ? unit.slice(0, -1) : unit);
  const phone = formatPhone(p.phone);
  const initials = (p.name ?? "").trim().split(/\s+/).filter(Boolean);
  // last_seen/first_seen count every ledger row (a campaign bonus too); a visit
  // is an earn, so read the latest one off the recent rows when it is there.
  const lastVisit = p.visits > 0 ? (p.recent.find((t) => t.reason.startsWith("earn:"))?.created_at ?? p.last_seen) : null;
  const firstVisit = p.visits > 0 ? p.first_seen : null;
  const toGo = goal - p.points;
  const visitTile = (s: string | null) => {
    const [v, sub] = s ? c.tile(s) : ["—", "No visits yet"];
    return { v, sub };
  };

  const days: { label: string; rows: Txn[] }[] = [];
  for (const t of p.recent) {
    const dayLabel = c.day(t.created_at);
    if (days.at(-1)?.label === dayLabel) days.at(-1)!.rows.push(t);
    else days.push({ label: dayLabel, rows: [t] });
  }

  const status = <CardStatus serial={p.serial} voided={voided} unit={unit} />;

  return (
    <div className={`page ${d.page}`}>
      <Link className={`back-link ${d.back}`} href="/customers">
        <Icon name="chevron-right" />
        All customers
      </Link>

      <header className={`panel ${d.hero}`}>
        <div className={d.who}>
          <span className="avatar avatar--lg" aria-hidden="true">
            {initials.length ? initials[0][0] + (initials.length > 1 ? initials[initials.length - 1][0] : "") : "?"}
          </span>
          <div className={d.whoText}>
            <div className={d.nameRow}>
              <h1 className="page-title">{p.name || "Customer"}</h1>
              {voided && <span className="chip chip--bad">Deactivated</span>}
            </div>
            <p className={d.meta}>
              {[`${nf(p.points)} ${units(p.points)}`, phone, `Joined ${c.date(p.enrolled_at)}`]
                .filter(Boolean)
                .flatMap((m, i, all) => [i ? " " : null, <span key={i}>{i < all.length - 1 ? `${m} ·` : m}</span>])}
            </p>
          </div>
        </div>
        <div className={d.balanceBox}>
          <div className="balance">{nf(p.points)}</div>
          <div className={d.unit}>{units(p.points)}</div>
        </div>
      </header>

      <div className={d.stats}>
        <Stat k="Visits" v={nf(p.visits)} />
        <Stat k={`${Unit} earned`} v={nf(p.lifetime_earned)} />
        <Stat k={`${Unit} redeemed`} v={nf(p.lifetime_redeemed)} />
        {mode === "stamps" ? (
          <Stat
            k="Next reward"
            v={toGo <= 0 ? "Ready" : <>{toGo}<span className={d.vUnit}> {units(toGo)} to go</span></>}
            sub={toGo <= 0 ? reward : `${reward} at ${goal} stamps`}
          />
        ) : (
          <Stat
            k="Spent"
            v={p.estimated_spend != null ? dollars.format(p.estimated_spend) : "—"}
            extra={p.estimated_spend != null && !p.spend_is_real && (
              <span className="chip" title="Worked out from points ÷ earn rate">estimated</span>
            )}
          />
        )}
        <Stat k="Last visit" {...visitTile(lastVisit)} />
        <Stat k="First visit" {...visitTile(firstVisit)} />
      </div>

      {/* DOM order is the phone order; ≥960px the activity panel takes the left column */}
      <div className={d.cols}>
        {voided && status}
        {!voided && (
          <section className="panel">
            <h2 className="panel-t">Card actions</h2>
            <AdjustPoints serial={p.serial} balance={p.points} mode={mode} />
            <hr className={d.rule} />
            <p className="help"><b>Lost card?</b> Send it to their iPhone again — it&apos;s the same card, with the same {unit}.</p>
            <SendCardPanel serial={p.serial} />
          </section>
        )}

        <section className={`panel ${d.activity}`}>
          <div className="panel-h">
            <h2 className="panel-t">Recent activity</h2>
            {p.recent.length >= 20 && <span className="panel-meta">Latest 20</span>}
          </div>
          {days.length === 0 ? (
            <div className="empty">
              <Icon name="clock" />
              <p className="empty-t">No visits or rewards yet</p>
              <p className="empty-p">They show up here after this customer&apos;s first visit.</p>
            </div>
          ) : (
            days.map((g) => (
              <div key={g.label} className={d.day}>
                <h3 className={`eyebrow ${d.dayH}`}>{g.label}</h3>
                <ul className={d.list}>
                  {g.rows.map((t, i) => (
                    <li key={i} className={d.item}>
                      <span className={d.what}>{label(t.reason, reward)}</span>
                      <span className={`${d.amt} ${t.delta >= 0 ? d.plus : d.minus}`}>
                        {t.delta >= 0 ? "+" : "−"}{nf(Math.abs(t.delta))} {unitLabel(mode, Math.abs(t.delta), true)}
                      </span>
                      <span className={d.time}>{c.time(t.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <CustomerCRM serial={p.serial} />
        {!voided && status}
      </div>
    </div>
  );
}
