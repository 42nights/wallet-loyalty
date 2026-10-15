"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import s from "./dashboard.module.css";

const EXAMPLES = [
  "How many at-risk customers do I have?",
  "Busiest day and hour?",
  "Points given vs redeemed this month?",
  "Top 5 customers by points?",
];

// "Ask your data" bar fixed to the bottom (above the phone tab bar).
export default function CommandBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ(text);
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/merchant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, deep }),
    }).catch(() => null);
    setBusy(false);
    if (!r) return setErr("Couldn't reach the server — check the connection and try again.");
    if (r.status === 401 || r.status === 403) return router.push("/login");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(d.error || "Couldn't get an answer — try again.");
      setAnswer(null);
      return;
    }
    setAnswer(d.answer || "No answer came back. Try asking another way.");
  }

  const open = focused || busy || answer !== null || err !== null;

  return (
    <div className={s.cmdWrap}>
      <div className={s.cmd} data-open={open}>
        {answer && (
          <div className={s.cmdAns} role="status">
            {answer}
            <button type="button" className={`btn btn-quiet btn-sm ${s.cmdX}`} aria-label="Dismiss answer" onClick={() => { setAnswer(null); setQ(""); }}>
              <Icon name="x" />
            </button>
          </div>
        )}
        {err && <div className="toast bad" role="alert"><Icon name="alert" />{err}</div>}
        <div className={s.cmdBar}>
          <span className={s.cmdIco}><Icon name="info" /></span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            placeholder={busy ? "Thinking…" : "Ask your data anything…"}
            aria-label="Ask a question about your shop"
            onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
            disabled={busy}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !q.trim()} onClick={() => ask()}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </div>
        {open && !answer && !busy && (
          <div className={s.cmdEx}>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => ask(ex)}>
                {ex}
              </button>
            ))}
            <button type="button" className={`chip ${deep ? "chip--accent" : ""}`} aria-pressed={deep}
              onMouseDown={(e) => e.preventDefault()} onClick={() => setDeep((v) => !v)}>
              {deep && <Icon name="check" />}Deep analysis
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
