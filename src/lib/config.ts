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

// The 4 redeem buttons shown in the merchant webapp.
export const REDEMPTIONS: Action[] = [
  { id: "drinks", label: "Drinks", points: -500, kind: "redeem" },
  { id: "extra_side", label: "Extra Side", points: -1000, kind: "redeem" },
  { id: "fortune_cookie", label: "Fortune Cookie", points: -100, kind: "redeem" },
  { id: "extra_sauce", label: "Extra Sauce", points: -100, kind: "redeem" },
];

// Earning is points-per-dollar with a per-merchant `earn_rate` (merchants
// table). The /scan bill-amount input applies round(earn_rate * amount)
// server-side (see /api/merchant/redeem). There are no fixed earn presets —
// only the redeem buttons above are fixed.
export const ALL_ACTIONS: Action[] = [...REDEMPTIONS];

export function findAction(id: string): Action | undefined {
  return ALL_ACTIONS.find((a) => a.id === id);
}

// Pass appearance / identifiers (also overridable via env)
export const PASS_TYPE_ID =
  process.env.PASS_TYPE_ID || "pass.com.42nights.loyalty";
export const TEAM_ID = process.env.APPLE_TEAM_ID || "REPLACE_TEAM_ID";
export const ORG_NAME = process.env.PASS_ORG_NAME || "42nights";
// Public base URL of THIS app, e.g. https://loyalty.42nights.dev
export const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "http://localhost:3000";
