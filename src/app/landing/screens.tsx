import type { CSSProperties, ReactNode } from "react";
import { LockBanner, Phone, WalletCard } from "../demo/WalletCard";
import type { QR, Sample } from "../demo/samples";
import { stampLayout } from "@/lib/wallet/apple/stampStrip";
import s from "./landing.module.css";

// The phone screens of the landing page's story. Server-rendered once, inside
// each section's own phone (its lane). On desktop, landing/Story.tsx clones
// them into the one phone that travels down the page; on smaller screens each
// section's phone plays its own screens when it comes into view.
//
// Every screen's resting styles are its LAST frame: that is what no-JS and
// reduced-motion visitors see. Motion runs only while Story marks a screen
// data-on inside a data-live stack, and only on transform/opacity (plus
// clip-path for typing; the stamp press uses a static mask). Copy on the
// screens mirrors the shipped product:
// EnrollForm, the /scan terminal, pass.ts fields and change messages.

export type Story = { cafe: Sample; diner: Sample; qr: QR; updated: string };

type Colors = Sample["colors"];
const vars = (c: Colors) => ({ "--pb": c.bg, "--pf": c.fg, "--pl": c.label }) as CSSProperties;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((x) => /^[A-Za-z]/.test(x))
    .slice(0, 2)
    .map((x) => x[0])
    .join("");

// A phone whose screen is a stack of screens. `slot` marks it as a landing spot
// for the travelling phone: "pin" lanes hold it at viewport centre, a "static"
// slot (hero, closing) is where it sits in the page.
export function StoryPhone({ slot, intro, children }: { slot: "pin" | "static"; intro?: boolean; children: ReactNode }) {
  return (
    <div className={s.slot} data-slot={slot} data-intro={intro ? "" : undefined}>
      <Phone>
        <div className={s.stack} data-stack>
          {children}
        </div>
      </Phone>
    </div>
  );
}

function Scr({ id, rest, className, children }: { id: string; rest?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`${s.scr} ${className ?? ""}`} data-scr={id} data-rest={rest ? "" : undefined}>
      {children}
    </div>
  );
}

