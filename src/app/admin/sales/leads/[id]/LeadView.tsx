"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPhone } from "@/lib/format";
import { checkContact, checkStage, recipientZone, type LeadCompliance, type Recent, type Verdict } from "@/lib/sales/compliance";
import type { Script } from "@/lib/sales/scripts";
import {
  CHANNELS, CONSENT_METHODS, DNC_CHANNELS, RECORDING_CONSENT, STAGES,
  type Activity, type Channel, type ActivityKind, type Draft, type Lead, type Person, type Stage,
} from "@/lib/sales/types";
import { STAGE_LABEL, fromLocalInput, human, toLocalInput, when } from "../labels";
import { send } from "../api";
import { StageBadge } from "../LeadTable";
import ActivityPanel from "./ActivityPanel";
import ScriptsPanel from "./ScriptsPanel";
import AiPanel from "./AiPanel";
import Details from "./Details";
import a from "../../../admin.module.css";
import s from "../../sales.module.css";

// The lead page's frame: header, pipeline strip and compliance box, plus the
// clock every channel check runs on. `now` starts at the server's render time
// (same text on both sides of hydration) and ticks each 30 s, so a call button
// closes by itself when quiet hours begin.

export type ShownScript = Pick<Script, "id" | "tab" | "channel" | "title" | "source"> & { text: string; disabled: string | null };
export type Verdicts = Record<Channel, Verdict>;

export function verdictsAt(compliance: LeadCompliance, recent: Recent, postalAddressSet: boolean, at: Date, recorded = false): Verdicts {
  return Object.fromEntries(
    CHANNELS.map((ch) => [ch, checkContact(compliance, ch, at, recent, { postalAddressSet, recorded })])
  ) as Verdicts;
}

type Props = {
  lead: Lead;
  activities: Activity[];
  drafts: Draft[];
  suppressed: boolean;
  recent: Recent;
  people: Person[];
  postalAddressSet: boolean;
  aiEnabled: boolean;
  scripts: ShownScript[];
  initialKind: ActivityKind | null;
  serverNow: string;
};

export default function LeadView(p: Props) {
  const [now, setNow] = useState(() => new Date(p.serverNow));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const compliance: LeadCompliance = { ...p.lead, suppressed: p.suppressed };
  const verdictsNow = verdictsAt(compliance, p.recent, p.postalAddressSet, now);
  const { lead } = p;
  const place = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");

  return (
    <>
      <div className={a.head}>
        <div style={{ minWidth: 0 }}>
          <Link href="/admin/sales/leads" className={a.back}>← Leads</Link>
          <h1 className={a.title}>{lead.business_name}</h1>
          <div className={a.sub}>
            {[lead.segment === "cafe" ? "Café" : human(lead.segment), place || "No address", lead.cluster && `cluster ${lead.cluster}`, `source ${lead.source}`]
              .filter(Boolean).join(" · ")}
          </div>
          <div className={s.headBadges}>
            <StageBadge stage={lead.stage} />
            {lead.do_not_contact && <span className={`${a.badge} ${s.dncBadge}`}>Do not contact</span>}
            <span className={s.meta}>Last contact: {lead.last_contacted_at ? when(lead.last_contacted_at) : "never"}</span>
          </div>
        </div>
      </div>

      <Pipeline lead={lead} people={p.people} />

      <div className={s.leadGrid}>
        <div className={s.col}>
          <ComplianceBox lead={lead} suppressed={p.suppressed} now={now} />
          <ActivityPanel
            lead={lead}
            compliance={compliance}
            recent={p.recent}
            postalAddressSet={p.postalAddressSet}
            people={p.people}
            activities={p.activities}
            initialKind={p.initialKind}
            now={now}
          />
        </div>
        <div className={s.col}>
          <ScriptsPanel lead={lead} scripts={p.scripts} verdicts={verdictsNow} />
          <AiPanel lead={lead} enabled={p.aiEnabled} drafts={p.drafts} verdicts={verdictsNow} />
        </div>
      </div>

      <Details lead={lead} people={p.people} />
    </>
  );
}

