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

// Earning is points-per-dollar with a per-merchant `earn_rate` (merchants
// table). The /scan bill-amount input applies round(earn_rate * amount)
// server-side (see /api/merchant/redeem). There are no fixed earn presets.
export const ALL_ACTIONS: Action[] = Object.values(REDEEM_TEMPLATES).flatMap((t) => t.actions);

// Label lookup for history views. To validate a redeem, use redemptionsFor()
// with the merchant's template instead — this matches ids from any template.
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
