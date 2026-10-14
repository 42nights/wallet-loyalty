// Enrollment field rules, shared by POST /api/enroll (the trust boundary) and
// EnrollForm (inline errors before the request goes out). Pure — no server
// imports — so the client bundle can use it too. Lives beside route.ts because
// a route file may only export route handlers.

export const NAME_MAX = 60;

export type EnrollFields = { name: string; phone: string; email: string | null };
export type FieldErrors = Partial<Record<keyof EnrollFields, string>>;

// One canonical form per phone number, so the (merchant_id, customer_phone)
// unique index sees every way of typing it as the same customer: drop spaces,
// dashes, parentheses and dots, turn an international "00" prefix into "+",
// then require 7-15 digits (E.164 allows at most 15).
// US market (Ayaan, 2026-10-13): a North American number is stored as E.164,
// "+1" + 10 digits, whether it was typed "(415) 555-0110", "1-415-555-0110" or
// "+1 415.555.0110" — before this, the leading 1 / +1 forms slipped past the
// index and made a second card (F1). Anything else stays as typed.
// ponytail: US-only inference; a merchant abroad needs a per-merchant region.
export function normalizePhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s\-().]/g, "").replace(/^00/, "+");
  if (!/^\+?\d{7,15}$/.test(compact)) return null;
  const digits = compact.replace("+", "");
  if (digits.length === 10 && !compact.startsWith("+")) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return compact;
}

export function validateEnroll(input: {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
}): { ok: true; value: EnrollFields } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  // Collapse inner whitespace too: the name is printed on the Wallet card, and a
  // pasted newline or tab would break that line.
  // Control characters and invisible spacers are stripped first: a NUL broke the
  // insert (500). ZWNJ/ZWJ (U+200C/D) stay — Persian, Arabic-script and Indic
  // names and emoji need them — but a name with nothing visible is rejected
  // instead of printing an empty MEMBER line on the card.
  const name =
    typeof input.name === "string"
      ? input.name.replace(/[\u0000-\u001F\u007F\u200B\u2060\uFEFF]/g, " ").trim().replace(/\s+/g, " ")
      : "";
  if (!name.replace(/[\u200C\u200D]/g, "").trim()) errors.name = "Enter your name.";
  else if (name.length > NAME_MAX) errors.name = `Use ${NAME_MAX} characters or fewer.`;

  const rawPhone = typeof input.phone === "string" ? input.phone.trim() : "";
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (!rawPhone) errors.phone = "Enter your phone number.";
  else if (!phone) errors.phone = "Enter a valid phone number (7 to 15 digits).";

  const email = typeof input.email === "string" && input.email.trim() ? input.email.trim() : null;
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    errors.email = "Enter a valid email address, or leave it empty.";

  if (errors.name || errors.phone || errors.email || !phone) return { ok: false, errors };
  return { ok: true, value: { name, phone, email } };
}
