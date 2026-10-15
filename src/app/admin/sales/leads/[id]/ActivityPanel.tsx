"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { checkStage, type LeadCompliance, type Recent } from "@/lib/sales/compliance";
import {
  CHANNELS, OUTCOMES, STAGES, isOneOf, type Activity, type ActivityKind, type Lead, type Outcome, type Person, type Stage,
} from "@/lib/sales/types";
import { KIND_LABEL, OUTCOME_LABEL, STAGE_LABEL, fromLocalInput, toLocalInput, when } from "../labels";
import { send } from "../api";
import { verdictsAt } from "./LeadView";
import a from "../../../admin.module.css";
import s from "../../sales.module.css";

// Log a touch and see the history (spec §2.3 panel 3). Each channel button runs
// checkContact() live at the time the touch happened (empty = now), the same
// time the server judges it at; a blocked one is disabled with its reason.

const KINDS: ActivityKind[] = [...CHANNELS, "partner_intro", "note"];
const NO_NEXT: (Outcome | "")[] = ["no", "opt_out", "paid"];
const QUICK = [["Tomorrow 3pm", 1, 15], ["In 3 days", 3, 15], ["Next week", 7, 15]] as const;

type Props = {
  lead: Lead;
  compliance: LeadCompliance;
  recent: Recent;
  postalAddressSet: boolean;
  people: Person[];
  activities: Activity[];
  initialKind: ActivityKind | null;
  now: Date;
};

const blank = (kind: ActivityKind | null) => ({
  kind, outcome: "" as Outcome | "", person: "", notes: "", at: "", next: "", nextAt: "", stage: "" as Stage | "", recorded: false,
});

