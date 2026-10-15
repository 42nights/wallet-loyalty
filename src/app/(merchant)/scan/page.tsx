"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Html5Qrcode as Scanner } from "html5-qrcode";
import { STAMP_EARN_MAX, unitLabel, type Action, type LoyaltyMode } from "@/lib/config";
import SendCardPanel from "@/components/SendCardPanel";
import Icon from "@/components/Icon";
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
const LOOKUP_DOWN = "Couldn't look that up — check the connection and try again";
// No answer at all: the tap may or may not have landed, so don't claim either.
const NO_ANSWER = "Couldn't reach the server — look the card up again to check its balance";
// A 4xx carries a message written for the cashier ("Not enough points"); a 5xx doesn't.
const errorOf = (res: Response, data: { error?: unknown }, fallback: string) =>
  res.status < 500 && typeof data.error === "string" ? data.error : fallback;

export default function ScanPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [flash, setFlash] = useState(false);
  const [tapped, setTapped] = useState(false); // this customer got a tap: "next" becomes the primary
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
  const scannerRef = useRef<Scanner | null>(null);
  const scanningRef = useRef(false);
  const lastScan = useRef(""); // the code the camera just sent (it reads one ~10×/s)

  // load this merchant's earn rate (bill → points preview) and redeem buttons.
  // Re-run on "Scan next customer" too: the counter tablet keeps /scan open all
  // day, and an owner changing the template in Settings would otherwise leave
  // it showing buttons the server now rejects.
  async function loadMe() {
    try {
      const res = await fetch("/api/merchant/me");
      if (res.status === 401) return router.push("/login");
      if (!res.ok) return;
      const me = await res.json();
      if (typeof me.earnRate === "number") setEarnRate(me.earnRate);
      if (typeof me.maxBill === "number") setMaxBill(me.maxBill);
      if (Array.isArray(me.redemptions)) setRedemptions(me.redemptions);
      setMode(me.mode === "stamps" ? "stamps" : "points");
      if (typeof me.stampGoal === "number") setStampGoal(me.stampGoal);
      setHappyHour(typeof me.happyHour === "number" ? me.happyHour : null);
    } catch {} // keeps the last settings; the next "Scan next customer" retries
  }
  useEffect(() => {
    loadMe();
    // owner-only pages send a cashier here with ?denied=1 instead of a silent bounce
    if (new URLSearchParams(window.location.search).get("denied") === "1")
      setToast({ kind: "bad", msg: "That page is for owners" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "Your taps today" numbers. Merchants have no time zone, so the browser
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
  // Re-read when the tablet wakes, so yesterday's numbers don't sit under "today".
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

  // A customer loaded, or "Scan next customer": start at the top, not wherever
  // the last view was scrolled to.
  useEffect(() => window.scrollTo(0, 0), [customer?.serial]);

  // start camera scanner when no customer is loaded
  useEffect(() => {
    if (customer) return;
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled || !document.getElementById("reader")) return;
        setCameraError(false);
        const scanner = new Html5Qrcode("reader");
        scannerRef.current = scanner;
        scanningRef.current = true;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 240 },
          (decoded: string) => {
            // the same code again only after a pause, so a card that isn't
            // found (or a dropped connection) isn't re-sent 10×/s
            if (decoded === lastScan.current) return;
            lastScan.current = decoded;
            setTimeout(() => { if (lastScan.current === decoded) lastScan.current = ""; }, 2500);
            lookup(decoded);
          },
          () => {}
        );
      } catch {
        // no camera, permission denied, not https, or the scanner code didn't
        // load: say so, so the cashier uses the card code / phone lookup below
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

  // The camera keeps running until a card loads (loading one unmounts the
  // reader), so a code that isn't found leaves it ready for the next one.
  async function lookup(serial: string) {
    setToast(null);
    try {
      const res = await fetch("/api/merchant/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial }),
      });
      if (res.status === 401) return router.push("/login");
      if (res.ok) return setCustomer(await res.json());
      const data = await res.json().catch(() => ({}));
      setToast({
        kind: "bad",
        msg: res.status === 404 ? "No card found — check the code or search by phone" : errorOf(res, data, LOOKUP_DOWN),
      });
    } catch {
      setToast({ kind: "bad", msg: LOOKUP_DOWN });
    }
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
      if (!res.ok) return setToast({ kind: "bad", msg: errorOf(res, data, LOOKUP_DOWN) });
      const found: PhoneMatch[] = data.matches ?? [];
      if (found.length === 0)
        return setToast({ kind: "bad", msg: "No card with that phone number — check it, or try the card code" });
      if (found.length === 1) return pick(found[0]);
      setMatches(found);
    } catch {
      setToast({ kind: "bad", msg: LOOKUP_DOWN });
    } finally {
      setBusy(false);
    }
  }

  function pick(m: PhoneMatch) {
    setCustomer({ serial: m.serial, name: m.name, points: m.points, voided: m.voided }); // effect cleanup stops the camera
    setMatches(null);
    setPhone("");
  }

  function flashBalance() {
    setFlash(true);
    setTimeout(() => setFlash(false), 400);
  }

  // okMsg is for rewards and stamps; a bill earn's toast shows the points the server credited
  async function apply(body: { actionId: string } | { amount: number; confirm?: true } | { stamps: number }, okMsg = "") {
    if (!customer || busy) return; // busy guard: no double-tap
    setBusy(true);
    setToast(null); // an old toast must never read as this tap's result
    setPending(null);
    // a 5xx means apply_points wrote nothing
    const failed = "actionId" in body
      ? "Couldn't redeem — nothing was changed. Try again"
      : `Couldn't add ${unitLabel(mode, 2)} — nothing was changed. Try again`;
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
      const data = await res.json().catch(() => ({}));
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
        setToast({ kind: "bad", msg: errorOf(res, data, failed) });
        return;
      }
      setCustomer({ ...customer, points: data.newBalance });
      flashBalance();
      setTapped(true);
      setToast({ kind: "ok", msg: "amount" in body ? `+${data.points} pts` : okMsg, undoKey: key });
      loadToday();
      if ("amount" in body) {
        // a bill left in the box invites a second tap, i.e. a double credit
        setBill("");
        setAddLocked(true);
        setTimeout(() => setAddLocked(false), 1500);
      }
    } catch {
      setToast({ kind: "bad", msg: NO_ANSWER });
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
        setToast({ kind: "bad", msg: errorOf(res, data, "Couldn't undo — the tap stands. Ask the owner to adjust it") });
        return;
      }
      setCustomer({ ...customer, points: data.newBalance });
      flashBalance();
      setToast({ kind: "ok", msg: `Undone: ${t.msg}` });
      loadToday();
    } catch {
      setToast({ kind: "bad", msg: NO_ANSWER });
    } finally {
      setBusy(false);
    }
  }

  function earn(e: FormEvent) {
    e.preventDefault();
    if (busy || addLocked) return;
    setToast(null);
    const amt = parseBill(bill);
    if (amt === null) return setBillErr(true);
    apply({ amount: amt });
  }

  function reset() {
    loadMe();
    setCustomer(null);
    setToast(null);
    setTapped(false);
    setBill("");
    setBillErr(false);
    setPending(null);
    setPhone("");
    setMatches(null);
    setManual("");
  }

  const stamps = mode === "stamps";
  const banner = happyHour ? (
    <div className={styles.happy} role="status">
      <Icon name="clock" size={20} />
      Happy hour {happyHour}× points
    </div>
  ) : null;
  // Always mounted: a live region has to exist before it can announce anything.
  const slot = (
    <div className={styles.slot} role="status" aria-live="polite">
      {toast && (
        <div className={`toast ${toast.kind}`}>
          <Icon name={toast.kind === "ok" ? "check" : "alert"} />
          <span className={styles.toastMsg}>{toast.msg}</span>
          {toast.undoKey && (
            <button type="button" className={`btn btn-ghost btn-sm ${styles.undo}`} onClick={() => undo(toast)}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ---- find view: camera, then card code / phone ----
  if (!customer) {
    const served = today?.customers;
    return (
      <div className="page page--narrow">
        <h1 className="sr-only">Scan</h1>
        <div className={styles.view}>
          {banner}
          <section className={`card ${styles.camera}`} data-error={cameraError || undefined} aria-labelledby="scan-cam">
            <h2 id="scan-cam" className="sr-only">Scan the customer&apos;s Wallet QR</h2>
            <div id="reader" />
            {cameraError && (
              <div className={styles.camError} role="status">
                <Icon name="scan" size={24} />
                <p>Camera unavailable — allow camera access, or find the customer below</p>
              </div>
            )}
          </section>
          {slot}
          <section className="panel" aria-labelledby="scan-find">
            <h2 id="scan-find" className="panel-t">Find a customer</h2>
            <form className="field" onSubmit={findBySerial}>
              <label className="field-label" htmlFor="scan-serial">Card code (under the QR)</label>
              <div className={styles.inline}>
                <input id="scan-serial" className={styles.serial} value={manual} onChange={(e) => setManual(e.target.value)}
                  placeholder="serial…" enterKeyHint="go" autoCapitalize="none" autoComplete="off" spellCheck={false} />
                <button className="btn btn-ghost btn-lg" type="submit">Go</button>
              </div>
            </form>
            <form className="field" onSubmit={findByPhone}>
              <label className="field-label" htmlFor="scan-phone">Phone number</label>
              <div className={styles.inline}>
                <input id="scan-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
                  type="tel" inputMode="tel" autoComplete="off" enterKeyHint="search" placeholder="(415) 555-0168" />
                <button className="btn btn-ghost btn-lg" type="submit" disabled={busy}>{busy ? "Finding…" : "Find"}</button>
              </div>
            </form>
            {matches && (
              <div className={styles.picks}>
                <p className={styles.picksNote}>{matches.length} cards match — pick one</p>
                {matches.map((m) => (
                  <button key={m.serial} type="button" className={styles.pick} onClick={() => pick(m)}>
                    <span className={styles.pickText}>
                      <span className={styles.pickName}>{m.name || "Customer"}</span>
                      <span className={styles.pickMeta}>
                        {m.phone} · {m.voided ? "deactivated" : `${m.points} ${unitLabel(mode, m.points, true)}`}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={20} />
                  </button>
                ))}
              </div>
            )}
          </section>
          {/* Find view only: above a customer it would push "Scan next customer"
              down. Its numbers still refresh after every tap. */}
          <details className={styles.today} open={todayOpen} onToggle={(e) => setTodayOpen(e.currentTarget.open)}>
            <summary>
              <span className={`panel-t ${styles.todayTitle}`}>Your taps today</span>
              <span className={styles.todayPeek}>
                {nf(served)} {served === 1 ? "customer" : "customers"} · {nf(today?.points)} {unitLabel(mode, today?.points ?? 0, true)}
              </span>
              <Icon name="chevron-down" size={20} className={styles.chev} />
            </summary>
            <dl className={styles.todayGrid}>
              <div className="kpi"><dt className="k">Customers</dt><dd className="v">{nf(served)}</dd></div>
              {/* the route sums every earn: delta, so on a stamp card these are stamps */}
              <div className="kpi"><dt className="k">{stamps ? "Stamps given" : "Points given"}</dt><dd className="v">{nf(today?.points)}</dd></div>
              <div className="kpi"><dt className="k">Rewards</dt><dd className="v">{nf(today?.rewards)}</dd></div>
              <div className="kpi"><dt className="k">Undone</dt><dd className="v">{nf(today?.undos)}</dd></div>
            </dl>
            <p className={styles.todayNote}>Undone taps aren&apos;t counted in the other totals.</p>
          </details>
        </div>
      </div>
    );
  }

  // secondary until a tap has happened; on a deactivated card it's the only action
  const next = (
    <div className={styles.next}>
      <button className={`btn btn-lg btn-block ${tapped || customer.voided ? "btn-primary" : "btn-ghost"} ${styles.main}`} onClick={reset}>
        Scan next customer
      </button>
    </div>
  );

  // ---- deactivated card: nothing to earn, redeem or re-send ----
  if (customer.voided) {
    return (
      <div className="page page--narrow">
        <h1 className="sr-only">Scan</h1>
        <div className={styles.view}>
          <section className="card">
            <h2 className={styles.name}>{customer.name || "Customer"}</h2>
            <div className={styles.voided} role="status">
              <Icon name="alert" size={20} />
              <p>
                <b>This card is deactivated.</b> No {unitLabel(mode, 2)} can be added or used. The owner can reactivate
                it on the customer&apos;s page.
              </p>
            </div>
          </section>
          {next}
        </div>
      </div>
    );
  }

  // ---- customer view: balance, earn first, then rewards ----
  const billAmt = parseBill(bill);
  // over the shop's cap: the server would refuse it, so say so now instead of
  // previewing points it won't credit
  const overCap = billAmt !== null && maxBill !== null && billAmt > maxBill;
  return (
    <div className="page page--narrow">
      <h1 className="sr-only">Scan</h1>
      {/* busy dims the actions only if the answer takes over 150ms (.pending-dim) */}
      <div className={styles.view} data-pending={busy || undefined} aria-busy={busy}>
        {banner}
        <section className="card" aria-labelledby="scan-name">
          <h2 id="scan-name" className={styles.name}>{customer.name || "Customer"}</h2>
          <div className={`balance ${flash ? "flash" : ""}`}>{customer.points}</div>
          <p className={styles.unit}>{stamps ? `of ${stampGoal} stamps` : "points"}</p>
          {slot}
        </section>

        {stamps ? (
          <section className="panel pending-dim" aria-labelledby="scan-stamps">
            <div className="panel-h">
              <h3 id="scan-stamps" className="panel-t">Add stamps</h3>
              <span className="panel-meta">One per item</span>
            </div>
            <div className={styles.stampBtns}>
              {Array.from({ length: STAMP_EARN_MAX }, (_, i) => i + 1).map((n) => {
                const what = `+${n} ${unitLabel(mode, n)}`;
                return (
                  <button key={n} type="button" aria-label={what} onClick={() => apply({ stamps: n }, what)}
                    className={`btn btn-lg ${n === 1 ? "btn-primary" : "btn-ghost"} ${styles.main}`}>
                    {n === 1 ? what : `+${n}`}
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <form className="panel pending-dim" onSubmit={earn}>
            <label className="panel-t" htmlFor="scan-bill">Add points for a bill</label>
            <div className={styles.billRow}>
              <div className="affix">
                <span className={styles.cur} aria-hidden="true">$</span>
                <input id="scan-bill" value={bill} placeholder="bill amount" inputMode="decimal" enterKeyHint="go"
                  autoComplete="off" aria-invalid={billErr} aria-describedby="scan-bill-msg"
                  onChange={(e) => { setBill(e.target.value); setBillErr(false); setPending(null); }} />
              </div>
              <button className={`btn btn-primary btn-lg ${styles.main}`} type="submit" disabled={addLocked}>Add</button>
            </div>
            <div id="scan-bill-msg" className={styles.billMsg}>
              {billErr ? (
                <div className="field-error" role="alert"><Icon name="alert" />Enter an amount like 12.50</div>
              ) : overCap ? (
                <div className="field-error" role="alert">
                  <Icon name="alert" />
                  Over this shop&apos;s limit of {formatMoney(maxBill)} — check the amount, or ask the owner to raise the limit in Settings
                </div>
              ) : billAmt !== null ? (
                <div className={styles.preview}>
                  = {Math.round(earnRate * billAmt * (happyHour ?? 1))} pts ({earnRate}× rate{happyHour ? ` × ${happyHour}` : ""})
                </div>
              ) : (
                <div className={styles.hint}>
                  {earnRate * (happyHour ?? 1)} {earnRate * (happyHour ?? 1) === 1 ? "point" : "points"} per $1
                  {happyHour ? " during happy hour" : ""}
                </div>
              )}
            </div>
            {pending && (
              <div className="confirm" role="alert">
                <div>
                  Big bill: <b>{formatMoney(pending.amount)}</b> will credit <b>+{pending.points} pts</b>
                  {happyHour ? ` (happy hour ${happyHour}×)` : ""}. Is that right?
                </div>
                <div className="row">
                  <button type="button" className="btn btn-primary btn-lg"
                    onClick={() => apply({ amount: pending.amount, confirm: true })}>
                    Add +{pending.points} pts
                  </button>
                  <button type="button" className="btn btn-ghost btn-lg" onClick={() => setPending(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </form>
        )}

        {redemptions.length > 0 && (
          <section className="panel pending-dim" aria-labelledby="scan-redeem">
            <h3 id="scan-redeem" className="panel-t">{stamps ? "Reward" : "Redeem a reward"}</h3>
            <div className={stamps ? styles.one : styles.grid}>
              {redemptions.map((a) => {
                const cost = -a.points; // a.points is the (negative) delta
                const short = customer.points < cost;
                return (
                  <button key={a.id} type="button" className={`redeem-btn ${styles.reward}`}
                    disabled={short} onClick={() => apply({ actionId: a.id }, `${a.label} redeemed`)}>
                    <span className={styles.rl}>{a.label}</span>
                    <span className={styles.rp}>−{cost} {unitLabel(mode, cost, true)}</span>
                    {short && <span className={styles.need}>needs {cost} · has {customer.points}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <SendCardPanel key={customer.serial} serial={customer.serial} />
        {next}
      </div>
    </div>
  );
}
