"use client";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/merchant/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setErr(d.error || "Login failed");
    }
    // Owners start on their dashboard, cashiers at the counter. A full page load
    // (not router.push) so the shared staff layout re-renders with the header —
    // the App Router keeps layouts as-is across client-side navigations.
    window.location.assign(d.role === "owner" ? "/dashboard" : "/scan");
  }

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>terminal</small>
      </div>
      <form className="card stack" onSubmit={submit}>
        <div>
          <div className="label">Username</div>
          <input value={username} onChange={(e) => setU(e.target.value)} autoCapitalize="none" autoComplete="username" />
        </div>
        <div>
          <div className="label">Password</div>
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        </div>
        {err && <div className="toast bad">{err}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
