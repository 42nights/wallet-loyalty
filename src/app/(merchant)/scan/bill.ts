// A bill amount as typed at the counter → a number, or null when it isn't a
// plain amount. A comma decimal counts ("12,50" → 12.5: many keyboards and
// locales type one, and parseFloat used to read it as 12). Anything else —
// letters, "1,250.00", three decimals, zero — is null, so /scan asks for
// "an amount like 12.50" instead of guessing what the cashier meant.
export function parseBill(raw: string): number | null {
  const m = /^(\d*)(?:[.,](\d{0,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(`${m[1]}.${m[2] ?? ""}`);
  return n > 0 ? n : null;
}
