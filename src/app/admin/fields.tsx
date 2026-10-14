"use client";
import { REDEEM_TEMPLATES, type TemplateKey } from "@/lib/config";
import { hexToRgb } from "@/lib/admin/merchant";
import s from "./admin.module.css";

// Form pieces shared by the onboarding wizard and the merchant editor.
// Colours are kept as "#rrggbb" while editing (what <input type="color">
// speaks) and converted with hexToRgb() when sent to the API.

export type Colors = { bg: string; fg: string; label: string };

const TEMPLATE_KEYS = Object.keys(REDEEM_TEMPLATES) as TemplateKey[];

export function TemplatePicker({ value, onChange }: { value: TemplateKey; onChange: (t: TemplateKey) => void }) {
  return (
    <div className={s.templates}>
      {TEMPLATE_KEYS.map((key) => {
        const t = REDEEM_TEMPLATES[key];
        return (
          <button type="button" key={key} className={s.tpl} aria-pressed={value === key} onClick={() => onChange(key)}>
            <div className={s.tplName}>
              {t.label}
              {value === key && <span aria-hidden>✓</span>}
            </div>
            {t.actions.map((a) => (
              <div className={s.tplRow} key={a.id}>
                <span>{a.label}</span>
                <span>{-a.points} pts</span>
              </div>
            ))}
          </button>
        );
      })}
    </div>
  );
}

// "A $20 bill earns 200 pts; first reward after ~$8" — makes the earn rate
// concrete against the chosen template's cheapest reward.
export function EarnHint({ rate, template }: { rate: number; template: TemplateKey }) {
  if (!Number.isFinite(rate) || rate <= 0) return <span className={`${s.hint} ${s.bad}`}>Enter a number above 0</span>;
  const cheapest = REDEEM_TEMPLATES[template].actions.reduce((a, b) => (-b.points < -a.points ? b : a));
  return (
    <span className={s.hint}>
      A $20 bill earns {Math.round(20 * rate).toLocaleString("en-US")} pts. First reward ({cheapest.label},{" "}
      {-cheapest.points} pts) after about ${Math.ceil(-cheapest.points / rate).toLocaleString("en-US")} spent.
    </span>
  );
}

const COLOR_FIELDS = [
  ["bg", "Background"],
  ["fg", "Text"],
  ["label", "Labels"],
] as const;

export function ColorFields({ value, onChange }: { value: Colors; onChange: (c: Colors) => void }) {
  return (
    <div className={s.colors}>
      {COLOR_FIELDS.map(([key, name]) => (
        <label key={key} className={s.color}>
          <span className="label">{name}</span>
          <input type="color" value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
          <span className={s.hex}>{hexToRgb(value[key])}</span>
        </label>
      ))}
    </div>
  );
}

// Deterministic fake QR (same markup on server and client, no hydration diff).
function QrMark() {
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" fill="#000" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill="#000" />
    </g>
  );
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
  const cells: JSX.Element[] = [];
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 21; x++)
      if (!inFinder(x, y) && (x * 7 + y * 13 + x * y) % 5 < 2) cells.push(<rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill="#000" />);
  return (
    <svg viewBox="0 0 21 21" width="88" height="88" shapeRendering="crispEdges" aria-hidden>
      {finder(0, 0)}
      {finder(14, 0)}
      {finder(0, 14)}
      {cells}
    </svg>
  );
}

// HTML approximation of the storeCard buildApplePass() produces: logo + name,
// POINTS over the strip, UPDATED field, QR. Wallet renders the real thing.
export function WalletPreview({ name, colors, logo, strip }: { name: string; colors: Colors; logo?: string; strip?: string }) {
  const title = name.trim() || "Your business";
  return (
    <div className={s.pass} style={{ background: colors.bg, color: colors.fg }} aria-label="Wallet card preview">
      <div className={s.passTop}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not a static asset
          <img src={logo} alt="" className={s.passLogo} />
        ) : (
          <span className={s.passMark} style={{ background: colors.fg, color: colors.bg }}>{title[0].toUpperCase()}</span>
        )}
        <span className={s.passOrg}>{title}</span>
      </div>
      <div
        className={`${s.passStrip} ${strip ? "" : s.passStripEmpty}`}
        style={strip ? { backgroundImage: `url("${strip}")` } : undefined}
      >
        <div>
          <div className={s.passLabel} style={{ color: colors.label }}>Points</div>
          <div className={s.passBig}>0</div>
        </div>
      </div>
      <div className={s.passFields}>
        <div>
          <div className={s.passLabel} style={{ color: colors.label }}>Updated</div>
          <div className={s.passValue} suppressHydrationWarning>{new Date().toLocaleDateString("en-GB")}</div>
        </div>
      </div>
      <div className={s.passQr}>
        <QrMark />
      </div>
    </div>
  );
}
