"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { unitLabel, type LoyaltyMode } from "@/lib/config";

const MAX = 1_000_000; // the adjust route's own cap
const nf = (n: number) => n.toLocaleString();

// `balance` comes from the server page and refreshes after each adjustment,
// so the confirm step always shows the real resulting balance. `mode` only
// picks the word: a stamp card adjusts stamps, through the same route.
export default function AdjustPoints({ serial, balance, mode }: { serial: string; balance: number; mode: LoyaltyMode }) {
  const u = unitLabel(mode, 2);
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  // Whole numbers only: "50" — not "-5", "1.5", "abc" or an empty box.
  const n = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : NaN;

  function valid(): boolean {
    if (!(n > 0)) setMsg({ kind: "bad", text: `Enter a whole number of ${u} above 0, like ${mode === "stamps" ? 2 : 50}.` });
    else if (n > MAX) setMsg({ kind: "bad", text: `You can adjust up to ${nf(MAX)} ${u} at a time.` });
    else return true;
    return false;
  }

  async function send(delta: number) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/merchant/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ serial, delta }),
    }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res) return setMsg({ kind: "bad", text: "Couldn't reach the server — nothing was changed. Try again." });
    if (res.status === 401) return router.push("/login");
    const d = await res.json().catch(() => ({}));
    if (res.status === 422)
      return setMsg({ kind: "bad", text: `That would take the balance below zero (it's ${nf(d.balance ?? balance)}).` });
    if (!res.ok) return setMsg({ kind: "bad", text: d.error || "Couldn't adjust the balance. Try again." });
    setMsg({ kind: "ok", text: `Done — balance is now ${nf(d.newBalance)} ${u}.` });
    setAmount("");
    router.refresh();
  }

  function add() {
    if (valid()) send(n);
  }

  // Removing points can't be undone from here, so it takes a second tap that
  // spells out the result first.
  function askRemove() {
    if (!valid()) return;
    if (n > balance)
      return setMsg({ kind: "bad", text: `They only have ${nf(balance)} ${u} — you can remove up to ${nf(balance)}.` });
    setMsg(null);
    setConfirming(true);
  }

  return (
    <div className="card stack">
      <div className="label">Manual adjustment</div>
      <input
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          setConfirming(false);
          setMsg(null);
        }}
        inputMode="numeric"
        placeholder={u}
        aria-label={`${u[0].toUpperCase()}${u.slice(1)} to add or remove`}
        aria-invalid={msg?.kind === "bad" || undefined}
      />
      <div className="grid2">
        <button className="btn btn-ghost" disabled={busy || confirming} onClick={add}>
          + Add
        </button>
        <button className="btn btn-ghost" disabled={busy || confirming} onClick={askRemove}>
          − Remove
        </button>
      </div>
      {confirming && (
        <div className="confirm">
          Remove <b>{nf(n)}</b> {u}? Their balance goes from {nf(balance)} to <b>{nf(balance - n)}</b>.
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => send(-n)}>
              {busy ? "…" : `Yes, remove ${nf(n)}`}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <div className={`toast ${msg.kind}`}>{msg.text}</div>}
    </div>
  );
}
