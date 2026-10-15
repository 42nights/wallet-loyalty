"use client";
import { useState, type FormEvent } from "react";
import Icon from "@/components/Icon";
import styles from "./login.module.css";

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
    try {
      const res = await fetch("/api/merchant/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        return setErr(res.status === 401 ? "Wrong username or password" : d.error || "Couldn't sign in — try again.");
      }
      // Owners start on their dashboard, cashiers at the counter. A full page load
      // (not router.push) so the shared staff layout re-renders with the header —
      // the App Router keeps layouts as-is across client-side navigations.
      window.location.assign(d.role === "owner" ? "/dashboard" : "/scan");
    } catch {
      setBusy(false);
      setErr("Couldn't reach the server — check the connection and try again.");
    }
  }

  return (
    <div className={`page page--narrow ${styles.login}`}>
      <div className={styles.loginBox}>
        <div className={styles.wordmark}>42nights</div>
        <h1 className="page-title">Sign in to your shop</h1>
        <p className="page-sub">Use the username and password your shop owner gave you.</p>
        <form className={`panel ${styles.loginForm}`} onSubmit={submit}>
          {/* Real <label>s so screen readers name the fields (F12) */}
          <div className="field">
            <label className="field-label" htmlFor="login-username">Username</label>
            <input id="login-username" value={username} onChange={(e) => setU(e.target.value)}
              autoCapitalize="none" autoComplete="username" spellCheck={false} required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="login-password">Password</label>
            <input id="login-password" type="password" value={password} onChange={(e) => setP(e.target.value)}
              autoComplete="current-password" required />
          </div>
          {err && (
            <div className="toast bad" role="alert">
              <Icon name="alert" />
              {err}
            </div>
          )}
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
