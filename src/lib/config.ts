// ---------------------------------------------------------------------------
// Loyalty rules. Edit these freely — the UI + backend read from here.
// `points` is the DELTA applied to the customer's balance.
// Negative = redeem (deduct). Positive = earn.
// ---------------------------------------------------------------------------

export type Action = {
  id: string;
  label: string;
  points: number; // delta applied to balance
  kind: "redeem" | "earn";
};

// Redeem buttons come from a per-merchant template (merchants.redeem_template).
// Each template is exactly 4 buttons (the /scan grid). `restaurant` is the
// original set and the default, so merchants created before templates existed
// keep identical buttons. Action ids are unique ACROSS templates: the ledger
// stores `redeem:<id>` and history views resolve labels from any template.
export type TemplateKey = "restaurant" | "cafe" | "retail";

export const REDEEM_TEMPLATES: Record<TemplateKey, { label: string; actions: Action[] }> = {
  restaurant: {
    label: "Restaurant",
    actions: [
      { id: "drinks", label: "Drinks", points: -500, kind: "redeem" },
      { id: "extra_side", label: "Extra Side", points: -1000, kind: "redeem" },
      { id: "fortune_cookie", label: "Fortune Cookie", points: -100, kind: "redeem" },
      { id: "extra_sauce", label: "Extra Sauce", points: -100, kind: "redeem" },
    ],
  },
  cafe: {
    label: "Café",
    actions: [
      { id: "free_coffee", label: "Free Coffee", points: -300, kind: "redeem" },
      { id: "free_pastry", label: "Free Pastry", points: -250, kind: "redeem" },
      { id: "size_upgrade", label: "Size Upgrade", points: -100, kind: "redeem" },
      { id: "extra_shot", label: "Extra Shot", points: -80, kind: "redeem" },
    ],
  },
  retail: {
    label: "Business / Retail",
    actions: [
      { id: "off_5", label: "$5 Off", points: -500, kind: "redeem" },
      { id: "off_10", label: "$10 Off", points: -1000, kind: "redeem" },
      { id: "free_gift", label: "Free Gift", points: -750, kind: "redeem" },
      { id: "priority_service", label: "Priority Service", points: -300, kind: "redeem" },
    ],
  },
};

export const DEFAULT_TEMPLATE: TemplateKey = "restaurant";

// Any stored/posted value → a known template (unknown, null, or a missing
// column on an un-migrated database all fall back to the default).
export function templateKey(value: unknown): TemplateKey {
  return typeof value === "string" && Object.hasOwn(REDEEM_TEMPLATES, value)
    ? (value as TemplateKey)
    : DEFAULT_TEMPLATE;
}

export function redemptionsFor(template: unknown): Action[] {
  return REDEEM_TEMPLATES[templateKey(template)].actions;
}

// Back-compat: the default template's buttons.
export const REDEMPTIONS: Action[] = REDEEM_TEMPLATES[DEFAULT_TEMPLATE].actions;

// On a points card, earning is points-per-dollar with a per-merchant `earn_rate` (merchants
// table). The /scan bill-amount input applies round(earn_rate * amount)
// server-side (see /api/merchant/redeem). There are no fixed earn presets.
//
// The one allowed range for earn_rate, for owner Settings and the creator admin
// alike (the routes enforce it, the forms mirror it). The redeem route caps one
// earn at 1,000,000 points, so at rate r any bill above 1,000,000 / r is refused
// at the counter; 100 keeps bills up to 10,000 working.
export const EARN_RATE = { min: 0.1, max: 100 } as const;

// ---------------------------------------------------------------------------
// Stamp cards. A merchant runs either points (above) or a stamp card
// (merchants.loyalty_mode). The ledger is the same: a stamp is one unit in
// transactions/apply_points, earned +1..+STAMP_EARN_MAX per tap (reason
// "earn:stamp", no bill) and spent stamp_goal at a time on the one reward
// (reason "redeem:stamp_reward"). Readers below take the raw column value, so a
// missing column (un-migrated database) reads as the schema default.
// ---------------------------------------------------------------------------
export type LoyaltyMode = "points" | "stamps";
export const STAMP_GOAL = { min: 3, max: 20, default: 10 } as const;
export const STAMP_REWARD_MAX = 30; // characters, = the schema check
export const STAMP_EARN_MAX = 3; // stamps one tap may add (several items at once)
export const STAMP_REWARD_ID = "stamp_reward";

export function loyaltyMode(value: unknown): LoyaltyMode {
  return value === "stamps" ? "stamps" : "points";
}

