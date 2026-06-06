"use client";
import { useState } from "react";

export default function EnrollForm({
  slug,
  merchantName,
}: {
  slug: string;
  merchantName: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    const res = await fetch("/api/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, slug }),
    });
    setBusy(false);
    if (!res.ok) return alert("Something went wrong");
    // download / open the .pkpass → Safari on iOS shows "Add to Wallet"
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.location.href = url;
  }

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> {merchantName} <small>join</small>
      </div>
      <div className="card stack">
        <div className="label">Get your loyalty card in Apple Wallet</div>
        <div>
          <div className="label">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <div className="label">Phone</div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
          />
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={join}>
          {busy ? "…" : "Add to Apple Wallet"}
        </button>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Open this page in Safari on iPhone for the “Add to Wallet” prompt.
        </div>
      </div>
    </div>
  );
}
