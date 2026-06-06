"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/merchant/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) router.push("/scan");
    else setErr((await res.json()).error || "Login failed");
  }

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>terminal</small>
      </div>
      <div className="card stack">
        <div>
          <div className="label">Username</div>
          <input value={username} onChange={(e) => setU(e.target.value)} autoCapitalize="none" />
        </div>
        <div>
          <div className="label">Password</div>
          <input type="password" value={password} onChange={(e) => setP(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        {err && <div className="toast bad">{err}</div>}
        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? "…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