// The sample QR drawn as one rect per run of dark modules in a row instead of
// one per module: the same code, a fraction of the path. It is on the page a
// dozen times (every card and poster), so this keeps the HTML small.
export function runs(qr: QR): QR {
  const cells = [...qr.d.matchAll(/M(\d+) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  let d = "";
  for (let i = 0; i < cells.length; ) {
    const [c, r] = cells[i];
    let n = 1;
    while (i + n < cells.length && cells[i + n][1] === r && cells[i + n][0] === c + n) n++;
    d += `M${c} ${r}h${n}v1h-${n}z`;
    i += n;
  }
  return { size: qr.size, d };
}

function Code({ qr }: { qr: QR }) {
  return (
    <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} shapeRendering="crispEdges" aria-hidden="true">
      <path d={qr.d} fill="#000" />
    </svg>
  );
}

// The stamp card is WalletCard's own (Fern & Fox: Free coffee at 10). A press
// lays the card before the stamp over the card after it; when the press plays,
// the top card opens a hole over the new stamp's slot so it lands from
// underneath (landing.module.css). Its rest state is the card after.
const SLOTS = stampLayout(10);
const stampCard = (m: Sample, qr: QR, n: number) => (
  <WalletCard name={m.name} colors={m.colors} points={n} qr={qr} stamps={{ reward: "Free coffee", slots: SLOTS, from: n - 1 }} />
);

function Press({ m, qr, n, shine }: { m: Sample; qr: QR; n: number; shine?: boolean }) {
  const { x, y, d } = SLOTS[n - 1];
  return (
    <div className={s.press} style={{ ...vars(m.colors), "--x": x, "--y": y, "--d": d } as CSSProperties}>
      {stampCard(m, qr, n)}
      <div className={s.before}>{stampCard(m, qr, n - 1)}</div>
      <i className={s.ink} />
      {shine && <i className={s.shine} />}
    </div>
  );
}

// ---- hero ----
export function LockScreen({ story, rest }: { story: Story; rest?: boolean }) {
  const { cafe, qr, updated } = story;
  return (
    <Scr id="lock" rest={rest}>
      <div className={s.drop}>
        <LockBanner name={cafe.name} colors={cafe.colors} points={120} shown />
      </div>
      <div className={s.lockPad}>
        <WalletCard name={cafe.name} colors={cafe.colors} points={120} updated={updated} qr={qr} />
      </div>
    </Scr>
  );
}

// ---- how it works ----
export function HowScreens({ story }: { story: Story }) {
  const { cafe, qr, updated } = story;
  const card = <WalletCard name={cafe.name} colors={cafe.colors} points={0} updated={updated} qr={qr} />;
  return (
    <>
      {/* 1. iOS Camera on the counter poster (settings/poster) */}
      <Scr id="scan" rest className={s.cam}>
        <div className={s.feed}>
          <div className={s.poster} style={vars(cafe.colors)}>
            <div className={s.posterBand}>
              <span className={s.posterLogo}>{initials(cafe.name)}</span>
              {cafe.name}
            </div>
            <b className={s.posterHead}>Get your {cafe.name} rewards card</b>
            <div className={s.posterQr}>
              <Code qr={qr} />
              <i className={s.scanLine} />
              <i className={s.brackets} />
            </div>
            <span className={s.posterLead} />
            <span className={s.posterLead} />
          </div>
          <div className={s.pill}>
            <i className={s.compass} />
            {cafe.name} · Safari
          </div>
        </div>
        <div className={s.camBar}>
          <span>VIDEO</span>
          <span className={s.mode}>PHOTO</span>
          <span>PORTRAIT</span>
          <i className={s.shutter} />
        </div>
      </Scr>

      {/* 2. The enroll page (enroll/[slug]/EnrollForm) */}
      <Scr id="join" className={s.web}>
        <div className={s.webBrand}>
          <span className={s.dot} /> {cafe.name} <small>JOIN</small>
        </div>
        <div className={s.form}>
          <div className={s.formLabel}>Get your loyalty card in Apple Wallet</div>
          <span className={s.formLabel}>Name</span>
          <div className={s.input}>
            <span className={s.typeName}>Sam Rivera</span>
          </div>
          <span className={s.formLabel}>Phone</span>
          <div className={s.input}>
            <span className={s.typePhone}>(555) 010-4477</span>
          </div>
          <div className={s.getCard}>
            <span className={s.getIdle}>Get my card</span>
            <span className={s.getBusy}>Creating your card…</span>
          </div>
        </div>
        <div className={s.safari}>
          <span>aA</span>
          <span className={s.address}>enroll/fern-fox</span>
          <span className={s.reload} />
        </div>
      </Scr>

      {/* 3. The iOS add-pass sheet */}
      <Scr id="add" className={s.addBg}>
        <i className={s.behind} />
        <div className={s.sheet}>
          <div className={s.sheetBar}>
            <span>Cancel</span>
            <b className={s.addTap}>Add</b>
          </div>
          <WalletCard name={cafe.name} colors={cafe.colors} points={0} updated={updated} qr={qr} />
        </div>
      </Scr>

      {/* 4. Into the Wallet stack */}
      <Scr id="wallet" className={s.wallet}>
        <div className={s.walletHead}>
          <b>Wallet</b>
          <i className={s.plus} />
        </div>
        <div className={s.peeks}>
          <div className={s.peek} style={{ background: "#2c6e8f" }}>
            <span>BOARDING PASS</span>
          </div>
          <div className={s.peek} style={{ background: "#5b5e66" }}>
            <span>MEMBERSHIP</span>
          </div>
        </div>
        <div className={s.dropIn}>{card}</div>
      </Scr>

      {/* 5. The staff terminal (/scan): read the card, type the bill, Add */}
      <Scr id="counter" className={s.term}>
        <div className={s.termBrand}>
          <span className={s.dot} /> 42nights <small>TERMINAL</small>
        </div>
        <div className={s.finder}>
          <div className={s.held}>
            <Code qr={qr} />
          </div>
          <i className={s.sweep} />
          <i className={s.locked} />
        </div>
        <div className={s.formLabel}>Sam Rivera</div>
        <div className={s.bal}>
          <span className={s.was}>0</span>
          <span className={s.now}>120</span>
        </div>
        <div className={s.formLabel}>points</div>
        <div className={s.billRow}>
          <span className={s.bill}>
            <span className={s.typeBill}>12.00</span>
          </span>
          <span className={s.addKey}>Add</span>
        </div>
        <div className={s.toast}>+120 pts</div>
      </Scr>

      {/* 6. Back on the lock screen: the pass updated */}
      <Scr id="notify">
        <div className={s.drop}>
          <LockBanner name={cafe.name} colors={cafe.colors} points={120} shown />
        </div>
        <div className={`${s.lockPad} ${s.cards}`}>
          {card}
          <div className={s.newer}>
            <WalletCard name={cafe.name} colors={cafe.colors} points={120} updated={updated} qr={qr} />
          </div>
        </div>
      </Scr>
    </>
  );
}

// ---- rewards: Wallet pages from a points card to a stamp card, a stamp lands (8 -> 9) ----
export function RewardsScreen({ story }: { story: Story }) {
  const { cafe, diner, qr, updated } = story;
  return (
    <Scr id="rewards" rest className={s.rewards}>
      <div className={s.track}>
        <div className={s.page}>
          <WalletCard name={diner.name} colors={diner.colors} points={diner.startPoints} updated={updated} qr={qr} />
        </div>
        <div className={s.page}>
          <Press m={cafe} qr={qr} n={9} />
        </div>
      </div>
      <div className={s.dots}>
        <i />
        <i />
      </div>
    </Scr>
  );
}

// ---- owners: the dashboard, then the at-risk list and a campaign ----
export function OwnerScreen({ story }: { story: Story }) {
  const { cafe } = story;
  const k = cafe.kpis;
  const max = Math.max(...cafe.issued14);
  const line = (d: number[]) => d.map((v, i) => `${(i * 100) / (d.length - 1)},${40 - (v / max) * 36}`).join(" ");
  return (
    <Scr id="owner" rest className={s.owner}>
      <div className={s.ownerHead}>
        <small>{cafe.name}</small>
        <b>Dashboard</b>
      </div>
      <div className={s.scroller}>
        <div className={s.kpis}>
          <div className="panel">
            <span className="panel-t">Members</span>
            <b>{k.members}</b>
          </div>
          <div className="panel">
            <span className="panel-t">Active</span>
            <b>{k.active}</b>
          </div>
          <div className="panel">
            <span className="panel-t">Repeat</span>
            <b>{Math.round(k.repeat * 100)}%</b>
          </div>
        </div>
        <div className="panel">
          <span className="panel-t">Points flow</span>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={s.flow} aria-hidden="true">
            <polyline points={line(cafe.issued14)} stroke="var(--c-issued)" />
            <polyline points={line(cafe.redeemed14)} stroke="var(--c-redeemed)" />
          </svg>
        </div>
        <div className={`panel ${s.risk}`}>
          <span className="panel-t">At-risk regulars</span>
          {cafe.atRisk.map((c) => (
            <div className={s.row} key={c.name}>
              <span>{c.name}</span>
              <small>
                {c.visits} visits · {c.days}d
              </small>
            </div>
          ))}
          <div className={s.give}>Give bonus points</div>
          <div className={s.sent}>Sent to {cafe.atRisk.length} customers.</div>
        </div>
      </div>
    </Scr>
  );
}

// ---- why + FAQ: the card that stays (the paper one falls away, Story.tsx) ----
export function WhyScreen({ story }: { story: Story }) {
  return (
    <Scr id="why" rest>
      <div className={s.lockPad}>
        {stampCard(story.cafe, story.qr, 9)}
      </div>
    </Scr>
  );
}

// ---- closing: the 10th stamp lands and the reward is ready ----
export function ReadyScreen({ story }: { story: Story }) {
  return (
    <Scr id="ready" rest>
      <div className={s.drop}>
        <LockBanner name={story.cafe.name} colors={story.cafe.colors} points={10} goal={10} shown />
      </div>
      <div className={s.lockPad}>
        <Press m={story.cafe} qr={story.qr} n={10} shine />
      </div>
    </Scr>
  );
}

// The paper card the Wallet card replaces: same look as the hero's.
export function Paper({ name, className }: { name: string; className: string }) {
  return (
    <div className={`${s.paper} ${className}`} aria-hidden="true">
      <b>{name}</b>
      <span>Buy 9 coffees, the 10th is on us</span>
      <div>
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < 7 ? s.inked : undefined} />
        ))}
      </div>
    </div>
  );
}
