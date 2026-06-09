"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const EXAMPLES = [
  "How many at-risk customers do I have?",
  "Busiest day and hour?",
  "Points issued vs redeemed this month?",
  "Top 5 customers by points?",
];

export default function CommandBar() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
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
    });
    setBusy(false);
    if (r.status === 401 || r.status === 403) return router.push("/login");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(d.error || "Failed");
      setAnswer(null);
      return;
    }
    setErr(null);
    setAnswer(d.answer || "(no answer)");
  }

  const open = focused || busy || answer !== null || err !== null;

  return (
    <div className="cmd-wrap">
      <div className="cmd" data-open={open}>
        {answer && (
          <div className="cmd-ans">
            {answer}
            <button className="cmd-x" aria-label="dismiss" onClick={() => { setAnswer(null); setQ(""); }}>
              ✕
            </button>
          </div>
        )}
        {err && <div className="cmd-ans" style={{ color: "var(--bad)" }}>{err}</div>}
        <div className="cmd-bar">
          <span className="cmd-ico">✦</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            placeholder={busy ? "Thinking…" : "Ask your data anything…"}
            onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
            disabled={busy}
          />
          <button
            className="btn btn-primary cmd-send"
            disabled={busy || !q.trim()}
            onClick={() => ask()}
          >
            {busy ? "…" : "Ask"}
          </button>
        </div>
        {open && !answer && !busy && (
          <div className="cmd-ex">
            {EXAMPLES.map((ex) => (
              <button key={ex} onMouseDown={(e) => e.preventDefault()} onClick={() => ask(ex)}>
                {ex}
              </button>
            ))}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setDeep((v) => !v)}
              style={deep ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
            >
              {deep ? "✓ deep" : "deep analysis"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
