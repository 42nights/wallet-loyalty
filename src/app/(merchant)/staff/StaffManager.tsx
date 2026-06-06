"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Member = { id: string; username: string; role: string; created_at: string };

export default function StaffManager() {
  const router = useRouter();
  const [list, setList] = useState<Member[]>([]);
  const [selfId, setSelfId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/merchant/staff");
    if (res.status === 401) return router.push("/login");
    if (res.status === 403) return router.push("/scan");
    const data = await res.json();
    setList(data.staff ?? []);
    setSelfId(data.selfId ?? "");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addCashier() {
    if (!username || !password || busy) return;
    setBusy(true);
    const res = await fetch("/api/merchant/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ kind: "bad", text: data.error || "Failed" });
    setUsername("");
    setPassword("");
    setMsg({ kind: "ok", text: "Cashier added" });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Remove this cashier?")) return;
    const res = await fetch(`/api/merchant/staff/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ kind: "bad", text: data.error || "Failed" });
    setMsg({ kind: "ok", text: "Removed" });
    load();
  }

  async function resetPw(id: string) {
    const pw = prompt("New password for this user?");
    if (!pw) return;
    const res = await fetch(`/api/merchant/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ kind: "bad", text: data.error || "Failed" });
    setMsg({ kind: "ok", text: "Password reset" });
  }

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>staff</small>
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        <Link className="btn btn-ghost" href="/scan">Scan</Link>
        <Link className="btn btn-ghost" href="/dashboard">Dashboard</Link>
      </div>

      <div className="card stack">
        <div className="label">Add cashier</div>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          autoCapitalize="none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
        />
        <button className="btn btn-primary" disabled={busy} onClick={addCashier}>
          {busy ? "…" : "Add cashier"}
        </button>
        {msg && <div className={`toast ${msg.kind}`}>{msg.text}</div>}
      </div>

      <div className="card stack" style={{ marginTop: 12 }}>
        <div className="label">Staff</div>
        {list.map((m) => (
          <div
            key={m.id}
            className="row"
            style={{ justifyContent: "space-between", alignItems: "center" }}
          >
            <div>
              <div>
                {m.username} {m.id === selfId && <small>(you)</small>}
              </div>
              <div className="label">{m.role}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-ghost"
                style={{ width: "auto", padding: "0 12px" }}
                onClick={() => resetPw(m.id)}
              >
                Reset pw
              </button>
              {m.role === "cashier" && m.id !== selfId && (
                <button
                  className="btn btn-ghost"
                  style={{ width: "auto", padding: "0 12px" }}
                  onClick={() => remove(m.id)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
