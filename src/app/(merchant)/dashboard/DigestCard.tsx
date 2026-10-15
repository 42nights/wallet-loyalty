"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import s from "./dashboard.module.css";

type Digest = { body: string; model: string | null; created_at: string | null };

export default function DigestCard({ className }: { className: string }) {
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
    const r = await fetch("/api/merchant/digest", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!r) return setErr("Couldn't reach the server — check the connection and try again.");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(d.error || "Couldn't write the digest — try again.");
    setDigest(d.digest);
  }

  return (
    <section className={`panel ${className}`}>
      <div className="panel-h">
        <h2 className="panel-t">Weekly digest</h2>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={generate}>
          {busy ? "Writing…" : digest ? "Write a new one" : "Generate"}
        </button>
      </div>
      {digest ? (
        <>
          <div className={s.digest}>{digest.body}</div>
          {digest.created_at && (
            <div className={s.rowMeta}>
              {new Date(digest.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          )}
        </>
      ) : (
        <p className={s.rowMeta}>{loaded ? "No digest yet. Generate one for a short write-up of your week." : "Loading…"}</p>
      )}
      {err && <div className="toast bad" role="alert"><Icon name="alert" />{err}</div>}
    </section>
  );
}
