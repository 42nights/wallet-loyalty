import { EARN_RATE, REDEEM_TEMPLATES, type TemplateKey } from "@/lib/config";
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
};

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
  for (const [key, col, label] of COLOR_FIELDS) {
    if (!has(key)) continue;
    const v = b[key];
    if (v !== null && !isRgb(v)) return `${label} colour must look like rgb(12,34,56)`;
    out[col] = v;
  }
  return out;
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