// Stage, owner of the lead and the next action: what changes most often.
function Pipeline({ lead, people }: { lead: Lead; people: Person[] }) {
  const router = useRouter();
  const initOf = (l: Lead) => ({
    stage: l.stage as Stage,
    assignee_id: l.assignee_id ?? "",
    next_action: l.next_action ?? "",
    next_action_at: toLocalInput(l.next_action_at),
  });
  // Edits over the current lead, as in Details: an opt-out logged below moves
  // the stage and clears the next action here too.
  const [saved, setSaved] = useState(lead);
  const init = initOf(saved.updated_at > lead.updated_at ? saved : lead);
  const [edits, setEdits] = useState<Partial<ReturnType<typeof initOf>>>({});
  const v = { ...init, ...edits };
  const setV = (patch: Partial<typeof init>) => setEdits((cur) => ({ ...cur, ...patch }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const stageBlock = v.stage !== init.stage ? checkStage(lead, v.stage) : null;
  const changed = (Object.keys(edits) as (keyof typeof init)[]).filter((k) => v[k] !== init[k]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || stageBlock || !changed.length) return;
    setBusy(true);
    const body: Record<string, string | null> = {};
    for (const k of changed) body[k] = k === "next_action_at" ? fromLocalInput(v[k]) : v[k] || null;
    const r = await send<{ lead: Lead }>(`/api/admin/sales/leads/${lead.id}`, "PATCH", body);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setSaved(r.data.lead);
    setEdits({});
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }

  return (
    <form className={`panel ${s.pipeline}`} onSubmit={save} aria-label="Pipeline">
      <label className={a.field}>
        <span className="label">Stage</span>
        <select value={v.stage} disabled={lead.do_not_contact} onChange={(e) => { setV({ stage: e.target.value as Stage }); setMsg(null); }}>
          {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
        </select>
      </label>
      <label className={a.field}>
        <span className="label">Assigned to</span>
        <select value={v.assignee_id} onChange={(e) => { setV({ assignee_id: e.target.value }); setMsg(null); }}>
          <option value="">Ayaan</option>
          {people.filter((x) => x.active || x.id === lead.assignee_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className={`${a.field} ${s.grow}`}>
        <span className="label">Next action</span>
        <input value={v.next_action} disabled={lead.do_not_contact} onChange={(e) => { setV({ next_action: e.target.value }); setMsg(null); }} maxLength={500} placeholder="Visit at 3pm, ask for Maria" />
      </label>
      <label className={a.field}>
        <span className="label">When (Pacific)</span>
        <input type="datetime-local" value={v.next_action_at} disabled={lead.do_not_contact} onChange={(e) => { setV({ next_action_at: e.target.value }); setMsg(null); }} />
      </label>
      <button type="submit" className={`btn btn-primary ${s.pipeBtn}`} disabled={busy || !!stageBlock || !changed.length}>
        {busy ? "Saving…" : "Save"}
      </button>
      {lead.do_not_contact && <div className={s.pipeMsg}><span className={a.hint}>Do-not-contact: stage and next action are locked. Only the assignee can change.</span></div>}
      {(stageBlock || msg || (v.stage !== init.stage && (v.stage === "pilot" || v.stage === "paid"))) && (
        <div className={s.pipeMsg}>
          {stageBlock && <span className={s.errText} role="alert">{stageBlock}</span>}
          {!stageBlock && v.stage !== init.stage && v.stage === "pilot" && <span className={a.hint}>Saving starts the pilot clock today.</span>}
          {!stageBlock && v.stage !== init.stage && v.stage === "paid" && <span className={a.hint}>Saving records the first payment today (rep bounty #1 starts).</span>}
          {msg && <span className={msg.ok ? a.ok : s.errText} role="status">{msg.text}</span>}
        </div>
      )}
    </form>
  );
}

const DAY = 86_400_000;
const STATE_RULES: Record<string, string> = {
  MD: "Maryland: calls 8am-8pm only, max 3 calls in 24 hours.",
  TX: "Texas: book the visit only. No price, no close, no payment on the phone.",
  OK: "Oklahoma: book the visit only. No price, no close, no payment on the phone.",
  WA: "Washington: no texts without written consent.",
};

// Read at a glance (spec §2.3 panel 2): can we contact them, and how.
function ComplianceBox({ lead, suppressed, now }: { lead: Lead; suppressed: boolean; now: Date }) {
  const router = useRouter();
  const [open, setOpen] = useState<"dnc" | "consent" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dnc, setDnc] = useState({ channel: "call", note: "" });
  const wa = lead.state === "WA";
  const [consent, setConsent] = useState({ text: "", method: wa ? "written_form" : "verbal_logged", phone: formatPhone(lead.phone) });

  async function act(url: string, method: string, body: unknown, done: string) {
    setBusy(true);
    const r = await send(url, method, body);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: done });
    setOpen(null);
    router.refresh();
  }

  const zone = recipientZone(lead);
  const checkedDays = lead.national_dnc_checked_at
    ? Math.floor((now.getTime() - Date.parse(`${lead.national_dnc_checked_at.slice(0, 10)}T00:00:00Z`)) / DAY)
    : null;
  const dncStale = lead.national_dnc_status === "clear" && (checkedDays === null || checkedDays > 31);
  const rules = [
    lead.state && STATE_RULES[lead.state.toUpperCase()],
    (lead.franchise_brand || lead.stage === "franchisor_only") &&
      `Franchise${lead.franchise_brand ? ` (${lead.franchise_brand})` : ""}: check FDD Items 8 and 11 before any demo.`,
    (lead.phone_source === "people_search" || lead.phone_source === "purchased_list") &&
      "Personal number: hand-dial only after the DNC check; never text.",
    zone.checkZone && `Time zone guessed from ${lead.state}: check it in Details.`,
  ].filter((x): x is string => !!x);

  return (
    <section className={`panel ${lead.do_not_contact ? "alert" : ""}`} aria-labelledby="cb-h">
      <div className="panel-h">
        <h2 className="panel-t" id="cb-h">Compliance</h2>
        <span className={s.meta}>checked again by the server on every log</span>
      </div>

      {lead.do_not_contact && (
        <div className={s.dncBanner} role="note">
          <strong>Do not contact</strong> since {lead.dnc_at ? when(lead.dnc_at) : "an unknown date"}
          {lead.dnc_channel ? ` · asked by ${lead.dnc_channel}` : ""}{lead.dnc_note ? ` · “${lead.dnc_note}”` : ""}.
          Never contact again. Only notes can be logged.
        </div>
      )}

      <dl className={s.facts}>
        <dt>Phone</dt>
        <dd>{lead.phone ? <>{formatPhone(lead.phone)} <span className={s.meta}>· {human(lead.phone_type)}{lead.phone_source ? ` · from ${human(lead.phone_source).toLowerCase()}` : ""}</span></> : <span className={s.meta}>none</span>}</dd>
        <dt>National DNC</dt>
        <dd>
          {lead.national_dnc_status === "not_checked" ? <span className={s.meta}>not checked</span> : (
            <span className={dncStale || lead.national_dnc_status === "registered" ? s.errText : undefined}>
              {human(lead.national_dnc_status)}{checkedDays !== null ? ` · checked ${checkedDays === 0 ? "today" : `${checkedDays} day${checkedDays === 1 ? "" : "s"} ago`}` : ""}
              {dncStale ? " · expired, check again" : ""}
            </span>
          )}
          {lead.phone_type === "business_listed" && <span className={s.meta}> · listed business line, calls don&apos;t need it</span>}
        </dd>
        <dt>Texts</dt>
        <dd>
          {lead.sms_consent === "none" ? <span className={s.meta}>no consent logged: texting is blocked</span> : (
            <>
              {human(lead.sms_consent)} · {human(lead.consent_method)} · for {formatPhone(lead.consent_phone)}
              {lead.consent_phone !== lead.phone && <span className={s.errText}> · not the lead&apos;s current number</span>}
              {lead.consent_text && <span className={s.quote}>“{lead.consent_text}”</span>}
            </>
          )}
        </dd>
        <dt>Email</dt>
        <dd>
          {lead.email ? <>{lead.email} <span className={s.meta}>· {lead.email_source ? human(lead.email_source).toLowerCase() : "source unknown"}</span></> : <span className={s.meta}>none</span>}
          {(lead.email_unsubscribed || suppressed) && <span className={s.errText}> · {lead.email_unsubscribed ? "unsubscribed" : "on the suppression list"}</span>}
        </dd>
        <dt>Their clock</dt>
        <dd>{zone.tz ? <>{zone.tz.replace(/^.*\//, "").replace(/_/g, " ")} <span className={s.meta}>· {new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone.tz })} there now</span></> : <span className={s.errText}>not set: calls are blocked until it is</span>}</dd>
        <dt>Recording</dt>
        <dd>
          <select
            className={s.inlineSelect}
            value={lead.recording_consent ?? ""}
            disabled={busy || lead.do_not_contact}
            onChange={(e) => act(`/api/admin/sales/leads/${lead.id}`, "PATCH", { recording_consent: e.target.value || null }, "Recording answer saved.")}
            aria-label="Call recording consent"
          >
            <option value="">Not asked</option>
            {RECORDING_CONSENT.map((x) => <option key={x} value={x}>{human(x)}</option>)}
          </select>
        </dd>
      </dl>

      {rules.length > 0 && (
        <ul className={s.rules}>
          {rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}

      {!lead.do_not_contact && (
        <div className={s.cbActions}>
          {lead.phone && (
            <>
              <button type="button" className={s.mini} disabled={busy}
                onClick={() => act(`/api/admin/sales/leads/${lead.id}`, "PATCH", { national_dnc_status: "clear" }, "DNC check recorded: clear, today.")}>
                DNC check today: clear
              </button>
              <button type="button" className={s.mini} disabled={busy}
                onClick={() => act(`/api/admin/sales/leads/${lead.id}`, "PATCH", { national_dnc_status: "registered" }, "DNC check recorded: registered, today.")}>
                DNC check today: registered
              </button>
              <button type="button" className={s.mini} aria-expanded={open === "consent"} onClick={() => { setOpen(open === "consent" ? null : "consent"); setMsg(null); }}>
                Record text consent
              </button>
            </>
          )}
          {lead.email && !lead.email_unsubscribed && (
            <button type="button" className={s.mini} disabled={busy}
              onClick={() => confirm(`Mark ${lead.email} unsubscribed? It can't be undone from the app.`) &&
                act(`/api/admin/sales/leads/${lead.id}`, "PATCH", { email_unsubscribed: true }, "Email marked unsubscribed.")}>
              Email unsubscribed
            </button>
          )}
          <button type="button" className={`${s.mini} ${s.danger}`} aria-expanded={open === "dnc"} onClick={() => { setOpen(open === "dnc" ? null : "dnc"); setMsg(null); }}>
            Mark do-not-contact
          </button>
        </div>
      )}

      {open === "consent" && (
        <form className={s.reveal} onSubmit={(e) => {
          e.preventDefault();
          act(`/api/admin/sales/leads/${lead.id}`, "PATCH", { sms_consent: "marketing", consent_text: consent.text, consent_method: consent.method, consent_phone: consent.phone }, "Text consent recorded.");
        }}>
          <label className={a.field}>
            <span className="label">What they agreed to, in their words</span>
            <textarea rows={2} value={consent.text} onChange={(e) => setConsent({ ...consent, text: e.target.value })} required maxLength={2000} placeholder="Yes, text me about the pilot at this number" />
          </label>
          <div className={a.two}>
            <label className={a.field}>
              <span className="label">How</span>
              <select value={consent.method} onChange={(e) => setConsent({ ...consent, method: e.target.value })}>
                {CONSENT_METHODS.filter((m) => !wa || m === "written_form" || m === "signed_pilot").map((m) => <option key={m} value={m}>{human(m)}</option>)}
              </select>
            </label>
            <label className={a.field}>
              <span className="label">The exact number</span>
              <input type="tel" value={consent.phone} onChange={(e) => setConsent({ ...consent, phone: e.target.value })} required />
            </label>
          </div>
          {wa && <span className={a.hint}>Washington needs written consent: a signed form or the signed pilot.</span>}
          <span className={a.hint}>Consent covers this number only. A different number stays blocked for texts.</span>
          <div className={a.actions}>
            <button type="submit" className={`btn btn-primary ${a.smallBtn}`} disabled={busy}>Save consent</button>
            <button type="button" className={s.mini} onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </form>
      )}

      {open === "dnc" && (
        <form className={`${s.reveal} ${s.revealDanger}`} onSubmit={(e) => {
          e.preventDefault();
          act(`/api/admin/sales/leads/${lead.id}/dnc`, "POST", { channel: dnc.channel, note: dnc.note }, "Marked do-not-contact.");
        }}>
          <p className={s.warnText}>
            This is permanent. The lead moves to Lost, its next action is cleared, and its phone and email go on the suppression list,
            so no import or quick add can bring them back. Only a manual database change can undo it.
          </p>
          <div className={a.two}>
            <label className={a.field}>
              <span className="label">How they asked</span>
              <select value={dnc.channel} onChange={(e) => setDnc({ ...dnc, channel: e.target.value })}>
                {DNC_CHANNELS.map((c) => <option key={c} value={c}>{human(c)}</option>)}
              </select>
            </label>
            <label className={a.field}>
              <span className="label">Note</span>
              <input value={dnc.note} onChange={(e) => setDnc({ ...dnc, note: e.target.value })} maxLength={500} placeholder="Owner said: please stop" />
            </label>
          </div>
          <div className={a.actions}>
            <button type="submit" className={`btn ${s.dangerBtn} ${a.smallBtn}`} disabled={busy}>{busy ? "Saving…" : "Yes, never contact again"}</button>
            <button type="button" className={s.mini} onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </form>
      )}

      {msg && <div className={`toast ${msg.ok ? "ok" : "bad"}`} role="status" style={{ marginTop: 0 }}>{msg.text}</div>}
    </section>
  );
}
