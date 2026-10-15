"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PARTNER_TYPES, type Person, type Stage } from "@/lib/sales/types";
import { readTerms, type PayoutLine } from "./payouts";
import { readProfile, writeProfile } from "./profile";
import s from "../../admin.module.css";
import t from "../tools.module.css";

export type RosterRow = {
  person: Person;
  stats: {
    assigned: number;
    stages: [Stage, number][];
    territory: string[];
    doors: number;
    demos: number;
    pilots: number;
    paying: number;
    payingWeek: number;
  };
};

type Role = "rep" | "captain" | "partner";
type Form = {
  name: string; role: Role; partner_type: string; phone: string; email: string; territory: string;
  payout_terms: string; started_on: string; active: boolean; notes: string;
};
const EMPTY: Form = {
  name: "", role: "rep", partner_type: "", phone: "", email: "", territory: "", payout_terms: "", started_on: "", active: true, notes: "",
};
const roleOf = (p: Person): Role => (p.kind === "partner" ? "partner" : readProfile(p.notes).captain ? "captain" : "rep");
const fromPerson = (p: Person): Form => {
  const { territory, notes } = readProfile(p.notes);
  return {
    name: p.name, role: roleOf(p), partner_type: p.partner_type ?? "", phone: p.phone ?? "", email: p.email ?? "", territory,
    payout_terms: p.payout_terms ?? "", started_on: p.started_on ?? "", active: p.active, notes,
  };
};
const ROLES: [Role, string, string, string][] = [
  ["rep", "Rep", "Sells in person, paid per paying shop.", "e.g. $100 + $50, or hourly + $50/shop"],
  ["captain", "Captain", "A rep who leads their territory's pod.", "e.g. $100 + $50, or hourly + $50/shop"],
  ["partner", "Partner", "Introduces shops for a share.", "e.g. 20%/24mo"],
];
const STAGE_LABEL: Partial<Record<Stage, string>> = { franchisor_only: "franchisor", closed_business: "closed", waiting_l6: "waiting L6" };
const phoneText = (p: string | null) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
};
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function Roster({ rows }: { rows: RosterRow[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // The form shows while adding or editing (always on an empty roster), so
  // the table keeps the full width.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hours, setHours] = useState<Record<string, string>>({});
  const showForm = open || rows.length === 0;
  const set = (patch: Partial<Form>) => {
    setF((cur) => ({ ...cur, ...patch }));
    setMsg(null);
  };

  function start(p: Person | null) {
    setEditing(p);
    setF(p ? fromPerson(p) : EMPTY);
    setMsg(null);
    setOpen(true);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      formRef.current?.querySelector("input")?.focus({ preventScroll: true });
    });
  }
  function close() {
    setOpen(false);
    setEditing(null);
    setF(EMPTY);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const opt = (v: string) => v.trim() || null;
    const kind: Person["kind"] = f.role === "partner" ? "partner" : "rep";
    const body = {
      name: f.name.trim(), kind, partner_type: kind === "partner" ? opt(f.partner_type) : null,
      phone: opt(f.phone), email: opt(f.email), payout_terms: opt(f.payout_terms), started_on: opt(f.started_on),
      notes: writeProfile({ territory: f.territory, captain: f.role === "captain", notes: f.notes }),
      ...(editing ? { active: f.active } : {}),
    };
    try {
      const res = await fetch(editing ? `/api/admin/sales/people/${editing.id}` : "/api/admin/sales/people", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return router.push("/admin/login");
      if (!res.ok) return setMsg({ ok: false, text: data.error || "Could not save" });
      close();
      setMsg({ ok: true, text: editing ? `Saved ${body.name}.` : `Added ${body.name}.` });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const kind: Person["kind"] = f.role === "partner" ? "partner" : "rep";
  const terms = readTerms(kind, f.payout_terms);

  return (
    <div className={t.flow} style={{ marginBottom: 14 }}>
      {showForm && (
        <form ref={formRef} className={`panel ${t.personForm}`} onSubmit={save}>
          <div className="panel-h">
            <span className="panel-t">{editing ? `Edit ${editing.name}` : "Add a person"}</span>
            {rows.length > 0 && <button type="button" className={t.linkBtn} onClick={close}>Cancel</button>}
          </div>
          <div className={t.personGrid}>
            <div className={t.personCol}>
              <label className={s.field}>
                <span className="label">Name</span>
                <input value={f.name} maxLength={80} required placeholder="First and last name" onChange={(e) => set({ name: e.target.value })} />
              </label>
              <div className={t.roles} role="group" aria-label="Role">
                {ROLES.map(([key, name, sub]) => (
                  <button type="button" key={key} className={s.tpl} aria-pressed={f.role === key} onClick={() => set({ role: key })}>
                    <div className={s.tplName}>{name}{f.role === key && <span aria-hidden>✓</span>}</div>
                    <div className={s.hint}>{sub}</div>
                  </button>
                ))}
              </div>
              <label className={s.field}>
                <span className="label">Territory</span>
                <input value={f.territory} maxLength={120} placeholder="e.g. Park Slope, 11215" onChange={(e) => set({ territory: e.target.value })} />
              </label>
              {f.role === "partner" && (
                <label className={s.field}>
                  <span className="label">Partner type</span>
                  <select value={f.partner_type} onChange={(e) => set({ partner_type: e.target.value })}>
                    <option value="">—</option>
                    {PARTNER_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
              )}
              <div className={s.two}>
                <label className={s.field}>
                  <span className="label">Phone</span>
                  <input type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
                </label>
                <label className={s.field}>
                  <span className="label">Email</span>
                  <input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
                </label>
              </div>
            </div>
            <div className={t.personCol}>
              <label className={s.field}>
                <span className="label">Payout terms</span>
                <input value={f.payout_terms} maxLength={500} placeholder={ROLES.find((r) => r[0] === f.role)![3]}
                  onChange={(e) => set({ payout_terms: e.target.value })} />
                <span className={`${s.hint} ${terms.defaulted || (kind === "partner" && terms.pct === null) ? t.warnText : ""}`}>Reads as: {terms.reads}</span>
              </label>
              <div className={s.two}>
                <label className={s.field}>
                  <span className="label">Start date</span>
                  <input type="date" value={f.started_on} onChange={(e) => set({ started_on: e.target.value })} />
                </label>
                {editing && (
                  <label className={`${s.check} ${t.activeCheck}`}>
                    <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
                    Active
                  </label>
                )}
              </div>
              <label className={s.field}>
                <span className="label">Notes</span>
                <textarea rows={3} maxLength={1800} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
              </label>
            </div>
          </div>
          <div className={s.actions}>
            <button type="submit" className="btn btn-primary" disabled={busy || !f.name.trim()}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add to roster"}
            </button>
            <span className={s.hint}>No login is created. Deactivate instead of deleting, so payouts and &quot;sourced by&quot; keep the name.</span>
          </div>
          {msg && !msg.ok && <div className="toast bad" role="alert" style={{ marginTop: 0 }}>{msg.text}</div>}
        </form>
      )}

      <section className="panel">
        <div className="panel-h">
          <span className="panel-t">Roster · {rows.filter((r) => r.person.active).length} active of {rows.length}</span>
          {rows.length > 0 && !showForm && (
            <button type="button" className={`btn btn-ghost ${s.smallBtn} ${t.press}`} onClick={() => start(null)}>+ Add a person</button>
          )}
        </div>
        {msg?.ok && <div className="toast ok" role="status" style={{ marginTop: 0 }}>{msg.text}</div>}
        {rows.length === 0 ? (
          <div className={s.emptyState}>
            <p>Nobody on the roster yet. Add your first rep or partner above: a name is enough.</p>
          </div>
        ) : (
          <div className={s.tableWrap}>
            <table className={`${s.table} ${t.rosterTable}`}>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Territory</th>
                  <th>Pipeline (assigned)</th>
                  <th className={s.num}>Doors · wk</th>
                  <th className={s.num}>Demos · wk</th>
                  <th className={s.num}>Pilots</th>
                  <th className={s.num}>Paying</th>
                  <th>Hours · wk</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ person: p, stats: st }) => {
                  const tr = readTerms(p.kind, p.payout_terms);
                  const role = roleOf(p);
                  const territory = readProfile(p.notes).territory;
                  const h = Number(hours[p.id]);
                  return (
                    <tr key={p.id} data-inactive={!p.active || undefined} className={t.rosterRow}>
                      <td>
                        <span className={t.rowName}>{p.name}</span>
                        <span className={t.personMeta}>
                          <span className={t.kindTag} data-kind={role}>{role === "partner" ? p.partner_type ?? "partner" : role}</span>
                          {!p.active && <span className={t.flag}>inactive</span>}
                          {p.started_on && <span>since {p.started_on}</span>}
                        </span>
                        <span className={s.slug}>{[phoneText(p.phone), p.email].filter(Boolean).join(" · ") || "no contact details"}</span>
                        <span className={t.terms} title={p.payout_terms ?? ""}>{tr.reads}</span>
                      </td>
                      <td data-label="Territory">
                        {territory || (!st.territory.length && <span className={t.muted}>—</span>)}
                        {st.territory.length > 0 && <span className={s.slug}>{territory ? "working " : ""}{st.territory.join(", ")}</span>}
                      </td>
                      <td data-label="Pipeline">
                        <Link href={`/admin/sales/leads?assignee=${p.id}`} className={t.pipeLink}>
                          <b>{st.assigned}</b> lead{st.assigned === 1 ? "" : "s"}
                        </Link>
                        {st.stages.length > 0 && (
                          <span className={t.stages}>
                            {st.stages.map(([stage, n]) => (
                              <span key={stage} className={t.stageChip} data-stage={stage}>{STAGE_LABEL[stage] ?? stage} {n}</span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td data-label="Doors · wk" className={s.num}>{st.doors}</td>
                      <td data-label="Demos · wk" className={s.num}>{st.demos}</td>
                      <td data-label="Pilots" className={s.num}>{st.pilots}</td>
                      <td data-label="Paying" className={s.num}>{st.paying}</td>
                      <td data-label="Hours · wk">
                        {p.kind === "rep" && tr.hourly ? (
                          <span className={t.hours}>
                            <input type="number" inputMode="decimal" min={0} step={0.5} placeholder="0" aria-label={`Hours ${p.name} worked this week`}
                              value={hours[p.id] ?? ""} onChange={(e) => setHours((cur) => ({ ...cur, [p.id]: e.target.value }))} />
                            {h > 0 && (
                              st.payingWeek
                                ? <span className={h / st.payingWeek <= 10 ? s.ok : s.bad}>{(h / st.payingWeek).toFixed(1)} h per paying shop</span>
                                : <span className={t.muted}>no paying shop this week</span>
                            )}
                          </span>
                        ) : <span className={t.muted}>—</span>}
                      </td>
                      <td>
                        <button type="button" className={`btn btn-ghost ${s.smallBtn} ${t.press}`} onClick={() => start(p)}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <span className={s.hint}>
          Territory is what you typed; under it, the clusters of the leads assigned to them (assign and set clusters on the lead list). Hours are not saved: keep a rep while they stay at or under 10 paid hours per paying shop (strategy §7.2).
        </span>
      </section>
    </div>
  );
}

export function Payouts({ lines, month, captains }: { lines: PayoutLine[]; month: string; captains: string[] }) {
  // Partner shares need the plan price, which no table records yet: typed per
  // line, never saved.
  const [price, setPrice] = useState<Record<string, string>>({});
  const amountOf = (l: PayoutLine): number | null => {
    if (l.amount !== null) return l.amount;
    const p = Number(price[`${l.personId}:${l.leadId}`]);
    return l.pct !== null && p > 0 ? Math.round(l.pct * p) / 100 : null;
  };
  const total = lines.reduce((sum, l) => sum + (amountOf(l) ?? 0), 0);
  const missing = lines.filter((l) => amountOf(l) === null).length;

  return (
    <section className={`panel ${t.payouts}`}>
      <div className="panel-h">
        <span className="panel-t">Payouts due · {month}</span>
        <span className={t.total}>{usd(total)}{missing > 0 && <small> + {missing} to price</small>}</span>
      </div>
      {lines.length === 0 ? (
        <div className={s.emptyState}>
          <p>Nothing due this month. Bounties appear when a lead someone sourced reaches its first paid invoice or month 4.</p>
        </div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr><th>Person</th><th>Shop</th><th>For</th><th>Arithmetic</th><th className={s.num}>Amount</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const key = `${l.personId}:${l.leadId}`;
                return (
                  <tr key={`${key}:${l.what}`}>
                    <td><span className={t.rowName}>{l.person}</span></td>
                    <td data-label="Shop">
                      <Link href={`/admin/sales/leads/${l.leadId}`} className={t.pipeLink}>{l.shop}</Link>
                    </td>
                    <td data-label="For">{l.what}<span className={s.slug}>{l.amount === null ? "first paid" : "on"} {l.date}</span></td>
                    <td data-label="Arithmetic">
                      {l.amount !== null ? (
                        <span>bounty from &ldquo;{l.terms || "spec default"}&rdquo;</span>
                      ) : l.pct === null ? (
                        <span className={t.warnText}>Set this partner&apos;s terms, e.g. 20%/24mo</span>
                      ) : (
                        <span className={t.arith}>
                          {l.pct}% × $
                          <input type="number" inputMode="decimal" min={0} step="any" placeholder="plan" aria-label={`Plan price for ${l.shop}`}
                            value={price[key] ?? ""} onChange={(e) => setPrice((cur) => ({ ...cur, [key]: e.target.value }))} />
                          /mo
                        </span>
                      )}
                    </td>
                    <td data-label="Amount" className={`${s.num} ${t.amount}`}>
                      {amountOf(l) === null ? <span className={t.muted}>—</span> : usd(amountOf(l)!)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <span className={s.hint}>
        Type each partner shop&apos;s monthly plan price: it is not saved, because no table records a shop&apos;s plan yet. Strategy §1: no partner share on the founding price.
        {captains.length > 0 && ` Captain override ($10 per paying shop in the pod) is not computed: pods are not recorded yet (${captains.join(", ")}).`}
      </span>
    </section>
  );
}
