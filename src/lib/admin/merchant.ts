import { EARN_RATE, REDEEM_TEMPLATES, STAMP_GOAL, STAMP_REWARD_MAX, canonicalTimezone, type LoyaltyMode, type TemplateKey } from "@/lib/config";
import { PASS_THEMES } from "@/lib/passThemes";

// Merchant/staff input rules for the creator admin. No server-only imports:
// the wizard uses the same helpers client-side for live feedback, and the API
// re-validates everything (the client copy is only a convenience).

// Public enroll path segment: /enroll/<slug>. Lowercase, digits, inner dashes.
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
// staff.username is globally unique and matched exactly at /login, so keep it
// to one unambiguous lowercase form.
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const MIN_PASSWORD = 8;
// Route ids are checked before they reach Postgres (a malformed uuid is a
// 22P02 error there; here it is simply "not found").
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

// Apple wants colours as "rgb(r,g,b)" (hex makes a pass un-addable); the
// browser's <input type="color"> speaks "#rrggbb". These convert between them.
const RGB_RE = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/;

export function isRgb(v: unknown): v is string {
  const m = typeof v === "string" ? RGB_RE.exec(v) : null;
  return !!m && m.slice(1).every((c) => Number(c) <= 255);
}

export function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace(/^#/, ""), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}

export function rgbToHex(rgb: string | null | undefined, fallback: string): string {
  const m = rgb ? RGB_RE.exec(rgb.replace(/\s+/g, "")) : null;
  if (!m) return fallback;
  return "#" + m.slice(1).map((c) => Math.min(255, Number(c)).toString(16).padStart(2, "0")).join("");
}

// A template's default card colours (the same theme buildApplePass() falls
// back to when a merchant has none set), as the #rrggbb the colour inputs edit.
export function themeHex(template: TemplateKey): { bg: string; fg: string; label: string } {
  const t = PASS_THEMES[template];
  return { bg: rgbToHex(t.bg, ""), fg: rgbToHex(t.fg, ""), label: rgbToHex(t.label, "") };
}

// The colour part of a create/update body. A colour equal to the template's
// theme is sent as null (stored NULL), so the card keeps following the live
// theme: a later template switch or theme tweak re-colours it, and the default
// strip stays. Only hand-picked colours are stored.
export function colorBody(colors: { bg: string; fg: string; label: string }, template: TemplateKey) {
  const t = themeHex(template);
  const pick = (k: "bg" | "fg" | "label") => (colors[k].toLowerCase() === t[k] ? null : hexToRgb(colors[k]));
  return { bgColor: pick("bg"), fgColor: pick("fg"), labelColor: pick("label") };
}

export type MerchantUpdate = {
  name?: string;
  earn_rate?: number;
  redeem_template?: TemplateKey;
  bg_color?: string | null;
  fg_color?: string | null;
  label_color?: string | null;
  loyalty_mode?: LoyaltyMode;
  stamp_goal?: number;
  stamp_reward?: string;
  timezone?: string;
  review_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// The "Leave us a review" link on the back of the card (merchants.review_url).
// https only: Wallet makes it tappable, so javascript:, http: and the like are
// refused. Empty or null clears it. Stored as the parsed URL (spaces and the
// like percent-encoded), at most 500 characters.
export const REVIEW_URL_MAX = 500;
export function parseReviewUrl(v: unknown): Parsed<string | null> {
  if (v === null || (typeof v === "string" && !v.trim())) return { ok: true, value: null };
  let url: URL | null = null;
  try {
    url = typeof v === "string" ? new URL(v.trim()) : null;
  } catch {
    /* not a URL */
  }
  if (!url || url.protocol !== "https:")
    return { ok: false, error: "Enter the full review link, starting with https://" };
  if (url.href.length > REVIEW_URL_MAX)
    return { ok: false, error: `Use a review link of ${REVIEW_URL_MAX} characters or fewer` };
  return { ok: true, value: url.href };
}

// The shop's coordinates as Google Maps copies them: right-click the shop,
// click the "37.77493, -122.41942" line. Empty or null clears both.
export function parseLocation(v: unknown): Parsed<{ latitude: number; longitude: number } | null> {
  if (v === null || (typeof v === "string" && !v.trim())) return { ok: true, value: null };
  const m = typeof v === "string" ? /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v) : null;
  if (!m) return { ok: false, error: "Paste the coordinates as lat, lng, like 37.77493, -122.41942" };
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    return { ok: false, error: "Latitude goes from -90 to 90 and longitude from -180 to 180" };
  return { ok: true, value: { latitude, longitude } };
}

// Stored coordinates back into the one "lat, lng" box ("" when unset).
export function formatLocation(lat: unknown, lng: unknown): string {
  return lat != null && lng != null ? `${Number(lat)}, ${Number(lng)}` : "";
}

const COLOR_FIELDS = [
  ["bgColor", "bg_color", "Background"],
  ["fgColor", "fg_color", "Foreground"],
  ["labelColor", "label_color", "Label"],
] as const;

// Validates the editable merchant fields from a request body (camelCase in,
// column names out). `partial` = PATCH: absent fields are left alone. A null
// colour clears it, so the pass falls back to the template's theme.
// Returns the row patch, or an error message for the user.
export function merchantFields(b: Record<string, unknown>, partial: boolean): MerchantUpdate | string {
  const out: MerchantUpdate = {};
  const has = (k: string) => !partial || b[k] !== undefined;

  if (has("name")) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 80) return "Business name is required (max 80 characters)";
    out.name = name;
  }
  if (has("earnRate")) {
    const rate = typeof b.earnRate === "number" || typeof b.earnRate === "string" ? Number(b.earnRate) : NaN;
    // Same range as owner Settings, so a rate set here can be saved there too.
    if (!(rate >= EARN_RATE.min && rate <= EARN_RATE.max))
      return `Earn rate must be between ${EARN_RATE.min} and ${EARN_RATE.max} points per $1`;
    out.earn_rate = rate;
  }
  if (has("template")) {
    if (typeof b.template !== "string" || !Object.hasOwn(REDEEM_TEMPLATES, b.template))
      return "Pick one of the redeem templates";
    out.redeem_template = b.template as TemplateKey;
  }
  // Optional on create too (the column defaults to Pacific). Any zone Intl
  // knows, stored in its canonical spelling; the forms offer US_TIMEZONES.
  if (b.timezone !== undefined) {
    const tz = canonicalTimezone(b.timezone);
    if (!tz) return "Pick a time zone";
    out.timezone = tz;
  }
  for (const [key, col, label] of COLOR_FIELDS) {
    if (!has(key)) continue;
    const v = b[key];
    if (v !== null && !isRgb(v)) return `${label} colour must look like rgb(12,34,56)`;
    out[col] = v;
  }
  // The stamp card fields are optional on create AND update: the wizard sends
  // them only for a stamp card and the editor only when they change, so a points
  // merchant never writes the new columns (an un-migrated database still works).
  if (b.loyaltyMode !== undefined) {
    if (b.loyaltyMode !== "points" && b.loyaltyMode !== "stamps") return "Pick points or a stamp card";
    out.loyalty_mode = b.loyaltyMode;
  }
  if (b.stampGoal !== undefined) {
    const goal = typeof b.stampGoal === "number" || typeof b.stampGoal === "string" ? Number(b.stampGoal) : NaN;
    if (!Number.isInteger(goal) || goal < STAMP_GOAL.min || goal > STAMP_GOAL.max)
      return `A stamp card takes ${STAMP_GOAL.min} to ${STAMP_GOAL.max} stamps`;
    out.stamp_goal = goal;
  }
  if (b.stampReward !== undefined) {
    const reward = typeof b.stampReward === "string" ? b.stampReward.trim() : "";
    if (!reward || reward.length > STAMP_REWARD_MAX) return `The reward needs a name of 1 to ${STAMP_REWARD_MAX} characters`;
    out.stamp_reward = reward;
  }
  // Optional even on create, so creating a merchant never writes these
  // columns (a database without them still works).
  if (b.reviewUrl !== undefined) {
    const r = parseReviewUrl(b.reviewUrl);
    if (!r.ok) return r.error;
    out.review_url = r.value;
  }
  if (b.location !== undefined) {
    const r = parseLocation(b.location);
    if (!r.ok) return r.error;
    out.latitude = r.value?.latitude ?? null;
    out.longitude = r.value?.longitude ?? null;
  }

  // One careless colour pick would otherwise ship an unreadable card to every
  // customer of the merchant. When the body carries all three colours (the
  // wizard and editor always send them) and the template is known, check the
  // colours the pass will really use (null → the template's theme) with the
  // WCAG formula the art generator uses.
  const template = out.redeem_template ?? (typeof b.template === "string" && Object.hasOwn(REDEEM_TEMPLATES, b.template) ? (b.template as TemplateKey) : null);
  if (template && COLOR_FIELDS.every(([key]) => b[key] !== undefined)) {
    const theme = PASS_THEMES[template];
    const bg = (out.bg_color ?? theme.bg) as string;
    const fg = (out.fg_color ?? theme.fg) as string;
    const lab = (out.label_color ?? theme.label) as string;
    const textRatio = contrast(fg, bg);
    if (textRatio < 4.5) return `Text and background colours are too close (${textRatio.toFixed(1)}:1) — points would be hard to read. Pick colours with more contrast.`;
    const labelRatio = contrast(lab, bg);
    if (labelRatio < 3) return `Label and background colours are too close (${labelRatio.toFixed(1)}:1). Pick a lighter or darker label colour.`;
  }
  return out;
}

// WCAG 2 contrast ratio between two "rgb(r,g,b)" colours.
export function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (RGB_RE.exec(c.replace(/\s+/g, "")) ?? [, "0", "0", "0"]).slice(1).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Strong, readable password: 16 chars from an alphabet without look-alikes
// (no 0/O, 1/l/I). ~92 bits. Web Crypto, so it runs in the browser and Node.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generatePassword(length = 16): string {
  const out: string[] = [];
  const buf = new Uint8Array(1);
  // Rejection sampling: drop bytes past the largest multiple of the alphabet
  // size so every character is equally likely (plain modulo would bias).
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) out.push(ALPHABET[buf[0] % ALPHABET.length]);
  }
  return out.join("");
}
