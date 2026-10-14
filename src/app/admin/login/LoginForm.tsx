"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace("/admin");
      router.refresh();
      return;
    }
    setBusy(false);
    setErr((await res.json().catch(() => ({}))).error || "Login failed");
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div>
        <label className="label" htmlFor="admin-pw" style={{ display: "block" }}>Admin password</label>
        <input
          id="admin-pw"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {err && <div className="toast bad" role="alert">{err}</div>}
      <button className="btn btn-primary" type="submit" disabled={busy || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
