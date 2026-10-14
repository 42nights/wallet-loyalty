"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { VOID_REASONS, type VoidReason } from "@/lib/config";

const REASONS = Object.entries(VOID_REASONS) as [VoidReason, string][];

// Deactivate / reactivate this card (POST / DELETE /api/merchant/void).
// Deactivating takes a second step that names a reason, like removing points.
// `voided` comes from the server page, which refreshes after each change.
export default function CardStatus({
  serial,
  voided,
}: {
  serial: string;
  voided: { at: string; reason: string | null } | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/merchant/void", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial, reason }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Couldn't reach the server — nothing was changed. Try again.");
    if (res.status === 401) return router.push("/login");
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error || "Couldn't change the card. Try again.");
    // the refreshed page swaps this panel for the other state
    router.refresh();
  }

  if (voided) {
    const when = new Date(voided.at).toLocaleDateString(undefined, { dateStyle: "medium" });
    const why = VOID_REASONS[voided.reason as VoidReason] ?? "no reason given";
    return (
      <div className="card stack" style={{ borderColor: "var(--bad)" }}>
        <div>
          <div className="label" style={{ color: "var(--bad)" }}>Card deactivated</div>
          <div style={{ lineHeight: 1.5 }}>
            Since {when} · {why}. No points can be added or used and the card can&apos;t be re-sent. Its points and
            history are kept.
          </div>
        </div>
        <button className="btn btn-ghost" disabled={busy} onClick={() => send("DELETE")}>
          {busy ? "…" : "Reactivate card"}
        </button>
        {error && <div className="toast bad" role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <div className="card stack">
      <div>
        <div className="label">Deactivate card</div>
        <div className="label" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "none", marginBottom: 0 }}>
          Stops earning and rewards on this card and shows it as deactivated in the customer&apos;s Wallet. Points
          and history are kept, and you can reactivate it.
        </div>
      </div>
      {!confirming ? (
        <button className="btn btn-ghost" disabled={busy} onClick={() => { setConfirming(true); setError(null); }}>
          Deactivate card
        </button>
      ) : (
        <div className="confirm">
          Why are you deactivating this card?
          <div className="grid2" role="radiogroup" aria-label="Reason" style={{ marginTop: 10 }}>
            {REASONS.map(([key, text]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={reason === key}
                className="btn btn-ghost"
                style={{
                  padding: 12,
                  fontSize: 15,
                  ...(reason === key && {
                    borderColor: "var(--accent)",
                    background: "color-mix(in srgb, var(--accent) 14%, var(--surface-2))",
                  }),
                }}
                onClick={() => setReason(key)}
              >
                {text}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !reason} onClick={() => send("POST")}>
              {busy ? "…" : "Yes, deactivate"}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => { setConfirming(false); setReason(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="toast bad" role="alert">{error}</div>}
    </div>
  );
}
