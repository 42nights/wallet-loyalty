import type { CSSProperties, ReactNode } from "react";
import type { QR } from "./samples";
import s from "./WalletCard.module.css";

// Pure, hook-free illustration of the real pass, shared by the landing hero and
// /demo. It mirrors what src/lib/wallet/apple/pass.ts puts on a storeCard today:
// logo + shop name (logoText), POINTS as the big primary field over the strip,
// UPDATED as the secondary field, and a QR that encodes the serial. A stamp card
// (`stamps`) follows the stamp pass instead: the stamp grid as the strip, REWARD
// as the secondary field. Like the points card, it leaves out the header field
// (STAMPS "3 of 10"): the grid already shows it, and the shop name needs the
// room. Do not add fields the real pass does not have — this is what owners are sold.

export type Colors = { bg: string; fg: string; label: string };
// An uploaded logo and its @1x width in points (what Wallet lays it out at).
export type Logo = { src: string; w: number };
// One stamp slot on the 375x144pt strip, from stampLayout() in stampStrip.ts.
export type Slot = { x: number; y: number; d: number };
// A stamp card: `points` is the stamp count; `from` is the count before the
// latest tap, so the stamps from that index up were just added and land in.
export type Stamps = { reward: string; slots: Slot[]; from: number };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

export function Phone({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  return (
    <div className={s.phone}>
      <div className={s.screen}>
        <div className={s.status} aria-hidden="true">
          <span>9:41</span>
          <span className={s.island} />
          <span className={s.bars} />
        </div>
        {banner}
        {children}
      </div>
    </div>
  );
}

export function WalletCard({
  name,
  colors,
  points,
  updated,
  qr,
  flash = false,
  logo,
  stamps,
}: {
  name: string;
  colors: Colors;
  points: number;
  updated?: string;
  qr: QR;
  flash?: boolean;
  logo?: Logo;
  stamps?: Stamps;
}) {
  const vars = { "--pb": colors.bg, "--pf": colors.fg, "--pl": colors.label } as CSSProperties;
  const goal = stamps?.slots.length ?? 0;
  return (
    <div
      className={s.card}
      style={vars}
      role="img"
      aria-label={`${name} loyalty card in Apple Wallet: ${stamps ? `${points} of ${goal} stamps` : `${points} points`}`}
    >
      <div className={s.top}>
        {logo ? (
          <img className={s.logoImg} src={logo.src} alt="" style={{ "--lw": logo.w } as CSSProperties} />
        ) : (
          <span className={s.logo}>{initials(name)}</span>
        )}
        <span className={s.logoText}>{name}</span>
      </div>
      {stamps ? (
        <>
          <StampStrip have={points} {...stamps} />
          <div className={s.secondary}>
            <div className={s.fieldLabel}>REWARD</div>
            <div className={s.fieldValue}>{points >= goal ? `Ready: ${stamps.reward}` : `${stamps.reward} at ${goal}`}</div>
          </div>
        </>
      ) : (
        <>
          <div className={s.strip}>
            <div className={s.fieldLabel}>POINTS</div>
            <div className={`${s.points} ${flash ? s.flash : ""}`}>{points}</div>
          </div>
          <div className={s.secondary}>
            <div className={s.fieldLabel}>UPDATED</div>
            <div className={s.fieldValue}>{updated}</div>
          </div>
        </>
      )}
      <div className={s.barcode}>
        <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} shapeRendering="crispEdges" aria-hidden="true">
          <path d={qr.d} fill="#000" />
        </svg>
      </div>
    </div>
  );
}

// The stamp card strip, drawn like stampStrip.ts draws the real one: a disc in
// the label colour with a check cut out per stamp, a faint ring per empty slot,
// and the last slot (the reward) ringed in the label colour.
function StampStrip({ have, slots, from }: { have: number } & Stamps) {
  const n = Math.max(0, Math.min(slots.length, have));
  return (
    <svg className={s.stamps} viewBox="0 0 375 144" aria-hidden="true">
      {slots.map(({ x, y, d }, i) => {
        if (i >= n) {
          const w = Math.max(1.5, d * 0.07);
          return (
            <circle key={`e${i}`} className={i === slots.length - 1 ? s.goalRing : s.ring}
              cx={x} cy={y} r={d / 2 - w / 2} strokeWidth={w} />
          );
        }
        const pop = i >= from;
        return (
          <g key={`f${i}`} className={pop ? s.stampIn : undefined} style={pop ? { animationDelay: `${(i - from) * 70}ms` } : undefined}>
            <circle className={s.disc} cx={x} cy={y} r={d / 2} />
            <path className={s.tick} strokeWidth={d * 0.085}
              d={`M${x - 0.26 * d} ${y + 0.02 * d}L${x - 0.08 * d} ${y + 0.2 * d}L${x + 0.28 * d} ${y - 0.18 * d}`} />
          </g>
        );
      })}
    </svg>
  );
}

// Lock-screen style notification. Wallet shows one when a pass field that has a
// changeMessage changes; the copy mirrors "You now have %@ points", or on a
// stamp card (`goal` set) "Stamps: %@" with the pass header's "3 of 10". Decorative
// (aria-hidden): on /demo the counter's status toast announces the change.
// `dock` pins it to the top of the viewport instead of the phone screen.
export function LockBanner({
  name,
  colors,
  points,
  shown,
  dock = false,
  icon,
  goal,
}: {
  name: string;
  colors: Colors;
  points: number;
  shown: boolean;
  dock?: boolean;
  icon?: string;
  goal?: number;
}) {
  return (
    <div className={`${s.banner} ${shown ? s.bannerIn : ""} ${dock ? s.dock : ""}`} aria-hidden="true">
      {icon ? (
        <img className={s.bannerIcon} src={icon} alt="" />
      ) : (
        <span className={s.bannerIcon} style={{ background: colors.bg, color: colors.fg }} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      <span className={s.bannerText}>
        <span className={s.bannerHead}>
          <b>{name}</b>
          <span>now</span>
        </span>
        {goal ? <span>Stamps: {points} of {goal}</span> : <span>You now have {points} points</span>}
      </span>
    </div>
  );
}
