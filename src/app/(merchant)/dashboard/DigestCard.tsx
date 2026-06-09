"use client";
import { useEffect, useState } from "react";

type Digest = { body: string; model: string | null; created_at: string | null };

export default function DigestCard() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/merchant/digest")
      .then((r) => (r.ok ? r.json() : { digest: null }))
      .then((d) => setDigest(d.digest))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/merchant/digest", { method: "POST" });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(d.error || "Failed");
    setDigest(d.digest);
  }

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-h">
        <span className="panel-t">Weekly digest ✨</span>
        <button
          className="btn btn-ghost"
          style={{ width: "auto", padding: "0 14px" }}
          disabled={busy}
          onClick={generate}
        >
          {busy ? "Generating…" : digest ? "Regenerate" : "Generate"}
        </button>
      </div>
      {digest ? (
        <>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{digest.body}</div>
          {digest.created_at && (
            <div className="label" style={{ fontSize: 11 }}>
              {new Date(digest.created_at).toLocaleString("en-GB")}
              {digest.model ? ` · ${digest.model}` : ""}
            </div>
          )}
        </>
      ) : (
        <div className="label">{loaded ? "No digest yet — generate one." : "Loading…"}</div>
      )}
      {err && <div className="toast bad">{err}</div>}
    </div>
  );
}
