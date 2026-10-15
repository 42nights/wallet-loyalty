"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { unitLabel, type LoyaltyMode } from "@/lib/config";
import d from "./detail.module.css";

const MAX = 1_000_000; // the adjust route's own cap
const nf = (n: number) => n.toLocaleString("en-US");

// `balance` comes from the server page and refreshes after each adjustment,
// so the confirm step always shows the real resulting balance. `mode` only
// picks the word: a stamp card adjusts stamps, through the same route.
export default function AdjustPoints({ serial, balance, mode }: { serial: string; balance: number; mode: LoyaltyMode }) {
  const u = unitLabel(mode, 2);
  const units = (k: number) => (k === 1 ? u.slice(0, -1) : u);
  const id = useId();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"add" | "remove" | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string; at: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const removeBtn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!confirming || !el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    el.querySelector("button")?.focus({ preventScroll: true });
  }, [confirming]);

  // The ok toast fades at 2.5s (globals.css); then drop it so it stops taking room.
  useEffect(() => {
    if (msg?.kind !== "ok") return;
    const t = setTimeout(() => setMsg(null), 2800);
    return () => clearTimeout(t);
  }, [msg]);

  // Whole numbers only: "50" — not "-5", "1.5", "abc" or an empty box.
  const n = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : NaN;

  function valid(): boolean {
    if (!(n > 0)) setInvalid(`Enter a whole number of ${u} above 0, like ${mode === "stamps" ? 2 : 50}.`);
    else if (n > MAX) setInvalid(`You can adjust up to ${nf(MAX)} ${u} at a time.`);
    else return true;
    return false;
  }

  async function send(delta: number) {
    if (busy) return;
    setBusy(delta > 0 ? "add" : "remove");
    setMsg(null);
    const res = await fetch("/api/merchant/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ serial, delta }),
    }).catch(() => null);
    setBusy(null);
    if (delta < 0) {
      setConfirming(false);
      requestAnimationFrame(() => input.current?.focus());
    }
    const bad = (text: string) => setMsg({ kind: "bad", text, at: Date.now() });
    if (!res) return bad("Couldn't reach the server — nothing was changed. Try again.");
    if (res.status === 401) return router.push("/login");
    const data = await res.json().catch(() => ({}));
    if (res.status === 422) return bad(`That would take the balance below zero (it's ${nf(data.balance ?? balance)}).`);
    if (!res.ok) return bad(data.error || "Couldn't adjust the balance. Try again.");
    setMsg({ kind: "ok", text: `Done — balance is now ${nf(data.newBalance)} ${units(data.newBalance)}.`, at: Date.now() });
    setAmount("");
    router.refresh();
  }

  // Removing points can't be undone from here, so it takes a second tap that
  // spells out the result first.
  function askRemove() {
    if (!valid()) return;
    if (n > balance) return setInvalid(`They only have ${nf(balance)} ${units(balance)} — you can remove up to ${nf(balance)}.`);
    setMsg(null);
    setConfirming(true);
  }

  function cancel() {
    setConfirming(false);
    requestAnimationFrame(() => removeBtn.current?.focus());
  }

  return (
    <>
      <form
        className={d.adjust}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (valid()) send(n);
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor={id}>{u[0].toUpperCase() + u.slice(1)} to add or remove</label>
          <input
            ref={input}
            id={id}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirming(false);
              setInvalid(null);
              setMsg(null);
            }}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            placeholder={`e.g. ${mode === "stamps" ? 2 : 50}`}
            aria-invalid={!!invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
          />
          {invalid && (
            <p className="field-error" id={`${id}-error`}>
              <Icon name="alert" />
              {invalid}
            </p>
          )}
        </div>
        <div className={d.pair}>
          <button type="submit" className="btn btn-ghost" disabled={!!busy || confirming}>
            {busy === "add" ? "Adding…" : "+ Add"}
          </button>
          <button ref={removeBtn} type="button" className="btn btn-ghost" disabled={!!busy || confirming} onClick={askRemove}>
            − Remove
          </button>
        </div>
      </form>
      {confirming && (
        <div ref={box} className="confirm confirm--danger">
          Remove <b>{nf(n)}</b> {units(n)}? Their balance goes from {nf(balance)} to <b>{nf(balance - n)}</b>.
          <div className="row">
            <button className="btn btn-danger-solid" disabled={!!busy} onClick={() => send(-n)}>
              {busy === "remove" ? "Removing…" : `Yes, remove ${nf(n)}`}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className={`save-status ${d.status}`} role="status">
        {msg?.kind === "ok" && (
          <div key={msg.at} className="toast ok">
            <Icon name="check" />
            {msg.text}
          </div>
        )}
      </div>
      {msg?.kind === "bad" && (
        <div key={msg.at} className="toast bad" role="alert">
          <Icon name="alert" />
          {msg.text}
        </div>
      )}
    </>
  );
}
