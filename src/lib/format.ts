// Display formatting shared by staff and admin screens. US market (Ayaan,
// 2026-10-13): dollars and North American phone numbers. Pure — safe to import
// from client components.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 612.5 → "$612.50". */
export function formatMoney(amount: number): string {
  return usd.format(amount);
}

/**
 * A stored phone for display: US numbers ("+14155550110", "4155550110") →
 * "(415) 555-0110"; anything else is shown as stored.
 */
export function formatPhone(stored: string | null): string {
  if (!stored) return "";
  const d = stored.replace(/\D/g, "");
  const us = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : null;
  return us ? `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}` : stored;
}
