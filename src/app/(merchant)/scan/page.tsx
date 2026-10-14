"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Action } from "@/lib/config";
import SendCardPanel from "@/components/SendCardPanel";
import { formatMoney } from "@/lib/format";
import { parseBill } from "./bill";
import styles from "./scan.module.css";

type Customer = { serial: string; name: string | null; points: number; voided?: boolean };
type PhoneMatch = Customer & { phone: string }; // phone is masked: "••• 1234"
// undoKey: the Idempotency-Key of the tap this success toast reports, while its
// Undo button is still offered
type Toast = { kind: "ok" | "bad"; msg: string; undoKey?: string };

const UNDO_MS = 10_000; // how long a success toast offers Undo

export default function ScanPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [flash, setFlash] = useState(false);
  const [manual, setManual] = useState("");
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<PhoneMatch[] | null>(null);
  const [bill, setBill] = useState("");
  const [billErr, setBillErr] = useState(false);
  // a big bill the server wants confirmed (409), with the points it will credit
  const [pending, setPending] = useState<{ amount: number; points: number } | null>(null);
  const [addLocked, setAddLocked] = useState(false);
  const [earnRate, setEarnRate] = useState(1);
  const [maxBill, setMaxBill] = useState<number | null>(null); // null until /me answers
  const [redemptions, setRedemptions] = useState<Action[]>([]);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const scannerRef = useRef<any>(null);
  const scanningRef = useRef(false);

  // load this merchant's earn rate (bill → points preview) and redeem buttons.
  // Re-run on "Scan next customer" too: the counter tablet keeps /scan open all
  // day, and an owner changing the template in Settings would otherwise leave
  // it showing buttons the server now rejects.
  async function loadMe() {
    const res = await fetch("/api/merchant/me");
    if (res.status === 401) return router.push("/login");
    if (res.ok) {
      const me = await res.json();
      if (typeof me.earnRate === "number") setEarnRate(me.earnRate);
      if (typeof me.maxBill === "number") setMaxBill(me.maxBill);
      if (Array.isArray(me.redemptions)) setRedemptions(me.redemptions);
    }
  }
  useEffect(() => {
    loadMe();
    // owner-only pages send a cashier here with ?denied=1 instead of a silent bounce
    if (new URLSearchParams(window.location.search).get("denied") === "1")
      setToast({ kind: "bad", msg: "That page is for owners" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Undo is offered for UNDO_MS, then the toast stays without its button. Any
  // newer toast (or none) cancels the timer along with the old toast.
  useEffect(() => {
    if (!toast?.undoKey) return;
    const t = setTimeout(() => setToast((cur) => cur && { kind: cur.kind, msg: cur.msg }), UNDO_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // start camera scanner when no customer is loaded
  useEffect(() => {
    if (customer) return;
    let cancelled = false;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled) return;
      const el = document.getElementById("reader");
      if (!el) return;
      setCameraError(false);
      try {
        const scanner = new Html5Qrcode("reader");
        scannerRef.current = scanner;
        scanningRef.current = true;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 240 },
          (decoded: string) => lookup(decoded),
          () => {}
        );
      } catch {
        // no camera, permission denied, or not https: say so, so the cashier
        // uses the serial / phone lookup below instead of waiting on a blank box
        scanningRef.current = false;
        if (!cancelled) setCameraError(true);
      }
    })();
    return () => {
      cancelled = true;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  async function stopScanner() {
    if (scannerRef.current && scanningRef.current) {
      scanningRef.current = false;
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
  }

  async function lookup(serial: string) {
    setToast(null);
    await stopScanner();
    const res = await fetch("/api/merchant/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial }),
    });
    if (res.status === 401) return router.push("/login");
    if (!res.ok) {
      setToast({ kind: "bad", msg: "Card not found" });
      setCustomer(null);
      return;
    }
    setCustomer(await res.json());
    setToast(null);
  }

  function findBySerial(e: FormEvent) {
    e.preventDefault();
    if (manual.trim()) lookup(manual.trim());
  }

  // Customer forgot their phone / Wallet card: find them by phone number.
  // One match loads the customer; several show a short pick list.
  async function findByPhone(e: FormEvent) {
    e.preventDefault();
    if (!phone.trim() || busy) return;
    setBusy(true);
    setToast(null);
    setMatches(null);
    try {
      const res = await fetch("/api/merchant/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (res.status === 401) return router.push("/login");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setToast({ kind: "bad", msg: data.error || "Lookup failed" });
      const found: PhoneMatch[] = data.matches ?? [];
      if (found.length === 0)
        return setToast({ kind: "bad", msg: "No card with that phone number here" });
      setToast(null);
      if (found.length === 1) return pick(found[0]);
      setMatches(found);
    } finally {
      setBusy(false);
    }
  }

  function pick(m: PhoneMatch) {
    setCustomer({ serial: m.serial, name: m.name, points: m.points, voided: m.voided }); // effect cleanup stops the camera
    setMatches(null);
    setPhone("");
  }

  async function apply(body: { actionId: string } | { amount: number; confirm?: true }, okMsg: string) {
    if (!customer || busy) return; // busy guard: no double-tap
    setBusy(true);
    setToast(null); // an old toast must never read as this tap's result
    setPending(null);
    // one key per tap → a retry of THIS request can't double-apply, and Undo
    // names the tap by it
    const key = crypto.randomUUID();
    try {
      const res = await fetch("/api/merchant/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ serial: customer.serial, ...body }),
      });
      if (res.status === 401) return router.push("/login");
      const data = await res.json();
      // a big bill: the server wrote nothing and wants a confirm first
      if (res.status === 409 && data.confirm && "amount" in body) {
        setPending({ amount: body.amount, points: data.confirm.points });
        return;
      }
      if (!res.ok) {
        // "Not enough points" carries the real balance: show it, so the reward
        // buttons re-dim if another terminal spent points in the meantime
        if (typeof data.balance === "number") setCustomer({ ...customer, points: data.balance });
        setToast({ kind: "bad", msg: data.error || "Failed" });
        return;
      }
      setCustomer({ ...customer, points: data.newBalance });
      setFlash(true);
      setTimeout(() => setFlash(false), 400);
      setToast({ kind: "ok", msg: okMsg, undoKey: key });
      if ("amount" in body) {
        // a bill left in the box invites a second tap, i.e. a double credit
        setBill("");
        setAddLocked(true);
        setTimeout(() => setAddLocked(false), 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  // Reverse the tap a success toast reports (server: /api/merchant/undo).
  async function undo(t: Toast) {
    if (!customer || busy || !t.undoKey) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/merchant/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: t.undoKey }),
      });
      if (res.status === 401) return router.push("/login");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // "already used" carries the real balance, like "Not enough points"
        if (typeof data.balance === "number") setCustomer({ ...customer, points: data.balance });
        setToast({ kind: "bad", msg: data.error || "Could not undo" });
        return;
      }
      setCustomer({ ...customer, points: data.newBalance });
      setToast({ kind: "ok", msg: `Undone: ${t.msg}` });
    } finally {
      setBusy(false);
    }
  }

  function earn() {
    setToast(null);
    const amt = parseBill(bill);
    if (amt === null) return setBillErr(true);
    apply({ amount: amt }, `+${Math.round(earnRate * amt)} pts`);
  }

  function reset() {
    loadMe();
    setCustomer(null);
    setToast(null);
    setBill("");
    setBillErr(false);
    setPending(null);
    setPhone("");
    setMatches(null);
  }

  // ---- scan view ----
  if (!customer) {
    return (
      <div className="wrap">
        <div className="card stack">
          <div className="label">Scan the customer's Wallet QR</div>
          <div id="reader" />
          {cameraError && (
            <div className={styles.camera} role="status">
              Camera unavailable — allow camera access, or find the customer below
            </div>
          )}
          {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
          <div className="label" style={{ marginTop: 8 }}>or enter serial manually</div>
          <form className="row" onSubmit={findBySerial}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="serial…" enterKeyHint="go" />
            <button className="btn btn-ghost" style={{ width: "auto", padding: "0 18px" }} type="submit">Go</button>
          </form>
          <div className="label" style={{ marginTop: 8 }}>or find by phone</div>
          <form className="row" onSubmit={findByPhone}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              type="tel" inputMode="tel" autoComplete="off" placeholder="customer's phone number" />
            <button className="btn btn-ghost" style={{ width: "auto", padding: "0 18px" }}
              type="submit" disabled={busy}>Find</button>
          </form>
          {matches && (
            <div className={styles.picks}>
              <div className="label">{matches.length} cards match — pick one</div>
              {matches.map((m) => (
                <button key={m.serial} className={styles.pick} onClick={() => pick(m)}>
                  <span className={styles.pickName}>{m.name || "Customer"}</span>
                  <span className={styles.pickMeta}>{m.phone} · {m.voided ? "deactivated" : `${m.points} pts`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- deactivated card: nothing to earn, redeem or re-send ----
  if (customer.voided) {
    return (
      <div className="wrap">
        <div className="card stack">
          <div>
            <div className="label">{customer.name || "Customer"}</div>
            <div className={styles.voided} role="status">
              <b>This card is deactivated.</b> No points can be added or used. The owner can reactivate it on the
              customer&apos;s page.
            </div>
          </div>
          <button className="btn btn-primary" onClick={reset}>Scan next customer</button>
        </div>
      </div>
    );
  }

  // ---- customer / actions view ----
  const billAmt = parseBill(bill);
  // over the shop's cap: the server would refuse it, so say so now instead of
  // previewing points it won't credit
  const overCap = billAmt !== null && maxBill !== null && billAmt > maxBill;
  return (
    <div className="wrap">
      <div className="card stack">
        <div>
          <div className="label">{customer.name || "Customer"}</div>
          <div className={`balance ${flash ? "flash" : ""}`}>{customer.points}</div>
          <div className="label" style={{ marginTop: 4 }}>points</div>
        </div>

        {toast && (
          <div className={`toast ${toast.kind} ${styles.toast}`}>
            <span>{toast.msg}</span>
            {toast.undoKey && (
              <button className={styles.undo} disabled={busy} onClick={() => undo(toast)}>Undo</button>
            )}
          </div>
        )}

        <div className="label" style={{ marginTop: 6 }}>Redeem</div>
        <div className="grid2">
          {redemptions.map((a) => {
            const short = customer.points < -a.points; // a.points is the (negative) delta
            return (
              <button key={a.id} className={`redeem-btn ${short ? styles.short : ""}`} disabled={busy || short}
                onClick={() => apply({ actionId: a.id }, `${a.label} redeemed`)}>
                <div className="rl">{a.label}</div>
                <div className="rp">{a.points} pts</div>
                {short && <div className={styles.need}>needs {-a.points} · has {customer.points}</div>}
              </button>
            );
          })}
        </div>

        <div className="label" style={{ marginTop: 6 }}>Earn — enter the bill amount</div>
        <div className="row">
          <input value={bill} onChange={(e) => { setBill(e.target.value); setBillErr(false); setPending(null); }}
            inputMode="decimal" placeholder="bill amount" aria-invalid={billErr} />
          <button className="btn btn-ghost" style={{ width: "auto", padding: "0 16px" }} disabled={busy || addLocked}
            onClick={earn}>
            Add
          </button>
        </div>
        {billErr && <div className={styles.billErr} role="alert">Enter an amount like 12.50</div>}
        {overCap && (
          <div className={styles.billErr} role="alert">
            Over this shop&apos;s limit of {formatMoney(maxBill)} — check the amount, or ask the owner to raise the limit in Settings
          </div>
        )}
        {billAmt !== null && !overCap && (
          <div className="label">
            = {Math.round(earnRate * billAmt)} pts ({earnRate}× rate)
          </div>
        )}
        {pending && (
          <div className={styles.confirm} role="alert">
            <div>
              Big bill: <b>{formatMoney(pending.amount)}</b> will credit <b>+{pending.points} pts</b>. Is that right?
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={busy}
                onClick={() => apply({ amount: pending.amount, confirm: true }, `+${pending.points} pts`)}>
                Add +{pending.points} pts
              </button>
              <button className="btn btn-ghost" style={{ width: "auto", padding: "0 18px" }}
                onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <SendCardPanel key={customer.serial} serial={customer.serial} />

        <button className="btn btn-primary" onClick={reset}>Scan next customer</button>
      </div>
    </div>
  );
}
