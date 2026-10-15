import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { checkContact } from "@/lib/sales/compliance";
import { MERGE_KEYS, SCRIPTS, mergeFields, renderScript, salesEnv } from "@/lib/sales/scripts";
import { getLead, leadCompliance, leadRecent } from "@/lib/sales/server";
import { CHANNELS, PERSONAS, isOneOf, type Channel, type Lead } from "@/lib/sales/types";
import { PERSONA_LABEL } from "../leads/labels";
import { CopyButton, LeadPicker } from "./ScriptTools";
import s from "../../admin.module.css";
import t from "../tools.module.css";

export const runtime = "nodejs";

// A made-up shop for the merge preview when no lead is picked.
const SAMPLE: Parameters<typeof mergeFields>[0] = {
  id: "5a3b1e00-0000-4000-8000-000000000000", business_name: "Maple & Rye Café", owner_name: "Dana Reyes",
  address: "214 Elm St", cluster: "Elm St", segment: "cafe", source: "walk_in", next_action_at: null,
  recipient_tz: "America/New_York", state: "NY",
};

const CHANNEL_LABEL: Record<Channel, string> = {
  walk_in: "counter", call: "phone", voicemail: "voicemail", email: "email", text: "text", dm: "DM", postcard: "postcard",
};
const anchor = (tab: string) => `tab-${tab.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

// Strategy §2.2: the track each persona gets, and the scripts that track
// uses (script ids from src/lib/sales/scripts.ts).
const COUNTER_CLOSE = [
  "counter_opener", "routing_question", "first_10_seconds", "questions", "phone_call", "phone_rule_line", "voicemail",
  "email_first_touch", "email_followup", "email_after_demo", "dm_first_touch", "close_the_loop", "referral_ask", "opt_out",
];
const TRACKS: Record<(typeof PERSONAS)[number], { track: string; how: string; ids: string[] }> = {
  P1: { track: "Counter close", how: "Walk in at the lull with the one-pager in their language. WhatsApp only after they give the number and agree.", ids: COUNTER_CLOSE },
  P2: {
    track: "Manager first, then the owner",
    how: "Win the manager with the 90-second demo, then ask to email the owner the demo link. Try a Saturday morning. Calls go to the shop line only.",
    ids: ["counter_opener", "routing_question", "p2_manager_handoff", "p2_owner_email", "phone_call", "phone_rule_line", "voicemail", "email_followup", "close_the_loop", "opt_out"],
  },
  P3: { track: "Counter close", how: "The existing sales kit, unchanged. Ask how long they've had the place: new owners change things anyway.", ids: COUNTER_CLOSE },
  P4: { track: "Per location only, until L6", how: "Points don't carry across shops yet. Sell per location if the owner accepts that; otherwise log the lead \"waiting for L6\".", ids: COUNTER_CLOSE },
  P5: { track: "Influencer, not buyer", how: "Note the brand, check the FDD, and ask for an introduction to the franchisor. Don't demo for a sale.", ids: ["franchise_unit", "opt_out"] },
  P6: { track: "After L6 ships", how: "Headquarters: lead with cost per unit and proof of return. No script until L6 ships.", ids: [] },
  P7: { track: "Not a target", how: "Buys what the franchisor approves and needs rollups. If you walk into one, treat it as a franchise unit.", ids: ["franchise_unit", "opt_out"] },
};

// [brackets] left in a filled script are for the rep to fill in.
function Body({ text }: { text: string }) {
  return (
    <pre className={t.scriptBody}>
      {text.split(/(\[[^\]\n]{1,80}\])/g).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </pre>
  );
}

// Script library (admin-sales spec §2.6): every script in
// src/lib/sales/scripts.ts, filled for a sample shop or a picked lead. With a
// lead, a script whose channel checkContact() blocks right now can't be
// copied, same as the lead page's scripts panel.
export default async function SalesScriptsPage({ searchParams }: { searchParams: Promise<{ lead?: string; persona?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { lead: leadId, persona: personaParam } = await searchParams;
  const env = salesEnv();
  const lead: Lead | null = leadId ? await getLead(leadId) : null;
  // ?persona=all shows every script; no param follows the picked lead's persona.
  const persona = isOneOf(PERSONAS, personaParam) ? personaParam : personaParam === "all" ? null : (lead?.persona ?? null);
  const shown = persona ? SCRIPTS.filter((x) => TRACKS[persona].ids.includes(x.id)) : SCRIPTS;
  const href = (p: string) => `/admin/sales/scripts?${new URLSearchParams({ ...(lead ? { lead: lead.id } : {}), persona: p })}`;

  let repName: string | null = null;
  const blocked: Partial<Record<Channel, string>> = {};
  if (lead) {
    const now = new Date();
    const [rep, compliance, recent] = await Promise.all([
      lead.assignee_id ? db.from("sales_people").select("name").eq("id", lead.assignee_id).maybeSingle() : null,
      leadCompliance(lead),
      leadRecent(lead, now),
    ]);
    repName = (rep?.data?.name as string | undefined) ?? null;
    for (const ch of CHANNELS) {
      const v = checkContact(compliance, ch, now, recent, { postalAddressSet: !!env.postalAddress });
      if (!v.allowed) blocked[ch] = v.reason ?? "Blocked";
    }
  }
  const fields = mergeFields(lead ?? SAMPLE, repName, env);
  const tabs = [...new Set(shown.map((x) => x.tab))];

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className={s.title}>Scripts</h1>
          <div className={s.sub}>
            {persona ? `${shown.length} of ${SCRIPTS.length}` : SCRIPTS.length} scripts from src/lib/sales/scripts.ts, filled with {lead ? lead.business_name : "a sample shop"}. Edit the wording in code; the source of each one is under its title.
          </div>
        </div>
      </div>

      <div className={`${t.flow} ${t.scriptsGrid}`}>
        <aside className={t.scriptsSide}>
          <div className="panel">
            <span className="panel-t">Fill with</span>
            <LeadPicker current={{ id: lead?.id ?? null, name: (lead ?? SAMPLE).business_name }} />
            {leadId && !lead && <span className={`${s.hint} ${s.bad}`}>That lead doesn&apos;t exist. Showing the sample shop.</span>}
            {lead?.do_not_contact && (
              <span className={`${s.hint} ${s.bad}`}>Do-not-contact: every outreach script is blocked for this lead.</span>
            )}
            <details className={t.details}>
              <summary>Merge fields</summary>
              <dl className={t.fields}>
                {MERGE_KEYS.filter((k) => k !== "footer").map((k) => (
                  <div key={k}>
                    <dt>{`{{${k}}}`}</dt>
                    <dd>{fields[k] ?? <span className={t.muted}>empty</span>}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <ul className={t.envList}>
              <li data-on={!!env.postalAddress || undefined}>
                {env.postalAddress ? "CAN-SPAM footer on" : "Email scripts off: set SALES_POSTAL_ADDRESS"}
              </li>
              <li data-on={!!env.referenceShop || undefined}>
                {env.referenceShop ? `Pilot shop named: ${env.referenceShop}` : "Pilot-shop line left out: set SALES_REFERENCE_SHOP once a pilot agrees"}
              </li>
            </ul>
          </div>
          <div className={t.sideBlock}>
            <span className="label" style={{ margin: 0 }}>Persona</span>
            <nav className={t.jump} aria-label="Persona">
              <Link href={href("all")} aria-current={!persona || undefined}>All <small>{SCRIPTS.length}</small></Link>
              {PERSONAS.map((p) => (
                <Link key={p} href={href(p)} aria-current={persona === p || undefined}>
                  {PERSONA_LABEL[p]} <small>{TRACKS[p].ids.length}</small>
                </Link>
              ))}
            </nav>
          </div>
          {tabs.length > 0 && (
            <div className={t.sideBlock}>
              <span className="label" style={{ margin: 0 }}>Channel</span>
              <nav className={t.jump} aria-label="Script groups">
                {tabs.map((tab) => (
                  <a key={tab} href={`#${anchor(tab)}`}>
                    {tab} <small>{shown.filter((x) => x.tab === tab).length}</small>
                  </a>
                ))}
              </nav>
            </div>
          )}
        </aside>

        <div className={t.scriptGroups}>
          {persona && (
            <div className={`panel ${t.track}`}>
              <span className={t.trackT}>{PERSONA_LABEL[persona]} · {TRACKS[persona].track}</span>
              <p>{TRACKS[persona].how}</p>
              {lead?.persona === persona && <span className={s.hint}>From {lead.business_name}&apos;s persona.</span>}
            </div>
          )}
          {tabs.map((tab) => (
            <section key={tab} id={anchor(tab)} className={t.scriptGroup}>
              <h2 className={t.groupT}>{tab}</h2>
              {shown.filter((x) => x.tab === tab).map((sc) => {
                const r = renderScript(sc, fields);
                const text = r.text.trim();
                const reason = r.disabled ?? (sc.channel ? blocked[sc.channel] : undefined) ?? null;
                return (
                  <article key={sc.id} className={`panel ${t.script}`} data-blocked={reason ? true : undefined}>
                    <div className={t.scriptHead}>
                      <div>
                        <h3 className={t.scriptT}>{sc.title}</h3>
                        <span className={s.slug}>{sc.source} · {sc.id}</span>
                      </div>
                      <span className={t.chan}>{sc.channel ? CHANNEL_LABEL[sc.channel] : "any"}</span>
                    </div>
                    <Body text={text} />
                    <div className={t.scriptFoot}>
                      <CopyButton text={text} disabled={!!reason} />
                      {reason && <span className={`${s.hint} ${t.warnText}`}>{reason}</span>}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
