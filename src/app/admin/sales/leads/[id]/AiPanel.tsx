"use client";
import { useState } from "react";
import { DRAFT_ROLES, type Draft, type DraftRole, type Lead } from "@/lib/sales/types";
import { AI_CAPTION, AI_OFF, FLAG_TEXT, ROLE_LABEL, when } from "../labels";
import { send } from "../api";
import { CopyButton } from "./ScriptsPanel";
import type { Verdicts } from "./LeadView";
import a from "../../../admin.module.css";
import s from "../../sales.module.css";

// The AI team (spec §5): one button per role. A draft is text for the admin to
// edit and send by hand; nothing here sends anything. The email roles follow
// checkContact()'s email verdict, as the draft route does.

export default function AiPanel({ lead, enabled, drafts, verdicts }: { lead: Lead; enabled: boolean; drafts: Draft[]; verdicts: Verdicts }) {
  const [list, setList] = useState(drafts);
  const [cur, setCur] = useState<{ draft: Draft; text: string } | null>(null);
  const [better, setBetter] = useState(false);
  const [busy, setBusy] = useState<DraftRole | null>(null);
  const [err, setErr] = useState("");

  if (!enabled)
    return (
      <section className="panel" aria-labelledby="ai-h">
        <div className="panel-h"><h2 className="panel-t" id="ai-h">AI team</h2></div>
        <p className={s.empty}>{AI_OFF}</p>
      </section>
    );

  const email = verdicts.email;
  const blockOf = (role: DraftRole): string | null => {
    if (lead.do_not_contact) return verdicts.walk_in.reason ?? "Do not contact.";
    if ((role === "followup" || role === "owner_email") && !email.allowed) return email.reason ?? "Email is blocked.";
    if (role === "owner_email" && lead.persona !== "P2" && lead.owner_present !== "no")
      return "For owners who aren't in every day: set persona P2 or Owner at the counter = no.";
    return null;
  };

  async function draft(role: DraftRole) {
    if (busy) return;
    setBusy(role);
    setErr("");
    const r = await send<{ draft: Draft }>(`/api/admin/sales/leads/${lead.id}/draft`, "POST", { role, better });
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setCur({ draft: r.data.draft, text: r.data.draft.body });
    setList((l) => [r.data.draft, ...l].slice(0, 5));
  }

  return (
    <section className="panel" aria-labelledby="ai-h">
      <div className="panel-h">
        <h2 className="panel-t" id="ai-h">AI team</h2>
        <label className={s.betterToggle}>
          <input type="checkbox" checked={better} onChange={(e) => setBetter(e.target.checked)} /> Better model (slower)
        </label>
      </div>
      <div className={s.roles}>
        {DRAFT_ROLES.map((role) => {
          const why = blockOf(role);
          return (
            <div key={role} className={s.role}>
              <button type="button" className={s.roleBtn} disabled={!!why || busy !== null} onClick={() => draft(role)} aria-busy={busy === role}>
                <span className={s.roleName}>{busy === role ? "Writing…" : ROLE_LABEL[role].name}</span>
                <span className={s.roleWhat}>{ROLE_LABEL[role].what}</span>
              </button>
              {why && <span className={s.why}>{why}</span>}
            </div>
          );
        })}
      </div>
      {err && <div className="toast bad" role="alert" style={{ marginTop: 0 }}>{err}</div>}

      {cur && (
        <div className={s.draft}>
          <div className={s.draftHead}>
            <span className={s.draftTag}>Draft · review before sending</span>
            <span className={s.meta}>{ROLE_LABEL[cur.draft.role].name} · {cur.draft.model}</span>
          </div>
          {cur.draft.flags.length > 0 && (
            <ul className={s.warnList} aria-label="Check before sending">
              {cur.draft.flags.map((f) => <li key={f}>{FLAG_TEXT[f] ?? f}</li>)}
            </ul>
          )}
          <textarea className={s.draftText} rows={10} value={cur.text} onChange={(e) => setCur({ ...cur, text: e.target.value })} aria-label="Draft text" />
          <div className={a.actions}>
            <CopyButton text={cur.text} label="Copy draft" />
          </div>
        </div>
      )}

      {list.length > 0 && (
        <>
          <div className="label" style={{ margin: "4px 0 0" }}>Last {list.length} drafts</div>
          <ul className={s.list}>
            {list.map((d) => (
              <li key={d.id} className="lrow">
                <button type="button" className={s.linkBtn} onClick={() => setCur({ draft: d, text: d.body })}>
                  {ROLE_LABEL[d.role].name}
                </button>
                <span className={s.meta}>{when(d.created_at)}{d.flags.length ? ` · ${d.flags.length} to check` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={s.caption}>{AI_CAPTION}</p>
    </section>
  );
}