export function stampGoal(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= STAMP_GOAL.min && n <= STAMP_GOAL.max ? n : STAMP_GOAL.default;
}

export function stampReward(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "Free coffee";
}

type MerchantRules = {
  loyalty_mode?: unknown;
  stamp_goal?: unknown;
  stamp_reward?: unknown;
  redeem_template?: unknown;
};

// The redeem buttons a merchant's /scan shows and /api/merchant/redeem accepts:
// the one stamp reward on a stamp card, else the merchant's template.
export function merchantRedemptions(m: MerchantRules): Action[] {
  if (loyaltyMode(m.loyalty_mode) === "stamps")
    return [{ id: STAMP_REWARD_ID, label: stampReward(m.stamp_reward), points: -stampGoal(m.stamp_goal), kind: "redeem" }];
  return redemptionsFor(m.redeem_template);
}

// What a balance is counted in, for copy: "pts"/"points", or "stamp"/"stamps".
export function unitLabel(mode: unknown, n: number, short = false): string {
  if (loyaltyMode(mode) === "stamps") return n === 1 ? "stamp" : "stamps";
  return short ? "pts" : "points";
}

export const ALL_ACTIONS: Action[] = Object.values(REDEEM_TEMPLATES).flatMap((t) => t.actions);

// Label lookup for history views. To validate a redeem, use redemptionsFor()
// with the merchant's template instead — this matches ids from any template.
export function findAction(id: string): Action | undefined {
  return ALL_ACTIONS.find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Earn boosters: the birthday treat and happy hour, and the shop clock both
// run on. Merchant values come from select("*") rows, so every reader below
// takes `unknown` and falls back to "off" / the default zone when a column is
// missing (un-migrated database) or holds something unexpected.
// ---------------------------------------------------------------------------

// merchants.timezone. The server runs on UTC (Vercel), so "today" and "3 pm"
// must be read on the shop's own clock. /admin offers these US zones; the API
// stores any name Intl accepts.
export const DEFAULT_TIMEZONE = "America/Los_Angeles";
export const US_TIMEZONES = [
  { id: "America/New_York", label: "Eastern (New York)" },
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Phoenix", label: "Arizona (Phoenix)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska (Anchorage)" },
  { id: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
] as const;

// A zone name Intl accepts → its canonical spelling ("america/chicago" →
// "America/Chicago"), else null. Validating with Intl means a stored zone can
// never make the clock code below throw.
export function canonicalTimezone(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function timezoneOf(value: unknown): string {
  return canonicalTimezone(value) ?? DEFAULT_TIMEZONE;
}

export function timezoneLabel(tz: string): string {
  return US_TIMEZONES.find((t) => t.id === tz)?.label ?? tz;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// `now` read on a wall clock: calendar date, weekday (0 = Sunday) and minutes
// since local midnight. DST is Intl's job.
export function localTime(tz: string, now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
      weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
    }).formatToParts(now).map((x) => [x.type, x.value])
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

// Birthdays are month + day only: passes.birthday stores them on the
// placeholder year 2000, a leap year, so Feb 29 is a real date.
// The stored values whose birthday falls on this calendar day. Feb 29
// birthdays are celebrated on Feb 28 in years without a Feb 29.
export function birthdaysOn(t: { year: number; month: number; day: number }): string[] {
  const md = `${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  const leap = new Date(Date.UTC(t.year, 1, 29)).getUTCMonth() === 1;
  return md === "02-28" && !leap ? ["2000-02-28", "2000-02-29"] : [`2000-${md}`];
}

// The birthday treat, in points: what the merchant's cheapest reward costs,
// i.e. one free treat whatever template they run. The ONE place the bonus is
// decided (the cron credits it, Settings and the card show it).
export function birthdayBonus(merchant: { redeem_template?: unknown }): number {
  return Math.min(...redemptionsFor(merchant.redeem_template).map((a) => -a.points));
}

// merchants.happy_hour: one weekly window, [start, end) on the shop clock and
// within one day (no overnight windows). Bill earns inside it are multiplied.
export type HappyHour = { days: number[]; start: string; end: string; multiplier: 2 | 3 };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Strict check of a posted window, for the settings route: null = off, a
// HappyHour to store, or a message for the owner. Unknown keys are refused.
export function parseHappyHour(v: unknown): HappyHour | null | string {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return "Happy hour must be a window or null";
  const { days, start, end, multiplier, ...rest } = v as Record<string, unknown>;
  if (Object.keys(rest).length) return `Unknown happy hour field: ${Object.keys(rest)[0]}`;
  if (
    !Array.isArray(days) || days.length === 0 || new Set(days).size !== days.length ||
    !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  )
    return "Pick at least one day";
  if (typeof start !== "string" || typeof end !== "string" || !HHMM.test(start) || !HHMM.test(end))
    return "Times must look like 15:00";
  if (start >= end) return "Happy hour must end after it starts, on the same day";
  if (multiplier !== 2 && multiplier !== 3) return "Pick 2× or 3×";
  return { days: [...days].sort((a, b) => a - b), start, end, multiplier };
}

// A stored value → the window, or null (off, missing column, or malformed).
export function happyHourOf(stored: unknown): HappyHour | null {
  const h = parseHappyHour(stored ?? null);
  return typeof h === "string" ? null : h;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// The earn multiplier in force at `now` for this merchant: 1 outside the window.
export function happyHourMultiplier(
  merchant: { happy_hour?: unknown; timezone?: unknown },
  now = new Date()
): number {
  const h = happyHourOf(merchant.happy_hour);
  if (!h) return 1;
  const t = localTime(timezoneOf(merchant.timezone), now);
  return h.days.includes(t.weekday) && t.minutes >= minutesOf(h.start) && t.minutes < minutesOf(h.end)
    ? h.multiplier
    : 1;
}

// "2× points Mon–Fri 3–5 pm": the window as the card back and Settings show it.
// Days run Monday first; 3+ consecutive days collapse to a range.
export function describeHappyHour(h: HappyHour): string {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => h.days.includes(d));
  const runs: number[][] = [];
  for (const d of order) {
    const last = runs[runs.length - 1];
    if (last && (last[last.length - 1] + 1) % 7 === d) last.push(d);
    else runs.push([d]);
  }
  const days =
    order.length === 7
      ? "every day"
      : runs
          .map((r) => (r.length >= 3 ? `${WEEKDAYS[r[0]]}–${WEEKDAYS[r[r.length - 1]]}` : r.map((d) => WEEKDAYS[d]).join(", ")))
          .join(", ");
  const clock = (hhmm: string) => {
    const m = minutesOf(hhmm);
    const h12 = Math.floor(m / 60) % 12 || 12;
    return { text: m % 60 ? `${h12}:${String(m % 60).padStart(2, "0")}` : String(h12), pm: m >= 720 };
  };
  const a = clock(h.start);
  const b = clock(h.end);
  const time =
    a.pm === b.pm
      ? `${a.text}–${b.text} ${b.pm ? "pm" : "am"}`
      : `${a.text} ${a.pm ? "pm" : "am"}–${b.text} ${b.pm ? "pm" : "am"}`;
  return `${h.multiplier}× points ${days} ${time}`;
}

// Pass appearance / identifiers (also overridable via env)
export const PASS_TYPE_ID =
  process.env.PASS_TYPE_ID || "pass.com.42nights.loyalty";
export const TEAM_ID = process.env.APPLE_TEAM_ID || "REPLACE_TEAM_ID";
export const ORG_NAME = process.env.PASS_ORG_NAME || "42nights";
// Public base URL of THIS app, e.g. https://loyalty.42nights.dev
export const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "http://localhost:3000";

// "Book a call" on / and /demo opens Ayaan's booking page (a Cal.com link).
// https only, because it is rendered as a link. Unset → both pages send
// prospects to the demo's contact note instead; src/instrumentation.ts warns
// about that in production.
const booking = process.env.SALES_BOOKING_URL?.trim() ?? "";
export const BOOKING_URL = booking.startsWith("https://") ? booking : null;

// Fail loudly on a misconfigured production deploy instead of handing out
// cards that cannot work (apple-wallet#2). Wallet only calls an https
// webServiceURL, and the URL is baked into each card, so a card issued with an
// http base URL can never update. A placeholder teamIdentifier cannot match
// the signing certificate, so Wallet is expected to refuse the pass outright.
// Called by the pass builder, and by enrollment BEFORE it creates a row, so a
// broken deploy doesn't use up customers' phone numbers on dead cards.
export function assertPassConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!PUBLIC_BASE_URL.startsWith("https://"))
    throw new Error(
      `PUBLIC_BASE_URL must be an https:// URL in production (got "${PUBLIC_BASE_URL}"). ` +
        "It is baked into every card as webServiceURL; Wallet cannot update a card over http."
    );
  if (TEAM_ID === "REPLACE_TEAM_ID")
    throw new Error(
      "APPLE_TEAM_ID is not set. It must be the Team ID that owns the Pass Type ID, or Wallet rejects the card."
    );
}
