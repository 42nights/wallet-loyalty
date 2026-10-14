"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { unitLabel, type LoyaltyMode } from "@/lib/config";

const MAX_BONUS = 100_000; // the campaigns route's own cap (a stamp card: its goal)
const MAX_TARGETS = 2000; // the route sends to at most this many cards per campaign
const nf = (n: number) => n.toLocaleString();

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

// `mode`: a stamp card gives bonus stamps, at most one full card (`stampGoal`),
// and has no lift (campaign_lift counts bills, earn:purchase, which a stamp card
// never records), so lift is not shown.
export default function CampaignsClient({
  segments,
  mode,
  stampGoal,
}: {
  segments: Segment[];
  mode: LoyaltyMode;
  stampGoal: number;
}) {
  const stamps = mode === "stamps";
  const maxBonus = stamps ? stampGoal : MAX_BONUS;
  const u = (n: number) => unitLabel(mode, n, true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [segment, setSegment] = useState(segments.find((s) => s.count > 0)?.key ?? segments[0]?.key ?? "");
  const [bonus, setBonus] = useState(stamps ? "1" : "100");
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const sendId = useMemo(() => crypto.randomUUID(), [name, segment, bonus, offer]);

  const segLabel = (k: string) => segments.find((s) => s.key === k)?.label ?? k;
  const targetCount = segments.find((s) => s.key === segment)?.count ?? 0;
  // What the confirm promises must match what the route can send: it caps a
  // campaign at MAX_TARGETS cards and re-reads the segment at send time.
  const sendCount = Math.min(targetCount, MAX_TARGETS);
  // Whole points only; "abc", "-5" or "1.5" must not quietly become a number.
  const bonusPts = /^\d+$/.test(bonus.trim()) ? Number(bonus.trim()) : NaN;
  const who = `${nf(targetCount)} ${segLabel(segment)} customer${targetCount === 1 ? "" : "s"}`;
  // Any edit invalidates what the confirm box said.
  const change = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setConfirming(false);
  };

  const load = useCallback(async () => {
    const r = await fetch("/api/merchant/campaigns");
    if (!r.ok) return;
    const d = await r.json();
    setCampaigns(d.campaigns || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(body: object): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/merchant/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ kind: "bad", text: d.error || "Couldn't send the campaign. Check History before trying again." });
        return false;
      }
      setMsg({ kind: "ok", text: `Sent to ${nf(d.targeted)} customer${d.targeted === 1 ? "" : "s"}.` });
      return true;
    } catch {
      setMsg({ kind: "bad", text: "Network error. Check History before sending again." });
      return false;
    } finally {
      setBusy(false);
      await load().catch(() => {});
    }
  }

  // Step 1: check the form and show what will happen. Nothing is sent yet.
  function review() {
    setMsg(null);
    if (!name.trim()) return setMsg({ kind: "bad", text: "Give the campaign a name first." });
    if (!(bonusPts >= 0) || bonusPts > maxBonus)
      return setMsg({ kind: "bad", text: `Bonus must be a whole number of ${unitLabel(mode, 2)} from 0 to ${nf(maxBonus)}.` });
    if (bonusPts === 0 && !offer.trim())
      return setMsg({ kind: "bad", text: `Add bonus ${unitLabel(mode, 2)}, an offer, or both.` });
    setConfirming(true);
  }

  // Step 2: the owner saw the total and said yes.
  async function send() {
    if (busy) return;
    const sent = await post({
      id: sendId,
      name: name.trim(),
      segment,
      bonusPoints: bonusPts,
      offerText: offer.trim() || undefined,
    });
    setConfirming(false);
    if (sent) {
      setName("");
      setOffer("");
    }
  }

  return (
    <>
      <div className="card stack">
        <div className="label">New campaign</div>
        <input value={name} onChange={change(setName)} placeholder="Campaign name (e.g. Win back lapsed)" />
        <div className="row" style={{ gap: 10 }}>
          <select
            value={segment}
            onChange={change(setSegment)}
            className="btn btn-ghost"
            style={{ flex: 1, minWidth: 0, width: "auto", padding: "0 12px" }}
          >
            {segments.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({nf(s.count)})
              </option>
            ))}
          </select>
          <input
            value={bonus}
            onChange={change(setBonus)}
            inputMode="numeric"
            placeholder={`bonus ${u(2)}`}
            aria-label={`Bonus ${unitLabel(mode, 2)} per customer`}
            style={{ width: 110 }}
          />
        </div>
        <input
          value={offer}
          onChange={change(setOffer)}
          placeholder="Optional Wallet offer text (shown on card back)"
          maxLength={120}
        />
        <button className="btn btn-primary" disabled={busy || confirming || targetCount === 0} onClick={review}>
          {`Reward ${who}`}
        </button>
        {targetCount === 0 && <div className="label">No customers in that segment yet.</div>}
        {confirming && (
          <div className="confirm">
            {bonusPts > 0 ? (
              <>
                Give <b>{nf(bonusPts)} {u(bonusPts)}</b> to {who} — about <b>{nf(bonusPts * sendCount)} {u(bonusPts * sendCount)} total</b>
                {targetCount > MAX_TARGETS && <> (sent to the first {nf(MAX_TARGETS)})</>}. The segment is
                re-checked when you send, so the final count can differ slightly.
                {offer.trim() && <> Their Wallet card also shows “{offer.trim()}”.</>} This can&apos;t be undone.
              </>
            ) : (
              <>
                Show “{offer.trim()}” on the Wallet cards of {who}. No {unitLabel(mode, 2)} are given.
              </>
            )}
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={send}>
                {busy ? "Sending…" : "Yes, send it"}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {msg && <div className={`toast ${msg.kind}`}>{msg.text}</div>}
        <div className="label" style={{ fontSize: 11 }}>
          Credits each targeted card and updates it live in Wallet.{!stamps && " Lift = % who made a real purchase within 14 days."}
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
                {segLabel(c.segment)} · +{nf(c.bonus_points)} {u(c.bonus_points)} · {nf(c.targeted)} targeted
                {c.offer_text ? " · offer" : ""}
              </div>
            </div>
            <div className="label" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              {c.lift && !stamps ? (
                `${c.lift.lift_pct}% came back (${c.lift.earned_after}/${c.lift.targeted})`
              ) : c.status === "draft" ? (
                <button className="btn btn-ghost" disabled={busy} onClick={() => post({ id: c.id })}>
                  Finish sending
                </button>
              ) : (
                c.status
              )}
              <br />
              {c.sent_at ? new Date(c.sent_at).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
