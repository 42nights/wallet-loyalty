"use client";
import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import s from "./dashboard.module.css";

type Customer = { serial: string; customer_name: string | null; visits: number; recency_days: number | null };

const nf = new Intl.NumberFormat("en-US").format;
const GROUPS = {
  at_risk: { label: "At risk", empty: "No one is at risk right now — nice." },
  lapsed: { label: "Lapsed", empty: "No one has lapsed — everyone came back within 90 days." },
} as const;
type Key = keyof typeof GROUPS;

const lastVisit = (d: number | null) => (d === null ? "No visits yet" : d === 0 ? "Last visit today" : `Last visit ${nf(d)} ${d === 1 ? "day" : "days"} ago`);

// Every at-risk or lapsed customer (the list scrolls), each a link to their
// page, plus a campaign pre-set to the group shown.
export default function WinBack({ atRisk, lapsed, className }: { atRisk: Customer[]; lapsed: Customer[]; className: string }) {
  const [key, setKey] = useState<Key>(atRisk.length || !lapsed.length ? "at_risk" : "lapsed");
  const rows = key === "at_risk" ? atRisk : lapsed;
  const count: Record<Key, number> = { at_risk: atRisk.length, lapsed: lapsed.length };

  return (
    <section className={`panel ${className}`}>
      <div className="panel-h">
        <h3 className="panel-t">Win back</h3>
      </div>
      <div className={`segmented ${s.wbTabs}`} role="group" aria-label="Customer group">
        {(Object.keys(GROUPS) as Key[]).map((k) => (
          <button key={k} type="button" aria-pressed={k === key} onClick={() => setKey(k)}>
            {GROUPS[k].label} ({nf(count[k])})
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className={`empty ${s.fill}`}>
          <Icon name="check" />
          <p className="empty-p">{GROUPS[key].empty}</p>
        </div>
      ) : (
        <>
          <ul className={s.wbList} aria-label={`${GROUPS[key].label} customers`}>
            {rows.map((c) => (
              <li key={c.serial}>
                <Link href={`/customers/${c.serial}`}>
                  <span>
                    <span className={s.rowName}>{c.customer_name || "Unnamed customer"}</span>
                    <span className={s.rowMeta}>{lastVisit(c.recency_days)} · {nf(c.visits)} {c.visits === 1 ? "visit" : "visits"}</span>
                  </span>
                  <Icon name="chevron-right" />
                </Link>
              </li>
            ))}
          </ul>
          <Link className={`btn btn-ghost btn-sm ${s.wbCta}`} href={`/campaigns?segment=${key}`}>Send a win-back offer</Link>
        </>
      )}
    </section>
  );
}
