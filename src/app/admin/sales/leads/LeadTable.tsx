"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPhone } from "@/lib/format";
import { STAGES, type LeadListRow, type Person, type Stage } from "@/lib/sales/types";
import { nf } from "../../ui";
import { STAGE_LABEL, human, when } from "./labels";
import { send } from "./api";
import a from "../../admin.module.css";
import s from "../sales.module.css";

// The lead rows plus selection and the bulk actions (spec §2.2): assign, set
// cluster, set stage. Pilot and paying need the lead page, and nothing here
// touches do-not-contact (the API enforces both).

const BULK_STAGES = STAGES.filter((st) => st !== "pilot" && st !== "paid");
type Bulk = "assignee_id" | "cluster" | "stage";

export function StageBadge({ stage }: { stage: Stage }) {
  const tone =
    stage === "paid" ? s.won : stage === "demo" || stage === "pilot" || stage === "conversation" ? s.hot
      : stage === "new" || stage === "researched" || stage === "contacted" ? s.open : s.closed;
  return <span className={`${a.badge} ${tone}`}>{STAGE_LABEL[stage]}</span>;
}

export default function LeadTable({
  leads, people, total, moreHref, capped, filtered,
}: { leads: LeadListRow[]; people: Person[]; total: number; moreHref: string | null; capped: boolean; filtered: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Bulk>("assignee_id");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const visible = new Set(leads.filter((l) => !l.do_not_contact).map((l) => l.id));
  const selected = [...picked].filter((id) => visible.has(id));
  // Do-not-contact rows are read-only: shown, never bulk-edited.
  const editable = leads.filter((l) => !l.do_not_contact).map((l) => l.id);
  const all = editable.length > 0 && selected.length === editable.length;
  const now = new Date().toISOString();

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function apply() {
    if (busy || !selected.length) return;
    if (action === "stage" && !value) return setMsg({ ok: false, text: "Pick a stage" });
    setBusy(true);
    const r = await send<{ updated: number }>("/api/admin/sales/leads", "PATCH", {
      ids: selected,
      set: { [action]: value || null },
    });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `Updated ${r.data.updated} lead${r.data.updated === 1 ? "" : "s"}.` });
    setPicked(new Set());
    router.refresh();
  }

  if (!leads.length)
    return (
      <div className="panel">
        <div className={a.emptyState}>
          <p>{filtered ? "No leads match these filters." : "No leads yet. Import an open-data file or add a shop from Today."}</p>
          {filtered
            ? <Link href="/admin/sales/leads" className="btn btn-ghost" style={{ width: "auto", textDecoration: "none" }}>Clear filters</Link>
            : <Link href="/admin/sales/import" className="btn btn-primary" style={{ width: "auto", textDecoration: "none" }}>Import leads</Link>}
        </div>
      </div>
    );

  return (
    <div className="panel">
      <div className={s.bulk} data-on={selected.length > 0}>
        <label className={a.check}>
          <input
            type="checkbox"
            checked={all}
            onChange={() => setPicked(all ? new Set() : new Set(editable))}
            aria-label="Select all shown"
          />
          {selected.length ? `${selected.length} selected` : `Select all ${editable.length} shown`}
        </label>
        {selected.length > 0 && (
          <div className={s.bulkCtl}>
            <select value={action} onChange={(e) => { setAction(e.target.value as Bulk); setValue(""); setMsg(null); }} aria-label="Bulk action">
              <option value="assignee_id">Assign to</option>
              <option value="cluster">Set cluster</option>
              <option value="stage">Set stage</option>
            </select>
            {action === "assignee_id" && (
              <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Person">
                <option value="">Ayaan (unassigned)</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {action === "cluster" && (
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Empty clears it" maxLength={80} aria-label="Cluster" />
            )}
            {action === "stage" && (
              <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Stage">
                <option value="">Pick a stage</option>
                {BULK_STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
              </select>
            )}
            <button type="button" className={`btn btn-primary ${s.bulkBtn}`} onClick={apply} disabled={busy}>
              {busy ? "Saving…" : `Apply to ${selected.length}`}
            </button>
          </div>
        )}
      </div>
      {action === "stage" && selected.length > 0 && <div className={a.hint}>Pilot and Paying are set on each lead&apos;s page: they need the franchise check.</div>}
      {msg && <div className={`toast ${msg.ok ? "ok" : "bad"}`} role="status" style={{ marginTop: 0 }}>{msg.text}</div>}

      <table className={s.leadTable}>
        <thead>
          <tr>
            <th aria-label="Select" />
            <th>Business</th>
            <th>Stage</th>
            <th>Next action</th>
            <th>Assigned</th>
            <th>Cluster</th>
            <th>Last contact</th>
            <th>Phone</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const overdue = !!l.next_action_at && l.next_action_at < now;
            return (
              <tr key={l.id} data-picked={picked.has(l.id)}>
                <td className={s.pick}>
                  <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} disabled={l.do_not_contact}
                    aria-label={l.do_not_contact ? `${l.business_name} is do-not-contact (read-only)` : `Select ${l.business_name}`} />
                </td>
                <td className={s.biz}>
                  <Link href={`/admin/sales/leads/${l.id}`} className={a.mname}>{l.business_name}</Link>
                  <span className={s.meta}>
                    {[l.segment === "cafe" ? "Café" : human(l.segment), l.city, l.zip].filter(Boolean).join(" · ")}
                  </span>
                  {(l.do_not_contact || l.franchise_brand) && (
                    <span className={s.flags}>
                      {l.do_not_contact && <span className={`${a.badge} ${s.dncBadge}`}>Do not contact</span>}
                      {l.franchise_brand && <span className={`${a.badge} ${s.closed}`}>Franchise · {l.franchise_brand}</span>}
                    </span>
                  )}
                </td>
                <td className={s.stageCell}><StageBadge stage={l.stage} /></td>
                <td data-label="Next action">
                  {l.next_action_at ? (
                    <>
                      <span className={overdue ? s.overdue : undefined}>{when(l.next_action_at)}</span>
                      {l.next_action && <span className={s.meta}>{l.next_action}</span>}
                    </>
                  ) : <span className={s.meta}>—</span>}
                </td>
                <td data-label="Assigned">{l.assignee?.name ?? "Ayaan"}</td>
                <td data-label="Cluster">{l.cluster ?? <span className={s.meta}>—</span>}</td>
                <td data-label="Last contact" className={s.nowrap}>{l.last_contacted_at ? when(l.last_contacted_at) : <span className={s.meta}>never</span>}</td>
                <td data-label="Phone" className={s.nowrap}>{l.phone ? formatPhone(l.phone) : <span className={s.meta}>—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={s.more2}>
        <span className={s.meta}>Showing {nf(leads.length)} of {nf(total)}</span>
        {moreHref && (
          <Link href={moreHref} scroll={false} className="btn btn-ghost" style={{ width: "auto", textDecoration: "none", padding: "12px 18px" }}>
            Load more · {nf(total - leads.length)} left
          </Link>
        )}
        {capped && <span className={s.meta}>That&apos;s the first 1,000. Narrow the filters to see the rest.</span>}
      </div>
    </div>
  );
}
