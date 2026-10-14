"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MIN_PASSWORD } from "@/lib/admin/merchant";

type Member = { id: string; username: string; role: string; created_at: string };
type Msg = { kind: "ok" | "bad"; text: string } | null;

// Same rule the creator admin uses for staff passwords.
function pwProblem(pw: string): string | null {
  if (!pw) return "Enter a password.";
  if (pw.length < MIN_PASSWORD) return `Passwords need at least ${MIN_PASSWORD} characters.`;
  return null;
}

export default function StaffManager() {
  const router = useRouter();
  const [list, setList] = useState<Member[]>([]);
  const [selfId, setSelfId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  // inline password reset: one row at a time
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetErr, setResetErr] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/merchant/staff");
    if (res.status === 401) return router.push("/login");
    if (res.status === 403) return router.push("/scan?denied=1");
    const data = await res.json().catch(() => ({}));
    setList(data.staff ?? []);
    setSelfId(data.selfId ?? "");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addCashier(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = !username.trim() ? "Enter a username." : pwProblem(password);
    if (problem) return setMsg({ kind: "bad", text: problem });
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/merchant/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setMsg({ kind: "bad", text: "Couldn't reach the server. Try again." });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ kind: "bad", text: data.error || "Couldn't add the cashier. Try again." });
    setMsg({ kind: "ok", text: `Cashier ${username.trim()} added — they can sign in now.` });
    setUsername("");
    setPassword("");
    load();
  }

  async function remove(id: string) {
    if (!confirm("Remove this cashier?")) return;
    const res = await fetch(`/api/merchant/staff/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ kind: "bad", text: data.error || "Couldn't remove them. Try again." });
    setMsg({ kind: "ok", text: "Removed" });
    load();
  }

  function startReset(id: string) {
    setResetId(id);
    setResetPw("");
    setResetErr(null);
  }

  async function saveReset(e: FormEvent, m: Member) {
    e.preventDefault();
    if (busy) return;
    const problem = pwProblem(resetPw);
    if (problem) return setResetErr(problem);
    setBusy(true);
    const res = await fetch(`/api/merchant/staff/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPw }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setResetErr("Couldn't reach the server. Try again.");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setResetErr(data.error || "Couldn't reset the password. Try again.");
    setResetId(null);
    setResetPw("");
    setMsg({ kind: "ok", text: `New password set for ${m.username}.` });
  }

  return (
    <div className="wrap">
      <form className="card stack" onSubmit={addCashier}>
        <div className="label">Add cashier</div>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          aria-label="Username"
          autoCapitalize="none"
          autoComplete="off"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          aria-label="Password"
          autoComplete="new-password"
        />
        <div className="label" style={{ fontSize: 11 }}>At least {MIN_PASSWORD} characters.</div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : "Add cashier"}
        </button>
        {msg && <div className={`toast ${msg.kind}`}>{msg.text}</div>}
      </form>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Staff</div>
        {list.map((m) => (
          <div key={m.id}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div>
                  {m.username} {m.id === selfId && <small>(you)</small>}
                </div>
                <div className="label">{m.role}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  style={{ width: "auto", padding: "8px 12px", fontSize: 15 }}
                  disabled={resetId === m.id}
                  onClick={() => startReset(m.id)}
                >
                  Reset password
                </button>
                {m.role === "cashier" && m.id !== selfId && (
                  <button
                    className="btn btn-ghost"
                    style={{ width: "auto", padding: "8px 12px", fontSize: 15 }}
                    onClick={() => remove(m.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {resetId === m.id && (
              <form className="confirm" style={{ marginTop: 10 }} onSubmit={(e) => saveReset(e, m)}>
                New password for <b>{m.username}</b>. They&apos;ll use it the next time they sign in.
                <input
                  type="password"
                  value={resetPw}
                  onChange={(e) => {
                    setResetPw(e.target.value);
                    setResetErr(null);
                  }}
                  placeholder={`new password (${MIN_PASSWORD}+ characters)`}
                  aria-label={`New password for ${m.username}`}
                  autoComplete="new-password"
                  autoFocus
                  style={{ marginTop: 10 }}
                />
                {resetErr && <div className="toast bad">{resetErr}</div>}
                <div className="row">
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    {busy ? "…" : "Set new password"}
                  </button>
                  <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setResetId(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
