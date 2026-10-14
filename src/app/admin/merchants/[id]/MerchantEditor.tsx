"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EARN_RATE, type TemplateKey } from "@/lib/config";
import { hexToRgb } from "@/lib/admin/merchant";
import { ColorFields, EarnHint, TemplatePicker, WalletPreview, type Colors } from "../../fields";
import s from "../../admin.module.css";

type Values = { name: string; earnRate: string; template: TemplateKey; colors: Colors };

export default function MerchantEditor({
  id, initial, logo, strip,
}: { id: string; initial: Values; logo?: string; strip?: string }) {
  const router = useRouter();
  const [v, setV] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<Values>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setMsg(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/admin/merchants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: v.name,
        earnRate: Number(v.earnRate),
        template: v.template,
        bgColor: hexToRgb(v.colors.bg),
        fgColor: hexToRgb(v.colors.fg),
        labelColor: hexToRgb(v.colors.label),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 401) return router.push("/admin/login");
    if (!res.ok) return setMsg({ ok: false, text: data.error || "Could not save" });
    setMsg({ ok: true, text: "Saved. New and refreshed cards use these settings." });
    router.refresh();
  }

  return (
    <form onSubmit={save} className={s.formGrid}>
      <div className={s.section} style={{ minWidth: 0 }}>
        <div className={s.two}>
          <label className={s.field}>
            <span className="label">Business name</span>
            <input value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} required />
          </label>
          <label className={s.field}>
            <span className="label">Points per $1</span>
            <input type="number" inputMode="decimal" min={EARN_RATE.min} max={EARN_RATE.max} step="any" value={v.earnRate} onChange={(e) => set({ earnRate: e.target.value })} required />
          </label>
        </div>
        <EarnHint rate={Number(v.earnRate)} template={v.template} />
        <div className={s.field}>
          <span className="label">Redeem buttons</span>
          <TemplatePicker value={v.template} onChange={(template) => set({ template })} />
        </div>
        <ColorFields value={v.colors} onChange={(colors) => set({ colors })} />
        {msg && <div className={`toast ${msg.ok ? "ok" : "bad"}`} role="status" style={{ marginTop: 0 }}>{msg.text}</div>}
        <div className={s.actions}>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn btn-ghost" style={{ width: "auto" }} onClick={() => set(initial)} disabled={busy}>Reset</button>
        </div>
      </div>
      <div className={s.side}>
        <WalletPreview name={v.name} colors={v.colors} logo={logo} strip={strip} />
        <div className={s.sideNote}>
          Cards already in customers&apos; Wallets pick up colour and name changes the next time they refresh (their next earn or redeem).
        </div>
      </div>
    </form>
  );
}
