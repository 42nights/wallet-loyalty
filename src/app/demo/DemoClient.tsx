"use client";
import { useEffect, useRef, useState } from "react";
import type { Action } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { TrendChart } from "@/app/(merchant)/dashboard/charts";
import { parseBill } from "@/app/(merchant)/scan/bill";
import { LockBanner, Phone, WalletCard, type Logo } from "./WalletCard";
import type { QR, Sample } from "./samples";
import s from "./demo.module.css";

// The interactive /demo: a sample card in a phone, a counter that works like
// /scan, and the owner's dashboard. All client-side, nothing is saved. It
// behaves like the shipped terminal (F17): the same bill parser and dimmed
// "needs N · has M" rewards as /scan (shared parser, its own styles), and the redeem
// route's math and limit: earn = round(earn_rate × bill), a bill over the
// shop's limit is refused, a reward deducts its template cost.

export type DemoMerchant = Sample & { actions: Action[]; logo?: Logo; icon?: string };

const nf = (n: number) => n.toLocaleString("en-US");
const CARD_DELAY_MS = 600; // the terminal answers first, then Wallet refreshes the card
const BANNER_MS = 3800;
// merchants.max_bill schema default: the limit every new shop starts with.
// The big-bill confirm that /scan shows at half this is left out: the guided
// demo bills are a few dollars.
const MAX_BILL = 1000;

// Balance count-up. Interruptible (starts from whatever is on screen) and
// instant when the visitor prefers reduced motion.
function useCountUp(target: number) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const v = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      current.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

// The phone's half of a tap: the terminal answers first, then after
// CARD_DELAY_MS the Wallet card catches up and the lock-screen banner shows.
// Shared with the stamp card board on /try.
export function usePhone(start: number) {
  const [card, setCard] = useState(start);
  const [cardFlash, setCardFlash] = useState(false);
  const [banner, setBanner] = useState(false);
  const [dock, setDock] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const hideBanner = useRef(0);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  };

  function update(next: number) {
    later(() => {
      setCard(next);
      setCardFlash(true);
      // Show the banner on the phone when its top is on screen; otherwise dock
      // it to the top of the viewport so the visitor still sees it while using
      // the counter (on phones the counter sits below the phone).
      const r = ref.current?.getBoundingClientRect();
      setDock(!r || r.top + 40 < 0 || r.top + 110 > window.innerHeight);
      setBanner(true);
      // one hide timer: a quick second tap keeps the banner up for its full time
      window.clearTimeout(hideBanner.current);
      hideBanner.current = later(() => setBanner(false), BANNER_MS);
    }, CARD_DELAY_MS);
    later(() => setCardFlash(false), CARD_DELAY_MS + 450);
  }

  return { card, cardFlash, banner, dock, ref, later, update };
}

