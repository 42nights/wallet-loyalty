"use client";
import { useState } from "react";
import { formatPhone } from "@/lib/format";
import type { Lead } from "@/lib/sales/types";
import type { ShownScript, Verdicts } from "./LeadView";
import s from "../../sales.module.css";

// Scripts with this lead's merge fields filled in (spec §2.3 panel 4), one tab
// per channel. A script whose channel checkContact() blocks right now can't be
// copied or opened in the mail or phone app; the reason is shown instead.

export function CopyButton({ text, disabled, label = "Copy" }: { text: string; disabled?: boolean; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  async function copy() {
    const ok = await navigator.clipboard?.writeText(text).then(() => true, () => false);
    setState(ok ? "done" : "fail");
    setTimeout(() => setState("idle"), 1600);
  }
  return (
    <button type="button" className={s.mini} onClick={copy} disabled={disabled} aria-live="polite">
      {state === "done" ? "Copied" : state === "fail" ? "Select and copy" : label}
    </button>
  );
}

// "Subject: …" on its own line → mailto subject; the body is what follows it.
function mailto(email: string, text: string): string {
  const m = /^Subject: (.*)$/m.exec(text);
  const body = m ? text.slice(m.index + m[0].length).trim() : text;
  return `mailto:${email}?${m ? `subject=${encodeURIComponent(m[1])}&` : ""}body=${encodeURIComponent(body)}`;
}

export default function ScriptsPanel({ lead, scripts, verdicts }: { lead: Lead; scripts: ShownScript[]; verdicts: Verdicts }) {
  const tabs = [...new Set(scripts.map((x) => x.tab))];
  const [tab, setTab] = useState(tabs[0]);

  return (
    <section className="panel" aria-labelledby="sc-h">
      <div className="panel-h">
        <h2 className="panel-t" id="sc-h">Scripts</h2>
        <span className={s.meta}>filled in for this shop</span>
      </div>
      {lead.do_not_contact && <div className={s.why}>{verdicts.walk_in.reason} Scripts are read-only.</div>}
      <div className={s.scriptTabs} role="tablist" aria-label="Script channel">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={s.chip} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div role="tabpanel" className={s.scriptList}>
        {scripts.filter((x) => x.tab === tab).map((sc) => {
          const v = sc.channel ? verdicts[sc.channel] : null;
          const blocked = sc.disabled ?? (v && !v.allowed ? v.reason ?? "Blocked" : null);
          const phone = sc.channel === "call" || sc.channel === "voicemail";
          return (
            <article key={sc.id} className={s.script} data-blocked={!!blocked}>
              <div className={s.scriptHead}>
                <h3 className={s.scriptTitle}>{sc.title}</h3>
                <span className={s.meta}>{sc.source}</span>
              </div>
              <div className={s.scriptBody}>{sc.text}</div>
              {blocked && !lead.do_not_contact && <div className={s.why}>{blocked}</div>}
              <div className={s.scriptActions}>
                <CopyButton text={sc.text} disabled={!!blocked} />
                {sc.channel === "email" && lead.email && !blocked && <a className={s.mini} href={mailto(lead.email, sc.text)}>Open in mail</a>}
                {phone && lead.phone && !blocked && <a className={s.mini} href={`tel:${lead.phone}`}>Call {formatPhone(lead.phone)}</a>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
