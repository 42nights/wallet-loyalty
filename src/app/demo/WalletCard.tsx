import type { CSSProperties, ReactNode } from "react";
import type { QR } from "./samples";
import s from "./WalletCard.module.css";

// Pure, hook-free illustration of the real pass, shared by the landing hero and
// /demo. It mirrors what src/lib/wallet/apple/pass.ts puts on a storeCard today:
// logo + shop name (logoText), POINTS as the big primary field over the strip,
// UPDATED as the secondary field, and a QR that encodes the serial. Do not add
// fields the real pass does not have — this is what owners are sold.

type Colors = { bg: string; fg: string; label: string };

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
}: {
  name: string;
  colors: Colors;
  points: number;
  updated: string;
  qr: QR;
  flash?: boolean;
}) {
  const vars = { "--pb": colors.bg, "--pf": colors.fg, "--pl": colors.label } as CSSProperties;
  return (
    <div className={s.card} style={vars} role="img" aria-label={`${name} loyalty card in Apple Wallet: ${points} points`}>
      <div className={s.top}>
        <span className={s.logo}>{initials(name)}</span>
        <span className={s.logoText}>{name}</span>
      </div>
      <div className={s.strip}>
        <div className={s.fieldLabel}>POINTS</div>
        <div className={`${s.points} ${flash ? s.flash : ""}`}>{points}</div>
      </div>
      <div className={s.secondary}>
        <div className={s.fieldLabel}>UPDATED</div>
        <div className={s.fieldValue}>{updated}</div>
      </div>
      <div className={s.barcode}>
        <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} shapeRendering="crispEdges" aria-hidden="true">
          <path d={qr.d} fill="#000" />
        </svg>
      </div>
    </div>
  );
}

// Lock-screen style notification. Wallet shows one when a pass field that has a
// changeMessage changes; the copy mirrors "You now have %@ points". Decorative
// (aria-hidden): on /demo the counter's status toast announces the change.
// `dock` pins it to the top of the viewport instead of the phone screen.
export function LockBanner({
  name,
  colors,
  points,
  shown,
  dock = false,
}: {
  name: string;
  colors: Colors;
  points: number;
  shown: boolean;
  dock?: boolean;
}) {
  return (
    <div className={`${s.banner} ${shown ? s.bannerIn : ""} ${dock ? s.dock : ""}`} aria-hidden="true">
      <span className={s.bannerIcon} style={{ background: colors.bg, color: colors.fg }} aria-hidden="true">
        {initials(name)}
      </span>
      <span className={s.bannerText}>
        <span className={s.bannerHead}>
          <b>{name}</b>
          <span>now</span>
        </span>
        <span>You now have {points} points</span>
      </span>
    </div>
  );
}
