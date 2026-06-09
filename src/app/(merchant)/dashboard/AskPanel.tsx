"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const EXAMPLES = [
  "How many at-risk customers do I have?",
  "What's my busiest day and hour?",
  "Points issued vs redeemed this month?",
  "Who are my top 5 customers by points?",
];

export default function AskPanel() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ(text);
    setBusy(true);
    setErr(null);
    setAnswer(null);
    const r = await fetch("/api/merchant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, deep }),
    });
    setBusy(false);
    if (r.status === 401 || r.status === 403) return router.push("/login");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(d.error || "Failed");
    setAnswer(d.answer || "(no answer)");
  }

  return (
    <div className="card stack">
      <div className="label">Ask your data ✨</div>
      <textarea
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask anything about your customers…"
        rows={2}
        style={{ width: "100%", resize: "vertical" }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
        }}
      />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <label className="label" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
          Deep analysis (slower)
        </label>
        <button
          className="btn btn-ghost"
          style={{ width: "auto", padding: "0 18px" }}
          disabled={busy || !q.trim()}
          onClick={() => ask()}
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="label"
            disabled={busy}
            onClick={() => ask(ex)}
            style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "3px 8px", cursor: "pointer" }}
          >
            {ex}
          </button>
        ))}
      </div>
      {answer && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{answer}</div>}
      {err && <div className="toast bad">{err}</div>}
      <div className="label" style={{ fontSize: 11 }}>
        Answers come from your loyalty data only. The AI cannot see other shops or raw records.
      </div>
    </div>
  );
}
