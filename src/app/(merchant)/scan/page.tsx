"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { STAMP_EARN_MAX, unitLabel, type Action, type LoyaltyMode } from "@/lib/config";
import SendCardPanel from "@/components/SendCardPanel";
import { formatMoney } from "@/lib/format";
import { parseBill } from "./bill";
import styles from "./scan.module.css";

type Customer = { serial: string; name: string | null; points: number; voided?: boolean };
type PhoneMatch = Customer & { phone: string }; // phone is masked: "••• 1234"
// undoKey: the Idempotency-Key of the tap this success toast reports, while its
// Undo button is still offered
type Toast = { kind: "ok" | "bad"; msg: string; undoKey?: string };
// GET /api/merchant/today: this staff member's own taps since local midnight
type Today = { customers: number; points: number; rewards: number; undos: number };

const UNDO_MS = 10_000; // how long a success toast offers Undo
const nf = (n?: number) => (n === undefined ? "–" : n.toLocaleString("en-US")); // "–" until loaded

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
  // happy-hour multiplier in force (null = none): from /me, then refreshed by
  // every redeem answer, so the banner follows the window without polling
  const [happyHour, setHappyHour] = useState<number | null>(null);
  const [redemptions, setRedemptions] = useState<Action[]>([]);
  // a stamp card shows stamp buttons instead of the bill box (/me says which)
  const [mode, setMode] = useState<LoyaltyMode>("points");
  const [stampGoal, setStampGoal] = useState(10);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [today, setToday] = useState<Today | null>(null);
  const [todayOpen, setTodayOpen] = useState(false);
  const todaySeq = useRef(0);
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
      setMode(me.mode === "stamps" ? "stamps" : "points");
      if (typeof me.stampGoal === "number") setStampGoal(me.stampGoal);
      setHappyHour(typeof me.happyHour === "number" ? me.happyHour : null);
    }
  }
  useEffect(() => {
    loadMe();
    // owner-only pages send a cashier here with ?denied=1 instead of a silent bounce
    if (new URLSearchParams(window.location.search).get("denied") === "1")
      setToast({ kind: "bad", msg: "That page is for owners" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "Today" panel's numbers. Merchants have no time zone, so the browser
  // sends its own local midnight (the server clamps it). Refreshed after every
  // earn/redeem/undo; only the latest call may set them, so a slow answer to an
  // earlier refresh can't overwrite a newer one.
  async function loadToday() {
    const n = ++todaySeq.current;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    try {
      const res = await fetch(`/api/merchant/today?since=${encodeURIComponent(midnight.toISOString())}`);
      if (!res.ok) return;
      const t = await res.json();
      if (n === todaySeq.current) setToday(t);
    } catch {} // a failed refresh keeps the last numbers
  }
  // Open on wide screens, closed on phones so it never pushes the scanner down.
  // Re-read when the tablet wakes, so yesterday's numbers don't sit under "Today".
  useEffect(() => {
    setTodayOpen(window.matchMedia("(min-width: 641px)").matches);
    loadToday();
    const onShow = () => { if (document.visibilityState === "visible") loadToday(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
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

  // okMsg is for rewards and stamps; a bill earn's toast shows the points the server credited
  async function apply(body: { actionId: string } | { amount: number; confirm?: true } | { stamps: number }, okMsg = "") {
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
      if ("happyHour" in data) setHappyHour(typeof data.happyHour === "number" ? data.happyHour : null);
      // a big bill: the server wrote nothing and wants a confirm first
      if (res.status === 409 && data.confirm && "amount" in body) {
        setPending({ amount: body.amount, points: data.confirm.points });
        return;
      }
      if (!res.ok) {
        // "Not enough points/stamps" carries the real balance: show it, so the reward
        // buttons re-dim if another terminal spent points in the meantime
        if (typeof data.balance === "number") setCustomer({ ...customer, points: data.balance });
        setToast({ kind: "bad", msg: data.error || "Failed" });
        return;
      }
      setCustomer({ ...customer, points: data.newBalance });
      setFlash(true);
      setTimeout(() => setFlash(false), 400);
      setToast({ kind: "ok", msg: "amount" in body ? `+${data.points} pts` : okMsg, undoKey: key });
      loadToday();
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
      loadToday();
    } finally {
      setBusy(false);
    }
  }

  function earn() {
    setToast(null);
    const amt = parseBill(bill);
    if (amt === null) return setBillErr(true);
    apply({ amount: amt });
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
    setManual("");
  }

  const banner = happyHour ? (
    <div className={styles.happy} role="status">Happy hour {happyHour}× points</div>
  ) : null;

  // ---- scan view ----
  if (!customer) {
    return (
      <div className="wrap">
        {/* Scan view only: above a customer it would push "Scan next customer"
            off a laptop screen. Its numbers still refresh after every tap. */}
        <details className={styles.today} open={todayOpen} onToggle={(e) => setTodayOpen(e.currentTarget.open)}>
          <summary>
            <span className={styles.todayTitle}>Today</span>
            {/* closed, the headline numbers still show */}
            <span className={styles.todayPeek}>
              {todayOpen ? "your taps since midnight" : `${nf(today?.customers)} served · ${nf(today?.points)} pts`}
            </span>
          </summary>
          <dl className={styles.todayGrid}>
            <div><dt>Customers</dt><dd>{nf(today?.customers)}</dd></div>
            <div><dt>Points given</dt><dd>{nf(today?.points)}</dd></div>
            <div><dt>Rewards</dt><dd>{nf(today?.rewards)}</dd></div>
            <div><dt>Undos</dt><dd>{nf(today?.undos)}</dd></div>
          </dl>
          <div className={styles.todayNote}>An undone tap counts only under Undos.</div>
        </details>
        <div className="card stack">
          {banner}
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
                  <span className={styles.pickMeta}>{m.phone} · {m.voided ? "deactivated" : `${m.points} ${unitLabel(mode, m.points, true)}`}</span>
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
              <b>This card is deactivated.</b> No {unitLabel(mode, 2)} can be added or used. The owner can reactivate
              it on the customer&apos;s page.
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
  const stamps = mode === "stamps";
  return (
    <div className="wrap">
      <div className="card stack">
        {banner}
        <div>
          <div className="label">{customer.name || "Customer"}</div>
          <div className={`balance ${flash ? "flash" : ""}`}>{customer.points}</div>
          <div className="label" style={{ marginTop: 4 }}>{stamps ? `of ${stampGoal} stamps` : "points"}</div>
        </div>

        {toast && (
          <div className={`toast ${toast.kind} ${styles.toast}`}>
            <span>{toast.msg}</span>
            {toast.undoKey && (
              <button className={styles.undo} disabled={busy} onClick={() => undo(toast)}>Undo</button>
            )}
          </div>
        )}

        {stamps && (
          <>
            <div className="label" style={{ marginTop: 6 }}>Add stamps — one per item</div>
            <div className={styles.stampBtns}>
              {Array.from({ length: STAMP_EARN_MAX }, (_, i) => i + 1).map((n) => {
                const what = `+${n} ${unitLabel(mode, n)}`;
                return (
                  <button key={n} className={`btn ${n === 1 ? "btn-primary" : "btn-ghost"}`} disabled={busy}
                    aria-label={what} onClick={() => apply({ stamps: n }, what)}>
                    {n === 1 ? what : `+${n}`}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="label" style={{ marginTop: 6 }}>{stamps ? "Reward" : "Redeem"}</div>
        <div className={stamps ? styles.one : "grid2"}>
          {redemptions.map((a) => {
            const short = customer.points < -a.points; // a.points is the (negative) delta
            return (
              <button key={a.id} className={`redeem-btn ${short ? styles.short : ""}`} disabled={busy || short}
                onClick={() => apply({ actionId: a.id }, `${a.label} redeemed`)}>
                <div className="rl">{a.label}</div>
                <div className="rp">{a.points} {unitLabel(mode, -a.points, true)}</div>
                {short && <div className={styles.need}>needs {-a.points} · has {customer.points}</div>}
              </button>
            );
          })}
        </div>

        {!stamps && (
          <>
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
                = {Math.round(earnRate * billAmt * (happyHour ?? 1))} pts ({earnRate}× rate{happyHour ? ` × ${happyHour}` : ""})
              </div>
            )}
            {pending && (
              <div className={styles.confirm} role="alert">
                <div>
                  Big bill: <b>{formatMoney(pending.amount)}</b> will credit <b>+{pending.points} pts</b>
                  {happyHour ? ` (happy hour ${happyHour}×)` : ""}. Is that right?
                </div>
                <div className="row">
                  <button className="btn btn-primary" disabled={busy}
                    onClick={() => apply({ amount: pending.amount, confirm: true })}>
                    Add +{pending.points} pts
                  </button>
                  <button className="btn btn-ghost" style={{ width: "auto", padding: "0 18px" }}
                    onClick={() => setPending(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <SendCardPanel key={customer.serial} serial={customer.serial} />

        <button className="btn btn-primary" onClick={reset}>Scan next customer</button>
      </div>
    </div>
  );
}
