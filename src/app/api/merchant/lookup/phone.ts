// Find-by-phone at the counter. Phones are stored exactly as the customer typed
// them at enrollment ("+1 555-010-1234", "5550101234", "(555) 010-1234"…), so
// we compare digits only and match from the END of the number: the customer can
// give the full number with or without the country code.
//
// At least 7 digits are required. A last-4 search returned other customers'
// serials, and with "Send card to phone" that let anyone who knew four digits
// walk away with someone else's Wallet card (and an auto-loaded single match
// put earn/redeem on the wrong ledger). The full local number is the minimum
// proof of identity the counter can ask for.
export const MIN_PHONE_DIGITS = 7;

export function digitsOf(s: string | null): string {
  return (s ?? "").replace(/\D/g, "");
}

// Regex for PostgREST's `match` filter: the stored text ends with the last 4
// typed digits, whatever separators sit between them. Built from digits only,
// so nothing the cashier types reaches the regex. It only narrows candidates in
// the database — phoneMatches() makes the real decision.
export function phoneSuffixPattern(typedDigits: string): string {
  return typedDigits.slice(-4).split("").join("\\D*") + "\\D*$";
}

export function phoneMatches(stored: string | null, typedDigits: string): boolean {
  const s = digitsOf(stored);
  if (!s) return false;
  // typed is the tail of the stored number: "1234", "5550101234"
  if (s.endsWith(typedDigits)) return true;
  // the cashier added a country code the customer didn't store. The length
  // floor stops a junk short "phone" (e.g. "1234") matching any full number.
  return s.length >= 7 && typedDigits.endsWith(s);
}

export function maskPhone(stored: string | null): string {
  return `••• ${digitsOf(stored).slice(-4)}`;
}
