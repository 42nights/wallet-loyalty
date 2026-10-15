"use client";
import { useState } from "react";
import { STAMP_EARN_MAX, unitLabel } from "@/lib/config";
import { usePhone } from "../../demo/DemoClient";
import { LockBanner, Phone, WalletCard, type Colors, type Logo, type Slot } from "../../demo/WalletCard";
import type { QR } from "../../demo/samples";
import s from "../../demo/demo.module.css";
import t from "./try.module.css";

// The stamp card counterpart of /demo's board: a sample card in a phone and a
// counter that works like /scan on a stamp card (+1..+3 stamps per tap, the one
// reward at the goal, Undo on the last tap for as long as /scan offers it).
// All client-side, nothing is saved.

type Props = {
  name: string;
  colors: Colors;
  logo?: Logo;
  icon?: string;
  reward: string;
  slots: Slot[]; // one per stamp of the goal
  customer: string;
  qr: QR;
};

type Toast = { msg: string; undo?: number }; // undo: the delta Undo takes back

const UNDO_MS = 10_000; // /scan's UNDO_MS

export default function StampBoard(props: Props) {
  const [run, setRun] = useState(0); // bump to reset the board
  return <Board key={run} {...props} onReset={() => setRun((r) => r + 1)} />;
}

function Board({ name, colors, logo, icon, reward, slots, customer, qr, onReset }: Props & { onReset: () => void }) {
  const goal = slots.length;
  const start = Math.max(0, goal - 4); // +1 then +3 fills the card
  const [stamps, setStamps] = useState(start); // what the terminal shows
  const [from, setFrom] = useState(start); // the card's count before the latest tap
  const [toast, setToast] = useState<Toast | null>(null);
  const [termFlash, setTermFlash] = useState(false);
  const phone = usePhone(start);

  function apply(delta: number, msg: string, undoable = true) {
    const next = stamps + delta;
    setStamps(next);
    setFrom(phone.card);
    const shown: Toast = { msg, undo: undoable ? delta : undefined };
    setToast(shown);
    phone.later(() => setToast((cur) => (cur === shown ? { msg } : cur)), UNDO_MS);
    setTermFlash(true);
    phone.later(() => setTermFlash(false), 400);
    phone.update(next);
  }

  function undo(t: Toast) {
    if (t.undo !== undefined) apply(-t.undo, `Undone: ${t.msg}`, false);
  }

  const short = stamps < goal;

  return (
    <div className={s.board}>
      <ol className={s.guide}>
        <li>
          Tap <b>+1 stamp</b> for one item, then <b>+3</b> for three on one order.
        </li>
        <li>Watch {customer.split(" ")[0]}&apos;s card and the notification on the phone.</li>
        <li>
          At {goal} stamps, tap <b>{reward}</b>. A mis-tap? <b>Undo</b> takes it back.
        </li>
      </ol>

      <section className={s.phoneCol} aria-label="Customer's iPhone" ref={phone.ref}>
        <Phone
          banner={
            <LockBanner name={name} colors={colors} icon={icon} points={phone.card} goal={goal} shown={phone.banner} dock={phone.dock} />
          }
        >
          <WalletCard name={name} colors={colors} logo={logo} points={phone.card} qr={qr} stamps={{ reward, slots, from }} />
        </Phone>
        <p className={s.caption}>
          The customer&apos;s iPhone. In the real product the card refreshes in Apple Wallet after each visit.
        </p>
      </section>

      <section className={`card ${s.counter}`} aria-label="Counter terminal">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="dot" aria-hidden="true" /> 42nights <small>terminal</small>
        </div>
        <div className="label">{customer}</div>
        <div className={`balance ${termFlash ? "flash" : ""}`}>{stamps}</div>
        <div className="label" style={{ marginTop: 4 }}>of {goal} stamps</div>

        <div role="status" aria-live="polite" className={s.toastSlot}>
          {toast && (
            <div className={`toast ok ${t.toast}`}>
              <span>{toast.msg}</span>
              {toast.undo !== undefined && (
                <button type="button" className={t.undo} onClick={() => undo(toast)}>
                  Undo
                </button>
              )}
            </div>
          )}
        </div>

        <div className="label" style={{ marginTop: 18 }}>Add stamps · one per item</div>
        <div className={t.stampBtns}>
          {Array.from({ length: STAMP_EARN_MAX }, (_, i) => i + 1).map((n) => {
            const what = `+${n} ${unitLabel("stamps", n)}`;
            return (
              <button key={n} type="button" aria-label={what} onClick={() => apply(n, what)}
                className={`btn ${n === 1 ? "btn-primary" : "btn-ghost"}`}>
                {n === 1 ? what : `+${n}`}
              </button>
            );
          })}
        </div>

        <div className="label" style={{ marginTop: 18 }}>Reward</div>
        <button type="button" className={`redeem-btn ${t.reward} ${short ? s.short : ""}`} disabled={short}
          onClick={() => apply(-goal, `${reward} redeemed`)}>
          <div className="rl">{reward}</div>
          <div className="rp">-{goal} stamps</div>
          {short && <div className={s.need}>needs {goal} · has {stamps}</div>}
        </button>

        <div className={s.after}>
          <button type="button" className={s.reset} onClick={onReset}>
            Reset demo
          </button>
        </div>
      </section>
    </div>
  );
}
