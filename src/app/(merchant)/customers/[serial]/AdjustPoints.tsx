"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdjustPoints({ serial }: { serial: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  async function submit(sign: 1 | -1) {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0 || busy) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/merchant/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ serial, delta: sign * n }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) return router.push("/login");
    if (!res.ok) return setMsg({ kind: "bad", text: d.error || "Failed" });
    setMsg({ kind: "ok", text: `Balance now ${d.newBalance}` });
    setAmount("");
    router.refresh();
  }

  return (
    <div className="card stack">
      <div className="label">Manual adjustment (owner)</div>
      <div className="row">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          placeholder="points"
        />
        <button className="btn btn-ghost" style={{ width: "auto", padding: "0 16px" }} disabled={busy} onClick={() => submit(1)}>
          + Add
        </button>
        <button className="btn btn-ghost" style={{ width: "auto", padding: "0 16px" }} disabled={busy} onClick={() => submit(-1)}>
          − Remove
        </button>
      </div>
      {msg && <div className={`toast ${msg.kind}`}>{msg.text}</div>}
    </div>
  );
}
