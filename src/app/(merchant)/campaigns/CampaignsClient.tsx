"use client";
import { useCallback, useEffect, useState } from "react";

type Segment = { key: string; label: string; count: number };
type Lift = { targeted: number; earned_after: number; lift_pct: number };
type Campaign = {
  id: string;
  name: string;
  segment: string;
  bonus_points: number;
  offer_text: string | null;
  status: string;
  targeted: number;
  created_at: string;
  sent_at: string | null;
  lift: Lift | null;
};

export default function CampaignsClient({ segments }: { segments: Segment[] }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [segment, setSegment] = useState(segments.find((s) => s.count > 0)?.key ?? segments[0]?.key ?? "");
  const [bonus, setBonus] = useState("100");
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const segLabel = (k: string) => segments.find((s) => s.key === k)?.label ?? k;
  const targetCount = segments.find((s) => s.key === segment)?.count ?? 0;

  const load = useCallback(async () => {
    const r = await fetch("/api/merchant/campaigns");
    if (!r.ok) return;
    const d = await r.json();
    setCampaigns(d.campaigns || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/merchant/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        segment,
        bonusPoints: parseInt(bonus, 10) || 0,
        offerText: offer.trim() || undefined,
      }),
    });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg({ kind: "bad", text: d.error || "Failed" });
    setMsg({ kind: "ok", text: `Sent to ${d.targeted} customer${d.targeted === 1 ? "" : "s"}.` });
    setName("");
    setOffer("");
    await load();
  }

  return (
    <>
      <div className="card stack">
        <div className="label">New campaign</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name (e.g. Win back lapsed)" />
        <div className="row" style={{ gap: 10 }}>
          <select value={segment} onChange={(e) => setSegment(e.target.value)} style={{ flex: 1 }}>
            {segments.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.count})
              </option>
            ))}
          </select>
          <input
            value={bonus}
            onChange={(e) => setBonus(e.target.value)}
            inputMode="numeric"
            placeholder="bonus pts"
            style={{ width: 110 }}
          />
        </div>
        <input
          value={offer}
          onChange={(e) => setOffer(e.target.value)}
          placeholder="Optional Wallet offer text (shown on card back)"
          maxLength={120}
        />
        <button className="btn" disabled={busy || !name.trim() || targetCount === 0} onClick={send}>
          {busy ? "Sending…" : `Reward ${targetCount} ${segLabel(segment)} customer${targetCount === 1 ? "" : "s"}`}
        </button>
        {targetCount === 0 && <div className="label">No customers in that segment yet.</div>}
        {msg && <div className={`toast ${msg.kind}`}>{msg.text}</div>}
        <div className="label" style={{ fontSize: 11 }}>
          Credits each targeted card and updates it live in Wallet. Lift = % who made a real purchase within 14 days.
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">History</div>
        {campaigns.length === 0 && <div className="label">No campaigns yet.</div>}
        {campaigns.map((c) => (
          <div key={c.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{c.name}</div>
              <div className="label">
                {segLabel(c.segment)} · +{c.bonus_points} pts · {c.targeted} targeted
                {c.offer_text ? " · offer" : ""}
              </div>
            </div>
            <div className="label" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              {c.lift
                ? `${c.lift.lift_pct}% came back (${c.lift.earned_after}/${c.lift.targeted})`
                : c.status}
              <br />
              {c.sent_at ? new Date(c.sent_at).toLocaleDateString("en-GB") : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
