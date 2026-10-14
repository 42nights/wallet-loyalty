import { create } from "qrcode";
import type { TemplateKey } from "@/lib/config";
import { PASS_THEMES } from "@/lib/passThemes";

// Sample merchants for the public landing page and /demo. Everything here is
// made-up demo data — no database, no auth — so both pages keep rendering even
// when Supabase is down. Server-only: imported by page.tsx files, never by a
// client component, so neither `qrcode` nor config.ts ends up in the browser.

export type Sample = {
  key: TemplateKey;
  kind: string; // business type shown in the switcher
  name: string; // shop name, shown as the pass logoText (pass.ts)
  colors: { bg: string; fg: string; label: string }; // the template's default pass colours (passThemes.ts)
  earnRate: number; // points per $1, like merchants.earn_rate
  customer: string;
  startPoints: number;
  suggestedBill: string; // pre-filled bill; after it, a reward is affordable (the demo guide)
  // All-time tiles, like the real dashboard's KPI row.
  kpis: { members: number; active: number; issued: number; redeemed: number; repeat: number };
  issued14: number[]; // points issued per day, last 14 days (last = today)
  redeemed14: number[];
  atRisk: { name: string; visits: number; days: number }[]; // segment at_risk: 3+ visits, last one 31–90 days ago
};

// Numbers are sized to each business: avg ticket × earn rate × member visits a
// day, roughly eight months of history for the all-time tiles.
export const SAMPLES: Sample[] = [
  {
    key: "cafe",
    kind: "Café",
    name: "Fern & Fox Coffee",
    colors: PASS_THEMES.cafe,
    earnRate: 10,
    customer: "Sam Rivera",
    startPoints: 240,
    suggestedBill: "6.50",
    kpis: { members: 412, active: 238, issued: 742600, redeemed: 451300, repeat: 0.64 },
    issued14: [2900, 3300, 3100, 3500, 3900, 4200, 2100, 2800, 3200, 3400, 3600, 4100, 4500, 2300],
    redeemed14: [1800, 2100, 1900, 2200, 2600, 2900, 1100, 1700, 1900, 2300, 2100, 2800, 3000, 1300],
    atRisk: [{ name: "Priya N.", visits: 12, days: 34 }, { name: "Marcus T.", visits: 7, days: 41 }, { name: "Elena G.", visits: 5, days: 58 }],
  },
  {
    key: "restaurant",
    kind: "Restaurant",
    name: "Golden Lantern Kitchen",
    colors: PASS_THEMES.restaurant,
    earnRate: 10,
    customer: "Jordan Lee",
    startPoints: 420,
    suggestedBill: "38.00",
    kpis: { members: 286, active: 131, issued: 1826400, redeemed: 1004500, repeat: 0.52 },
    issued14: [6200, 5400, 6800, 7900, 11200, 14600, 12900, 6600, 5900, 7100, 8300, 11800, 15200, 13400],
    redeemed14: [3000, 2500, 3500, 4500, 6000, 8500, 7000, 3500, 3000, 4000, 4500, 6500, 9000, 7500],
    atRisk: [{ name: "Wei C.", visits: 9, days: 36 }, { name: "Hannah B.", visits: 4, days: 47 }, { name: "Diego M.", visits: 6, days: 63 }],
  },
  {
    key: "retail",
    kind: "Retail",
    name: "Northside Supply",
    colors: PASS_THEMES.retail,
    earnRate: 1,
    customer: "Alex Morgan",
    startPoints: 460,
    suggestedBill: "64.00",
    kpis: { members: 167, active: 74, issued: 241700, redeemed: 132600, repeat: 0.41 },
    issued14: [1100, 1300, 1250, 1500, 1700, 2100, 800, 1150, 1400, 1350, 1600, 1900, 2300, 900],
    redeemed14: [500, 750, 500, 1000, 750, 1500, 300, 500, 1000, 750, 1000, 1250, 1500, 300],
    atRisk: [{ name: "Robin K.", visits: 5, days: 39 }, { name: "Sofia P.", visits: 3, days: 52 }, { name: "Tom W.", visits: 4, days: 71 }],
  },
];

// The serial the sample card's QR encodes. Like a real pass, the QR carries
// only the serial (pass.ts setBarcodes), so this one scans to a harmless string.
export const SAMPLE_SERIAL = "demo-0000-sample-card";

export type QR = { size: number; d: string };

// QR modules → one SVG path of dark squares, drawn by WalletCard. Computed on
// the server from the installed `qrcode` package, so the preview is a real code.
export function qrPath(text: string): QR {
  const { size, data } = create(text, { errorCorrectionLevel: "M" }).modules;
  let d = "";
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) if (data[row * size + col]) d += `M${col} ${row}h1v1h-1z`;
  return { size, d };
}
