"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EARN_RATE, STAMP_GOAL, type TemplateKey } from "@/lib/config";
import { colorBody, themeHex } from "@/lib/admin/merchant";
import { ColorFields, EarnHint, LoyaltyFields, TemplatePicker, TimezoneSelect, WalletPreview, type Colors, type Loyalty } from "../../fields";
import s from "../../admin.module.css";

// reviewUrl: https link or "". location: "lat, lng" or "". The API validates both.
type Values = {
  name: string;
  earnRate: string;
  timezone: string;
  template: TemplateKey;
  colors: Colors;
  loyalty: Loyalty;
  reviewUrl: string;
  location: string;
};

// Colours count as hand-picked once any of them differs from the template's
// theme (stored NULL and old copies of the theme both read as not picked).
const picked = (v: Values) => Object.values(colorBody(v.colors, v.template)).some((c) => c !== null);

// `txns` = the shop's transaction count: from the first one on, points vs stamps
// and the stamp goal are fixed (the API refuses them too, with the reason).
export default function MerchantEditor({
  id, initial, logo, strip, txns,
}: { id: string; initial: Values; logo?: string; strip?: string; txns: number }) {
  const router = useRouter();
  const [v, setV] = useState<Values>(initial);
  // Like the wizard: until colours are picked by hand they follow the template.
  const [touched, setTouched] = useState(() => picked(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const stamps = v.loyalty.mode === "stamps";
  const set = (patch: Partial<Values>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setMsg(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    // Stamp card fields and the time zone go only when changed: an unchanged
    // merchant never writes the later columns, and an unchanged mode/goal is
    // never refused for having sales.
    const l = v.loyalty;
    const was = initial.loyalty;
    const res = await fetch(`/api/admin/merchants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: v.name,
        earnRate: Number(v.earnRate),
        ...(v.timezone !== initial.timezone ? { timezone: v.timezone } : {}),
        template: v.template,
        ...colorBody(v.colors, v.template),
        ...(l.mode !== was.mode ? { loyaltyMode: l.mode } : {}),
        ...(l.mode === "stamps" && Number(l.goal) !== Number(was.goal) ? { stampGoal: Number(l.goal) } : {}),
        ...(l.mode === "stamps" && l.reward.trim() !== was.reward ? { stampReward: l.reward } : {}),
        // only when edited, so a database without these columns yet still saves the rest
        ...(v.reviewUrl !== initial.reviewUrl && { reviewUrl: v.reviewUrl }),
        ...(v.location !== initial.location && { location: v.location }),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 401) return router.push("/admin/login");
    if (!res.ok) return setMsg({ ok: false, text: data.error || "Could not save" });
    setMsg({ ok: true, text: "Saved. Cards in customers' Wallets update in a few seconds." });
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
          {!stamps && (
            <label className={s.field}>
              <span className="label">Points per $1</span>
              <input type="number" inputMode="decimal" min={EARN_RATE.min} max={EARN_RATE.max} step="any" value={v.earnRate} onChange={(e) => set({ earnRate: e.target.value })} required />
            </label>
          )}
        </div>
        {!stamps && <EarnHint rate={Number(v.earnRate)} template={v.template} />}
        <TimezoneSelect value={v.timezone} onChange={(timezone) => set({ timezone })} />
        <div className={s.field}>
          <span className="label">Loyalty card</span>
          <LoyaltyFields
            value={v.loyalty}
            onChange={(loyalty) => set({ loyalty })}
            locked={
              txns > 0
                ? `Points vs stamps and the number of stamps are fixed: this shop has ${txns} transaction${txns === 1 ? "" : "s"}, ` +
                  "and changing either would change what every customer's balance is worth. The reward's name can still change."
                : undefined
            }
          />
        </div>
        <div className={s.field}>
          <span className="label">{stamps ? "Card style (colours and default art)" : "Redeem buttons"}</span>
          <TemplatePicker value={v.template} onChange={(template) => set(touched ? { template } : { template, colors: themeHex(template) })} rewards={!stamps} />
        </div>
        <ColorFields value={v.colors} onChange={(colors) => { setTouched(true); set({ colors }); }} />
        <div className={s.two}>
          <label className={s.field}>
            <span className="label">Review link</span>
            <input type="url" value={v.reviewUrl} onChange={(e) => set({ reviewUrl: e.target.value })} maxLength={500} placeholder="https://g.page/r/…/review" />
          </label>
          <label className={s.field}>
            <span className="label">Shop location (lat, lng)</span>
            <input value={v.location} onChange={(e) => set({ location: e.target.value })} placeholder="37.77493, -122.41942" />
          </label>
        </div>
        <span className={s.hint}>
          The review link shows on the back of the card from a customer&apos;s 3rd visit. The location (right-click the shop in
          Google Maps and click the numbers) lets iPhones offer the card on the Lock Screen nearby. Both optional.
        </span>
        {msg && <div className={`toast ${msg.ok ? "ok" : "bad"}`} role="status" style={{ marginTop: 0 }}>{msg.text}</div>}
        <div className={s.actions}>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn btn-ghost" style={{ width: "auto" }} onClick={() => { set(initial); setTouched(picked(initial)); }} disabled={busy}>Reset</button>
        </div>
      </div>
      <div className={s.side}>
        <WalletPreview name={v.name} colors={v.colors} logo={logo} strip={strip}
          stampGoal={stamps ? Number(v.loyalty.goal) || STAMP_GOAL.default : undefined} />
        <div className={s.sideNote}>
          Saving also refreshes the cards already in customers&apos; Wallets.
        </div>
      </div>
    </form>
  );
}
