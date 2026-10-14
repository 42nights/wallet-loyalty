"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./SendCardPanel.module.css";

type CardLink = { url: string; qrSvg: string; expiresAt: number };

// Lost-card re-send: a button that asks the server for a freshly signed card
// link (POST /api/merchant/card-link) and shows it as a QR the customer scans
// with their iPhone camera, plus Share (or copy on desktop). The link is minted
// on demand, so a tab left open never shows an expired one.
export default function SendCardPanel({ serial }: { serial: string }) {
  const router = useRouter();
  const [link, setLink] = useState<CardLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  async function makeLink() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/merchant/card-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial }),
      });
      if (res.status === 401) return router.push("/login");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ kind: "bad", text: d.error || "Could not make a card link" });
      setLink({ url: d.url, qrSvg: d.qrSvg, expiresAt: Date.now() + d.expiresInMinutes * 60_000 });
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!link) return;
    if (navigator.share) {
      // user cancelling the share sheet rejects — that's not an error
      await navigator.share({ title: "Your loyalty card", url: link.url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(link.url).then(
      () => setMsg({ kind: "ok", text: "Link copied — text or AirDrop it to the customer" }),
      () => setMsg({ kind: "bad", text: "Could not copy the link" })
    );
  }

  const toast = msg && (
    <div className={`toast ${msg.kind}`} role="status">
      {msg.text}
    </div>
  );

  if (!link)
    return (
      <div>
        <button className="btn btn-ghost" onClick={makeLink} disabled={busy}>
          {busy ? "Making link…" : "Send card to phone"}
        </button>
        {toast}
      </div>
    );

  const until = new Date(link.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`stack ${styles.panel}`}>
      <div className="label">Send card to phone</div>
      <div
        className={styles.qr}
        role="img"
        aria-label="QR code that opens the customer's card"
        // SVG markup generated server-side by the qrcode package from our own URL
        dangerouslySetInnerHTML={{ __html: link.qrSvg }}
      />
      <div className={styles.hint}>Scan with the iPhone camera</div>
      <button className="btn btn-primary" onClick={share}>
        Share link
      </button>
      {toast}
      <div className="label" style={{ fontSize: 11, marginBottom: 0 }}>
        Opens in Safari and adds the card to Wallet. Expires at {until}.
      </div>
      <div className="row">
        <button className="btn btn-ghost" onClick={makeLink} disabled={busy}>
          New link
        </button>
        <button className="btn btn-ghost" onClick={() => { setLink(null); setMsg(null); }}>
          Close
        </button>
      </div>
    </div>
  );
}
