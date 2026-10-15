"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
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
  // Opening swaps the button for the panel and Close swaps it back, so focus
  // follows: to the panel's heading, then back to the button.
  const focusTo = useRef<"head" | "button" | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusTo.current) (focusTo.current === "head" ? head : button).current?.focus();
    focusTo.current = null;
  }, [link]);

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
      if (!res.ok) return setMsg({ kind: "bad", text: d.error || "Couldn't make a card link — try again." });
      if (!link) focusTo.current = "head";
      setLink({ url: d.url, qrSvg: d.qrSvg, expiresAt: Date.now() + d.expiresInMinutes * 60_000 });
    } catch {
      setMsg({ kind: "bad", text: "Couldn't reach the server — try again." });
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
      () => setMsg({ kind: "ok", text: "Link copied — text or AirDrop it to the customer." }),
      () => setMsg({ kind: "bad", text: "Couldn't copy the link — let the customer scan the code instead." })
    );
  }

  function close() {
    focusTo.current = "button";
    setLink(null);
    setMsg(null);
  }

  const toast = msg && (
    <div className={`toast ${msg.kind}`} role={msg.kind === "ok" ? "status" : "alert"}>
      <Icon name={msg.kind === "ok" ? "check" : "alert"} />
      {msg.text}
    </div>
  );

  if (!link)
    return (
      <div className={styles.closed}>
        <button ref={button} type="button" className="btn btn-ghost btn-block" onClick={makeLink} disabled={busy}>
          <Icon name="phone" />
          {busy ? "Making link…" : "Send card to phone"}
        </button>
        {toast}
      </div>
    );

  const until = new Date(link.expiresAt)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  return (
    <div className={styles.panel}>
      <h3 ref={head} tabIndex={-1} className={styles.title}>
        Send card to phone
      </h3>
      <div
        className={styles.qr}
        role="img"
        aria-label="QR code that opens the customer's card"
        // SVG markup generated server-side by the qrcode package from our own URL
        dangerouslySetInnerHTML={{ __html: link.qrSvg }}
      />
      <p className={styles.hint}>Scan with the iPhone camera</p>
      <button type="button" className="btn btn-primary btn-block" onClick={share}>
        Share link
      </button>
      {toast}
      <p className={styles.help}>Opens in Safari and adds the card to Wallet. Link expires at {until}.</p>
      <div className={styles.actions}>
        <button type="button" className="btn btn-quiet btn-sm" onClick={makeLink} disabled={busy}>
          {busy ? "Making link…" : "New link"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}