export default function ActivityPanel({ lead, compliance, recent, postalAddressSet, people, activities, initialKind, now }: Props) {
  const router = useRouter();
  const [f, setF] = useState(() => blank(initialKind));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; warnings?: string[] } | null>(null);
  const set = (patch: Partial<typeof f>) => { setF((cur) => ({ ...cur, ...patch })); setMsg(null); };

  const atIso = f.at ? fromLocalInput(f.at) : null;
  const at = atIso ? new Date(atIso) : now;
  const verdicts = verdictsAt(compliance, recent, postalAddressSet, at, f.recorded);
  const optOut = f.outcome === "opt_out";
  // An opt-out is always recordable, whatever the channel's rules (the server agrees).
  const blockOf = (k: ActivityKind): string | null =>
    optOut || k === "note" ? null
      : isOneOf(CHANNELS, k) ? (verdicts[k].allowed ? null : verdicts[k].reason ?? "Blocked")
        : lead.do_not_contact ? "Do-not-contact: only notes can be logged." : null;
  const kindBlock = f.kind ? blockOf(f.kind) : null;
  const warnings = f.kind && isOneOf(CHANNELS, f.kind) && !kindBlock && !optOut ? verdicts[f.kind].warnings : [];
  const needNext = !!f.kind && isOneOf(CHANNELS, f.kind) && !NO_NEXT.includes(f.outcome);
  const stageBlock = !optOut && f.stage && f.stage !== lead.stage ? checkStage(lead, f.stage) : null;
  const future = !!atIso && Date.parse(atIso) > Date.now() + 5 * 60_000;
  const canSubmit = !!f.kind && !kindBlock && !stageBlock && !future && (!needNext || (f.next.trim() && f.nextAt));
  const names = new Map(people.map((p) => [p.id, p.name]));

  function quick(days: number, hour: number) {
    const base = toLocalInput(new Date(now.getTime() + days * 86_400_000).toISOString());
    set({ nextAt: `${base.slice(0, 10)}T${String(hour).padStart(2, "0")}:00` });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !canSubmit || !f.kind) return;
    setBusy(true);
    const r = await send<{ warnings: string[] }>(`/api/admin/sales/leads/${lead.id}/activities`, "POST", {
      kind: f.kind,
      outcome: f.outcome || null,
      notes: f.notes,
      occurred_at: atIso ?? undefined,
      person_id: f.person || null,
      next_action: needNext || f.next.trim() ? f.next : undefined,
      next_action_at: (needNext || f.nextAt) && f.nextAt ? fromLocalInput(f.nextAt) : undefined,
      stage: !optOut && f.stage && f.stage !== lead.stage ? f.stage : null,
      recorded: f.kind === "call" && f.recorded,
    });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: optOut ? "Opt-out logged. This lead is now do-not-contact." : "Logged.", warnings: r.data.warnings });
    setF(blank(null));
    router.refresh();
  }

  return (
    <section className="panel" id="log" aria-labelledby="log-h">
      <div className="panel-h">
        <h2 className="panel-t" id="log-h">Log a touch</h2>
        <span className={s.meta}>nothing is sent from here</span>
      </div>
      <form onSubmit={submit} className={s.logForm}>
        <div className={s.field}>
          <span className="label">What did you do?</span>
          <div className={s.kinds} role="group" aria-label="Kind">
            {KINDS.map((k) => {
              const why = blockOf(k);
              return (
                <div key={k} className={s.kindCell}>
                  <button type="button" className={s.kind} aria-pressed={f.kind === k} disabled={!!why} onClick={() => set({ kind: k })}>
                    {KIND_LABEL[k]}
                  </button>
                  {why && !lead.do_not_contact && <span className={s.why}>{why}</span>}
                </div>
              );
            })}
          </div>
          {lead.do_not_contact && !optOut && <span className={s.errText}>Do-not-contact: only notes can be logged.</span>}
          {!optOut && Object.values(verdicts).some((v) => !v.allowed) && !lead.do_not_contact && (
            <span className={a.hint}>Recording an opt-out on a blocked channel? Pick the outcome &quot;Opted out&quot; first.</span>
          )}
        </div>

        <div className={a.two}>
          <label className={a.field}>
            <span className="label">What happened?</span>
            <select value={f.outcome} onChange={(e) => set({ outcome: e.target.value as Outcome | "" })}>
              <option value="">No outcome</option>
              {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
            </select>
          </label>
          <label className={a.field}>
            <span className="label">Who</span>
            <select value={f.person} onChange={(e) => set({ person: e.target.value })}>
              <option value="">Ayaan</option>
              {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        {optOut && (
          <div className={s.optOutNote} role="note">
            Logging &quot;Opted out&quot; marks this lead do-not-contact for good: it moves to Lost, its next action is cleared,
            and its phone and email go on the suppression list so no import can bring them back.
          </div>
        )}

        <label className={a.field}>
          <span className="label">Notes</span>
          <textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} placeholder="Owner is in Saturdays. Uses a paper punch card." />
        </label>

        <div className={a.two}>
          <label className={a.field}>
            <span className="label">When it happened (Pacific)</span>
            <input type="datetime-local" value={f.at} onChange={(e) => set({ at: e.target.value })} aria-describedby="at-hint" />
            <span className={a.hint} id="at-hint">{future ? <span className={s.errText}>That&apos;s in the future.</span> : "Leave empty for now."}</span>
          </label>
          <label className={a.field}>
            <span className="label">Move to stage</span>
            <select value={f.stage} onChange={(e) => set({ stage: e.target.value as Stage | "" })} disabled={optOut || lead.do_not_contact}>
              <option value="">Keep {STAGE_LABEL[lead.stage]}</option>
              {STAGES.filter((st) => st !== lead.stage).map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
            </select>
            {stageBlock && <span className={s.errText}>{stageBlock}</span>}
          </label>
        </div>

        {!optOut && !lead.do_not_contact && f.kind !== null && (
          <div className={s.nextBox}>
            <div className={a.two}>
              <label className={a.field}>
                <span className="label">Next action{needNext ? "" : " (optional)"}</span>
                <input value={f.next} onChange={(e) => set({ next: e.target.value })} maxLength={500} placeholder="Back Thursday 3pm with the demo" required={needNext} />
              </label>
              <label className={a.field}>
                <span className="label">Next action date (Pacific)</span>
                <input type="datetime-local" value={f.nextAt} onChange={(e) => set({ nextAt: e.target.value })} required={needNext} />
              </label>
            </div>
            <div className={s.quick}>
              {QUICK.map(([label, d, h]) => <button key={label} type="button" className={s.chip} onClick={() => quick(d, h)}>{label}</button>)}
            </div>
            {needNext && <span className={a.hint}>Required unless the outcome is Said no, Opted out or Started paying.</span>}
          </div>
        )}

        {f.kind === "call" && (
          <label className={a.check}>
            <input type="checkbox" checked={f.recorded} onChange={(e) => set({ recorded: e.target.checked })} /> This call is recorded
          </label>
        )}

        {kindBlock && <div className="toast bad" role="alert" style={{ marginTop: 0 }}>{kindBlock}</div>}
        {warnings.length > 0 && (
          <ul className={s.warnList} aria-label="Warnings">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}

        <div className={a.actions}>
          <button type="submit" className={`btn ${optOut ? s.dangerBtn : "btn-primary"} ${a.smallBtn}`} disabled={busy || !canSubmit}>
            {busy ? "Saving…" : optOut ? "Log opt-out (permanent)" : f.kind ? `Log ${KIND_LABEL[f.kind].toLowerCase()}` : "Pick what you did"}
          </button>
        </div>
        {msg && (
          <div className={`toast ${msg.ok ? "ok" : "bad"}`} role="status" style={{ marginTop: 0 }}>
            {msg.text}
            {msg.warnings?.length ? <ul className={s.warnInToast}>{msg.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          </div>
        )}
      </form>

      <div className="panel-h" style={{ marginTop: 10 }}>
        <h2 className="panel-t">History</h2>
        <span className={s.meta}>{activities.length ? `latest ${activities.length}` : ""}</span>
      </div>
      {activities.length === 0 ? (
        <p className={s.empty}>No touches yet.</p>
      ) : (
        <ol className={s.timeline}>
          {activities.map((act) => (
            <li key={act.id} className={act.kind === "stage_change" ? s.tlMuted : act.outcome === "opt_out" ? s.tlStop : undefined}>
              <div className={s.tlHead}>
                <strong>{KIND_LABEL[act.kind]}</strong>
                {act.outcome && <span className={s.tlOutcome}>{OUTCOME_LABEL[act.outcome]}</span>}
                <span className={s.meta}>{when(act.occurred_at)} · {act.person_id ? names.get(act.person_id) ?? "Removed person" : "Ayaan"}</span>
              </div>
              {act.notes && (
                <div className={s.tlNotes}>
                  {act.kind === "stage_change" ? act.notes.replace(/\b[a-z_0-9]+\b/g, (w) => (isOneOf(STAGES, w) ? STAGE_LABEL[w] : w)) : act.notes}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
