"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { VOID_REASONS, type VoidReason } from "@/lib/config";
import d from "./detail.module.css";

const REASONS = Object.entries(VOID_REASONS) as [VoidReason, string][];
// The refresh after a change mounts a new panel in another spot (the old one,
// and the focused button, are gone); the card it names takes focus on mount.
let refocus: string | null = null;

// Deactivate / reactivate this card (POST / DELETE /api/merchant/void).
// Deactivating takes a second step that names a reason, like removing points.
// `voided` comes from the server page (its date already on the shop's clock),
// which refreshes after each change. `unit`: "points" or "stamps".
export default function CardStatus({
  serial,
  voided,
  unit,
}: {
  serial: string;
  voided: { since: string; reason: string | null } | null;
  unit: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (refocus !== serial) return;
    refocus = null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    trigger.current?.focus({ preventScroll: true });
  }, [serial]);

  useEffect(() => {
    const el = box.current;
    if (!confirming || !el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    el.querySelector("button")?.focus({ preventScroll: true });
  }, [confirming]);

  async function send(method: "POST" | "DELETE") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/merchant/void", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial, reason }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Couldn't reach the server — nothing was changed. Try again.");
    if (res.status === 401) return router.push("/login");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Couldn't change the card. Try again.");
    refocus = serial;
    router.refresh();
  }

  function cancel() {
    setConfirming(false);
    setReason(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  const toast = error && (
    <div className="toast bad" role="alert">
      <Icon name="alert" />
      {error}
    </div>
  );

  if (voided) {
    const why = VOID_REASONS[voided.reason as VoidReason] ?? "no reason given";
    return (
      <section ref={panel} className={`panel ${d.danger}`}>
        <h2 className="panel-t">Card deactivated</h2>
        <p className={d.body}>
          Since {voided.since} · {why}. No {unit} can be added or used and the card can&apos;t be re-sent. Its {unit} and
          history are kept.
        </p>
        <button ref={trigger} className={`btn btn-ghost ${d.start}`} disabled={busy} onClick={() => send("DELETE")}>
          {busy ? "Reactivating…" : "Reactivate card"}
        </button>
        {toast}
      </section>
    );
  }

  return (
    <section ref={panel} className={`panel ${d.danger}`}>
      <h2 className="panel-t">Danger zone</h2>
      <p className={d.body}>
        Deactivating stops earning and rewards on this card and shows it as deactivated in the customer&apos;s Wallet.
        Its {unit} and history are kept, and you can reactivate it.
      </p>
      <p className="help">
        <b>Lost phone?</b> Use Send card to phone instead — it is the same card.
      </p>
      {!confirming ? (
        <button
          ref={trigger}
          className={`btn btn-danger ${d.start}`}
          disabled={busy}
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
        >
          Deactivate card
        </button>
      ) : (
        <div ref={box} className="confirm confirm--danger">
          Why are you deactivating this card?
          <div className={d.reasons} role="group" aria-label="Reason">
            {REASONS.map(([key, text]) => (
              <button
                key={key}
                type="button"
                aria-pressed={reason === key}
                className={`btn btn-ghost ${d.reason}`}
                onClick={() => setReason(key)}
              >
                {text}
                {reason === key && <Icon name="check" />}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn btn-danger-solid" disabled={busy || !reason} onClick={() => send("POST")}>
              {busy ? "Deactivating…" : "Yes, deactivate"}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {toast}
    </section>
  );
}