export default function DemoClient({ merchants, qr, updated }: { merchants: DemoMerchant[]; qr: QR; updated: string }) {
  const [idx, setIdx] = useState(0);
  const [run, setRun] = useState(0); // bump to reset the board
  const m = merchants[idx];
  return (
    <>
      {merchants.length > 1 && (
        <div className={s.switcher} role="group" aria-label="Sample business">
          {merchants.map((x, i) => (
            <button key={x.key} type="button" aria-pressed={i === idx} className={s.switch} onClick={() => setIdx(i)}>
              <span className={s.swatch} style={{ background: x.colors.bg }} aria-hidden="true" />
              <span>
                <b>{x.kind}</b>
                <small>{x.name}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {/* keyed: switching business or pressing Reset remounts the board with fresh state */}
      <Board key={`${m.key}-${run}`} m={m} qr={qr} updated={updated} onReset={() => setRun((r) => r + 1)} />
    </>
  );
}

function Board({ m, qr, updated, onReset }: { m: DemoMerchant; qr: QR; updated: string; onReset: () => void }) {
  const [points, setPoints] = useState(m.startPoints); // what the terminal shows
  const [issued, setIssued] = useState(0); // this session, feeds the dashboard
  const [redeemed, setRedeemed] = useState(0);
  const [bill, setBill] = useState(m.suggestedBill);
  const [toast, setToast] = useState<{ kind: "ok" | "bad"; msg: string } | null>(null);
  const [termFlash, setTermFlash] = useState(false);
  const phone = usePhone(m.startPoints); // phone.card: what the Wallet card shows
  const shown = useCountUp(phone.card);

  function apply(delta: number, okMsg: string) {
    const next = points + delta;
    setPoints(next);
    if (delta > 0) setIssued((n) => n + delta);
    else setRedeemed((n) => n - delta);
    setToast({ kind: "ok", msg: okMsg });
    setTermFlash(true);
    phone.later(() => setTermFlash(false), 400);
    phone.update(next);
  }

  const amount = parseBill(bill);
  const overLimit = amount !== null && amount > MAX_BILL;
  const earn = amount !== null && !overLimit ? Math.round(m.earnRate * amount) : 0;

  function addBill() {
    if (amount === null) return setToast({ kind: "bad", msg: "Enter an amount like 12.50" });
    if (overLimit)
      return setToast({
        kind: "bad",
        msg: `Bill is over this shop's limit of ${formatMoney(MAX_BILL)} — check the amount, or ask the owner to raise the limit in Settings`,
      });
    apply(earn, `+${earn} pts`);
    setBill("");
  }

  // The guide's suggested reward: the biggest one the pre-filled bill unlocks.
  const firstEarn = Math.round(m.earnRate * Number(m.suggestedBill));
  const target = m.actions
    .filter((a) => m.startPoints + firstEarn + a.points >= 0)
    .sort((a, b) => a.points - b.points)[0];

  const k = m.kpis;
  const today = (series: number[], n: number) => [...series.slice(0, -1), series[series.length - 1] + n];
  const issued14 = today(m.issued14, issued);
  const redeemed14 = today(m.redeemed14, redeemed);

  return (
    <div className={s.board}>
      <ol className={s.guide}>
        <li>Tap <b>Add</b> to ring up the ${m.suggestedBill} bill: {firstEarn} points at {m.earnRate} per $1.</li>
        <li>Watch {m.customer.split(" ")[0]}&apos;s card and the notification on the phone.</li>
        {target && <li>Tap <b>{target.label}</b> to spend {-target.points} points.</li>}
      </ol>

      <section className={s.phoneCol} aria-label="Customer's iPhone" ref={phone.ref}>
        <Phone
          banner={<LockBanner name={m.name} colors={m.colors} icon={m.icon} points={phone.card} shown={phone.banner} dock={phone.dock} />}
        >
          <WalletCard name={m.name} colors={m.colors} logo={m.logo} points={shown} updated={updated} qr={qr} flash={phone.cardFlash} />
        </Phone>
        <p className={s.caption}>
          The customer&apos;s iPhone. In the real product the card refreshes in Apple Wallet after each visit.
        </p>
      </section>

      <section className={`card ${s.counter}`} aria-label="Counter terminal">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="dot" aria-hidden="true" /> 42nights <small>terminal</small>
        </div>
        <div className="label">{m.customer}</div>
        <div className={`balance ${termFlash ? "flash" : ""}`}>{points}</div>
        <div className="label" style={{ marginTop: 4 }}>points</div>

        <div role="status" aria-live="polite" className={s.toastSlot}>
          {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
        </div>

        <div className="label" style={{ marginTop: 18 }}>Redeem</div>
        <div className="grid2">
          {m.actions.map((a) => {
            const short = points < -a.points; // the /scan rule; a.points is the (negative) delta
            return (
              <button key={a.id} type="button" className={`redeem-btn ${short ? s.short : ""}`} disabled={short}
                onClick={() => apply(a.points, `${a.label} redeemed`)}>
                <div className="rl">{a.label}</div>
                <div className="rp">{a.points} pts</div>
                {short && <div className={s.need}>needs {-a.points} · has {points}</div>}
              </button>
            );
          })}
        </div>

        <label className="label" htmlFor="demo-bill" style={{ display: "block", marginTop: 18 }}>
          Earn: enter the bill amount
        </label>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            addBill();
          }}
        >
          <input id="demo-bill" value={bill} onChange={(e) => setBill(e.target.value)} inputMode="decimal" placeholder="bill amount" />
          <button type="submit" className="btn btn-ghost" style={{ width: "auto", padding: "0 18px" }}>
            Add
          </button>
        </form>
        <div className={s.after}>
          <span className="label" style={{ margin: 0 }}>
            {earn > 0 ? `= ${earn} pts (${m.earnRate}× rate)` : ""}
          </span>
          <button type="button" className={s.reset} onClick={onReset}>
            Reset demo
          </button>
        </div>
      </section>

      <section className={s.owner} aria-labelledby="owner-h">
        <div className={s.ownerHead}>
          <h2 id="owner-h">What the owner sees</h2>
          <p>Sample numbers for {m.name}. Your visits from the counter above are added to today.</p>
        </div>
        <div className={s.kpis}>
          <Kpi k="Members" v={nf(k.members)} />
          <Kpi k="Active · 30d" v={nf(k.active)} />
          <Kpi k="Points issued" v={nf(k.issued + issued)} hot={issued > 0} />
          <Kpi k="Points redeemed" v={nf(k.redeemed + redeemed)} hot={redeemed > 0} />
          <Kpi k="Repeat rate" v={`${Math.round(k.repeat * 100)}%`} />
        </div>
        <div className={s.ownerGrid}>
          <div className="panel">
            <div className="panel-h">
              <span className="panel-t">Points flow</span>
              <span className="label" style={{ margin: 0 }}>last 14 days</span>
            </div>
            <TrendChart
              caption="per day"
              series={[
                { label: "Issued", color: "var(--c-issued)", data: issued14 },
                { label: "Redeemed", color: "var(--c-redeemed)", data: redeemed14 },
              ]}
            />
          </div>
          <div className="panel">
            <div className="panel-h">
              <span className="panel-t">At-risk regulars</span>
            </div>
            {m.atRisk.map((c) => (
              <div className="lrow" key={c.name}>
                <span>{c.name}</span>
                <span className={s.muted}>
                  {c.visits} visits, last {c.days} days ago
                </span>
              </div>
            ))}
            <p className={s.note}>
              Campaigns can give a segment like this bonus points and put an offer on the back of their card.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Kpi({ k, v, hot = false }: { k: string; v: string; hot?: boolean }) {
  return (
    <div className={`panel ${s.kpi} ${hot ? s.hot : ""}`}>
      <div className="panel-t">{k}</div>
      <div className={s.kpiV}>{v}</div>
    </div>
  );
}
