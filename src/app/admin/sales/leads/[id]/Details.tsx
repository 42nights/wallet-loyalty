"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { US_TIMEZONES } from "@/lib/config";
import { formatPhone } from "@/lib/format";
import { stateTimezone } from "@/lib/sales/compliance";
import { LEAD_RULES, type LeadKey } from "@/lib/sales/fields";
import type { Lead, Person } from "@/lib/sales/types";
import { PERSONA_LABEL, fromLocalInput, human, toLocalInput } from "../labels";
import { send } from "../api";
import a from "../../../admin.module.css";
import s from "../../sales.module.css";

// Every editable field (spec §2.3 panel 1), grouped. Input types come from
// LEAD_RULES, the API's own validation table, so the two never drift. Saving
// sends only what changed; the API validates and strips server-owned fields.
// Stage, assignee and next action live in the pipeline strip; compliance
// fields in the compliance box.

const GROUPS: [string, [LeadKey, string][]][] = [
  ["Shop", [
    ["business_name", "Business name"], ["segment", "Type"], ["address", "Street address"], ["city", "City"],
    ["state", "State"], ["zip", "ZIP"], ["cluster", "Cluster"], ["recipient_tz", "Their time zone"],
    ["opened_on", "Opened on"], ["chain_size", "Locations"],
  ]],
  ["Phone and email", [
    ["phone", "Phone"], ["phone_type", "Phone type"], ["phone_source", "Phone came from"],
    ["email", "Email"], ["email_source", "Email came from"],
  ]],
  ["Owner", [
    ["owner_name", "Owner name"], ["owner_entity", "Legal entity"], ["owner_present", "Owner at the counter"],
    ["owner_hours", "When the owner is in"], ["owner_contact_route", "Best way to the owner"], ["language", "Language"],
  ]],
  ["Fit", [
    ["persona", "Persona"], ["pos_seen", "Till / POS seen"], ["loyalty_now", "Loyalty today"],
    ["franchise_brand", "Franchise brand"], ["fdd_loyalty_vendor", "FDD names a loyalty vendor"],
    ["website", "Website"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["social_active", "Posts on social"],
  ]],
  ["Source and deal", [
    ["source", "Source"], ["source_id", "Source record id"], ["source_pulled_at", "Pulled on"], ["sourced_by_id", "Sourced by"],
    ["lost_reason", "Lost reason"], ["pilot_started_at", "Pilot started (Pacific)"], ["first_paid_at", "First paid (Pacific)"],
    ["month4_paid_at", "Month-4 paid (Pacific)"], ["merchant_id", "Merchant id, once won"], ["referred_by_merchant_id", "Referred by merchant id"],
  ]],
];
// Enum columns that can't be empty (schema NOT NULL).
const REQUIRED = new Set<LeadKey>(["business_name", "segment", "phone_type", "owner_present", "fdd_loyalty_vendor", "source"]);

const asInput = (k: LeadKey, v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (LEAD_RULES[k] === "ts") return toLocalInput(String(v));
  if (k === "phone") return formatPhone(String(v));
  return String(v);
};
const initialOf = (lead: Lead) =>
  Object.fromEntries(GROUPS.flatMap(([, fs]) => fs).map(([k]) => [k, asInput(k, lead[k])])) as Record<LeadKey, string>;

export default function Details({ lead, people }: { lead: Lead; people: Person[] }) {
  const router = useRouter();
  // Only the fields the admin typed in are held here; the rest follow the lead
  // as other panels change it. `saved` bridges the gap until refresh lands.
  const [saved, setSaved] = useState(lead);
  const initial = initialOf(saved.updated_at > lead.updated_at ? saved : lead);
  const [edits, setEdits] = useState<Partial<Record<LeadKey, string>>>({});
  const v = { ...initial, ...edits };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = (Object.keys(edits) as LeadKey[]).filter((k) => edits[k] !== initial[k]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !changed.length) return;
    setBusy(true);
    const body: Record<string, string | null> = {};
    for (const k of changed) body[k] = LEAD_RULES[k] === "ts" ? fromLocalInput(v[k]) : v[k].trim() || null;
    const r = await send<{ lead: Lead }>(`/api/admin/sales/leads/${lead.id}`, "PATCH", body);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error === "suppressed" ? "That phone or email opted out. It can't be added back." : r.error });
    setSaved(r.data.lead);
    setEdits({});
    setMsg({ ok: true, text: `Saved ${changed.length} field${changed.length === 1 ? "" : "s"}.` });
    router.refresh();
  }

  function input(k: LeadKey, label: string) {
    const rule = LEAD_RULES[k];
    const on = (val: string) => { setEdits((cur) => ({ ...cur, [k]: val })); setMsg(null); };
    const common = { value: v[k], onChange: (e: { target: { value: string } }) => on(e.target.value), name: k };
    let control: JSX.Element;
    if (Array.isArray(rule)) {
      control = (
        <select {...common}>
          {!REQUIRED.has(k) && <option value="">—</option>}
          {rule.map((x: string) => <option key={x} value={x}>{k === "persona" ? PERSONA_LABEL[x] : x === "cafe" ? "Café" : x === "people_search" ? "Apollo verified" : human(x)}</option>)}
        </select>
      );
    } else if (k === "sourced_by_id") {
      control = (
        <select {...common}>
          <option value="">Nobody</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactive)"}</option>)}
        </select>
      );
    } else if (rule === "tz") {
      const guess = stateTimezone(v.state || null);
      control = (
        <select {...common}>
          <option value="">{guess ? `State default (${guess.replace(/^.*\//, "").replace(/_/g, " ")})` : "Not set"}</option>
          {v[k] && !US_TIMEZONES.some((t) => t.id === v[k]) && <option value={v[k]}>{v[k]}</option>}
          {US_TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      );
    } else if (rule === "bool") {
      control = (
        <select {...common}>
          <option value="">Unknown</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    } else {
      const type = rule === "date" ? "date" : rule === "ts" ? "datetime-local" : rule === "int" ? "number" : rule === "email" ? "email" : rule === "phone" ? "tel" : "text";
      control = <input {...common} type={type} min={rule === "int" ? 1 : undefined} maxLength={rule === "state" ? 2 : 500} required={REQUIRED.has(k)} />;
    }
    return (
      <label key={k} className={a.field} data-changed={v[k] !== initial[k] || undefined}>
        <span className="label">{label}</span>
        {control}
      </label>
    );
  }

  return (
    <form className={`panel ${s.details}`} onSubmit={save} aria-labelledby="dt-h">
      <div className="panel-h">
        <h2 className="panel-t" id="dt-h">Details</h2>
        <span className={s.meta}>{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "all saved"}</span>
      </div>
      {GROUPS.map(([name, fields]) => (
        <fieldset key={name} className={s.group}>
          <legend>{name}</legend>
          <div className={s.groupGrid}>{fields.map(([k, label]) => input(k, label))}</div>
        </fieldset>
      ))}
      <div className={s.saveBar} data-on={changed.length > 0}>
        {msg && <span className={msg.ok ? a.ok : s.errText} role="status">{msg.text}</span>}
        <button type="button" className={s.mini} onClick={() => { setEdits({}); setMsg(null); }} disabled={busy || !changed.length}>Reset</button>
        <button type="submit" className={`btn btn-primary ${a.smallBtn}`} disabled={busy || !changed.length}>{busy ? "Saving…" : "Save details"}</button>
      </div>
    </form>
  );
}
