"use client";
import {
  EARN_RATE, REDEEM_TEMPLATES, STAMP_GOAL, STAMP_REWARD_MAX, US_TIMEZONES, type LoyaltyMode, type TemplateKey,
} from "@/lib/config";
import { hexToRgb } from "@/lib/admin/merchant";
import { formatMoney } from "@/lib/format";
import s from "./admin.module.css";

// Form pieces shared by the onboarding wizard and the merchant editor.
// Colours are kept as "#rrggbb" while editing (what <input type="color">
// speaks) and converted with hexToRgb() when sent to the API.

export type Colors = { bg: string; fg: string; label: string };

const TEMPLATE_KEYS = Object.keys(REDEEM_TEMPLATES) as TemplateKey[];

// `rewards={false}` (a stamp card): the template only picks the card's colours
// and default art, so its point-cost buttons are left out.
export function TemplatePicker({ value, onChange, rewards = true }: { value: TemplateKey; onChange: (t: TemplateKey) => void; rewards?: boolean }) {
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
            {rewards && t.actions.map((a) => (
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

// "A $20.00 bill earns 200 pts; first reward after ~$8.00" — makes the earn rate
// concrete against the chosen template's cheapest reward.
export function EarnHint({ rate, template }: { rate: number; template: TemplateKey }) {
  if (!(rate >= EARN_RATE.min && rate <= EARN_RATE.max))
    return <span className={`${s.hint} ${s.bad}`}>Enter a rate between {EARN_RATE.min} and {EARN_RATE.max}</span>;
  const cheapest = REDEEM_TEMPLATES[template].actions.reduce((a, b) => (-b.points < -a.points ? b : a));
  return (
    <span className={s.hint}>
      A {formatMoney(20)} bill earns {Math.round(20 * rate).toLocaleString("en-US")} pts. First reward ({cheapest.label},{" "}
      {-cheapest.points} pts) after about {formatMoney(Math.ceil(-cheapest.points / rate))} spent.
    </span>
  );
}

// Points or a stamp card, and the stamp card's goal and reward, as edited
// (goal kept as typed). `locked` is the reason the mode and goal can't change
// any more; the reward stays editable.
export type Loyalty = { mode: LoyaltyMode; goal: string; reward: string };

const MODES: [LoyaltyMode, string, string][] = [
  ["points", "Points", "Points on every dollar, spent on 4 rewards"],
  ["stamps", "Stamp card", "Staff tap +1 stamp, no bill; a full card earns the reward"],
];

export function LoyaltyFields({ value, onChange, locked }: { value: Loyalty; onChange: (v: Loyalty) => void; locked?: string }) {
  const goal = Number(value.goal);
  const goalOk = Number.isInteger(goal) && goal >= STAMP_GOAL.min && goal <= STAMP_GOAL.max;
  return (
    <>
      <div className={s.two}>
        {MODES.map(([key, name, sub]) => (
          <button type="button" key={key} className={s.tpl} aria-pressed={value.mode === key} disabled={!!locked}
            onClick={() => onChange({ ...value, mode: key })}>
            <div className={s.tplName}>
              {name}
              {value.mode === key && <span aria-hidden>✓</span>}
            </div>
            <div className={s.hint}>{sub}</div>
          </button>
        ))}
      </div>
      {value.mode === "stamps" && (
        <div className={s.two}>
          <label className={s.field}>
            <span className="label">Stamps for the reward</span>
            <input type="number" inputMode="numeric" min={STAMP_GOAL.min} max={STAMP_GOAL.max} step={1} value={value.goal}
              disabled={!!locked} onChange={(e) => onChange({ ...value, goal: e.target.value })} required />
          </label>
          <label className={s.field}>
            <span className="label">Reward</span>
            <input value={value.reward} maxLength={STAMP_REWARD_MAX} placeholder="Free coffee"
              onChange={(e) => onChange({ ...value, reward: e.target.value })} required />
          </label>
        </div>
      )}
      {value.mode === "stamps" && (
        <span className={`${s.hint} ${goalOk ? "" : s.bad}`}>
          {goalOk
            ? `Customers collect ${goal} stamps, then "${value.reward.trim() || "the reward"}" is theirs and the card starts again.`
            : `Pick ${STAMP_GOAL.min} to ${STAMP_GOAL.max} stamps`}
        </span>
      )}
      {locked && <span className={s.hint}>{locked}</span>}
    </>
  );
}

// The shop's clock (merchants.timezone). A stored zone outside the US list
// (set through the API) is shown as-is rather than silently replaced.
export function TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  return (
    <label className={s.field}>
      <span className="label">Time zone</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!US_TIMEZONES.some((t) => t.id === value) && <option value={value}>{value}</option>}
        {US_TIMEZONES.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <span className={s.hint}>The shop&apos;s clock: happy hour and birthday treats follow it.</span>
    </label>
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
// POINTS over the strip (STAMPS "0 of N" for a stamp card, whose real strip is
// drawn per card), UPDATED field, QR. Wallet renders the real thing.
export function WalletPreview({ name, colors, logo, strip, stampGoal }: { name: string; colors: Colors; logo?: string; strip?: string; stampGoal?: number }) {
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
        className={`${s.passStrip} ${strip && !stampGoal ? "" : s.passStripEmpty}`}
        style={strip && !stampGoal ? { backgroundImage: `url("${strip}")` } : undefined}
      >
        <div>
          <div className={s.passLabel} style={{ color: colors.label }}>{stampGoal ? "Stamps" : "Points"}</div>
          <div className={s.passBig}>{stampGoal ? `0 of ${stampGoal}` : 0}</div>
        </div>
      </div>
      <div className={s.passFields}>
        <div>
          <div className={s.passLabel} style={{ color: colors.label }}>Updated</div>
          <div className={s.passValue} suppressHydrationWarning>
            {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          </div>
        </div>
      </div>
      <div className={s.passQr}>
        <QrMark />
      </div>
    </div>
  );
}
