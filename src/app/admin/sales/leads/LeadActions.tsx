"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SEGMENTS, type Lead, type Segment } from "@/lib/sales/types";
import { human } from "./labels";
import { send } from "./api";
import a from "../../admin.module.css";
import s from "../sales.module.css";

// Small lead actions used outside the lead page: quick add (Today) and
// snooze (a follow-up row).

// A shop met on the street (spec §2.1): source walk_in. The API refuses a
// phone that opted out and points at an existing lead instead of a duplicate.
export function QuickAddLead() {
  const router = useRouter();
  const [v, setV] = useState({ business_name: "", phone: "", segment: "cafe" as Segment });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = await send<{ lead: Lead }>("/api/admin/sales/leads", "POST", {
      business_name: v.business_name, segment: v.segment, source: "walk_in",
      ...(v.phone.trim() ? { phone: v.phone, phone_type: "business_listed", phone_source: "card_at_visit" } : {}),
    });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: `Added ${r.data.lead.business_name}.`, id: r.data.lead.id });
      setV({ business_name: "", phone: "", segment: v.segment });
      return router.refresh();
    }
    const text = r.error === "suppressed"
      ? "That phone number opted out. It can't be added back."
      : r.error === "duplicate" ? "Already in your leads." : r.error;
    setMsg({ ok: false, text, id: typeof r.data.id === "string" ? r.data.id : undefined });
  }

  return (
    <form onSubmit={add} className={s.quickAdd}>
      <label className={a.field}>
        <span className="label">Business</span>
        <input value={v.business_name} onChange={(e) => setV({ ...v, business_name: e.target.value })} maxLength={200} required placeholder="Bean & Bun" />
      </label>
      <div className={a.two}>
        <label className={a.field}>
          <span className="label">Shop phone</span>
          <input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="optional" />
        </label>
        <label className={a.field}>
          <span className="label">Type</span>
          <select value={v.segment} onChange={(e) => setV({ ...v, segment: e.target.value as Segment })}>
            {SEGMENTS.map((x) => <option key={x} value={x}>{x === "cafe" ? "Café" : human(x)}</option>)}
          </select>
        </label>
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add lead"}</button>
      {msg && (
        <div className={`toast ${msg.ok ? "ok" : "bad"}`} role="status" style={{ marginTop: 0 }}>
          {msg.text} {msg.id && <Link href={`/admin/sales/leads/${msg.id}`} className={s.inlineLink}>Open lead →</Link>}
        </div>
      )}
    </form>
  );
}

export function SnoozeButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function snooze() {
    setBusy(true);
    const r = await send(`/api/admin/sales/leads/${id}`, "PATCH", { next_action_at: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.refresh();
  }
  return (
    <>
      <button type="button" className={s.mini} onClick={snooze} disabled={busy}>{busy ? "…" : "Snooze 2 days"}</button>
      {err && <span className={s.errText} role="alert">{err}</span>}
    </>
  );
}
