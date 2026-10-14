import { PKPass } from "passkit-generator";
import { db } from "@/lib/supabase";
import {
  PASS_TYPE_ID,
  TEAM_ID,
  ORG_NAME,
  PUBLIC_BASE_URL,
  redemptionsFor,
  assertPassConfig,
  templateKey,
} from "@/lib/config";
import { withDefaultArt } from "@/lib/passDefaults";
import { PASS_THEMES } from "@/lib/passThemes";
import { passkitCertificates } from "./certs";
import { ASSET_NAMES } from "./assets";
import type { PassData } from "../types";

// Build the .pkpass entirely from in-memory buffers — per-merchant branding,
// no static disk model (Vercel file-tracing safe, multi-tenant). Art is fetched
// from Supabase storage by merchant_id; anything missing falls back to bundled
// default buffers (the merchant's template set) so a brand-new merchant still
// issues a valid, on-brand pass.

const STORAGE_BUCKET = "pass-assets";


// The merchants row is read with select("*") so a database that has not run a
// later migration still issues passes; the columns those migrations add
// (earn_rate, redeem_template) are therefore optional here.
type MerchantRow = {
  id: string;
  name: string;
  bg_color: string | null;
  fg_color: string | null;
  label_color: string | null;
  assets_updated_at: string | null;
  earn_rate?: number | string | null;
  redeem_template?: string | null;
};

// Apple wants rgb(r,g,b) strings — hex makes a pass silently un-addable. Accept
// rgb()/hex from the merchant row (normalised to "rgb(r,g,b)" so it compares
// equal to a theme colour), else fall back.
function rgb(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const v = value.replace(/\s+/g, "").toLowerCase();
  if (/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(v)) return v;
  const hex = v.replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgb(${r},${g},${b})`;
  }
  return fallback;
}

// Decoded-buffer cache keyed by merchant + assets_updated_at + filename, so a
// warm process doesn't re-download per conditional-GET, and a re-upload (which
// bumps assets_updated_at) busts the entry.
const assetCache = new Map<string, Buffer>();

// The merchant's own upload of one image, or undefined when they have none.
async function merchantAsset(merchant: MerchantRow, name: string): Promise<Buffer | undefined> {
  const key = `${merchant.id}:${merchant.assets_updated_at ?? "0"}:${name}`;
  const cached = assetCache.get(key);
  if (cached) return cached;

  const { data, error } = await db.storage
    .from(STORAGE_BUCKET)
    .download(`merchants/${merchant.id}/${name}`);
  if (error || !data) return undefined;

  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length === 0) return undefined;
  assetCache.set(key, buf);
  return buf;
}

type Reward = { label: string; cost: number };

// The merchant's redeem template as positive point costs, cheapest first.
function rewardsFor(template: unknown): Reward[] {
  return redemptionsFor(template)
    .map((a) => ({ label: a.label, cost: -a.points }))
    .sort((a, b) => a.cost - b.cost);
}

// Front-of-card nudge: the best reward the balance already covers, else the
// cheapest one still out of reach and how far away it is.
function nextReward(points: number, rewards: Reward[]): string {
  const ready = rewards.filter((r) => r.cost <= points).pop();
  if (ready) return `Ready: ${ready.label}`;
  return `${rewards[0].label} in ${rewards[0].cost - points} pts`;
}

export async function buildApplePass(data: PassData): Promise<Buffer> {
  assertPassConfig();
  const {
    serial,
    merchantId,
    points,
    authToken,
    updatedAt = new Date(),
    offerText,
    customerName,
    voided = false,
  } = data;

  let merchant: MerchantRow | null = null;
  if (merchantId) {
    const { data: row } = await db.from("merchants").select("*").eq("id", merchantId).single();
    merchant = (row as MerchantRow | null) ?? null;
  }

  // Assemble the in-memory bundle: the merchant's uploads, then defaults for
  // whatever image they have not uploaded (never mixed within one image).
  const uploaded: Record<string, Buffer> = {};
  if (merchant) {
    for (const name of ASSET_NAMES) {
      const buf = await merchantAsset(merchant, name);
      if (buf) uploaded[name] = buf;
    }
  }
  const template = templateKey(merchant?.redeem_template);
  const theme = PASS_THEMES[template];
  const bg = rgb(merchant?.bg_color ?? null, theme.bg);
  const fg = rgb(merchant?.fg_color ?? null, theme.fg);
  const buffers = withDefaultArt(uploaded, template);
  // The default strip is drawn for the theme's colours. Under a merchant's own
  // background/foreground it could swallow the big points number (dark text on
  // the dark themed strip), so their card goes without a strip until they
  // upload one.
  if (bg !== theme.bg || fg !== theme.fg) {
    for (const name of ["strip.png", "strip@2x.png", "strip@3x.png"]) {
      if (!uploaded[name]) delete buffers[name];
    }
  }

  // Identity + branding MUST go through props — passkit-generator writes the
  // final pass.json from props, not from a pass.json buffer (a buffer's
  // top-level identity fields are dropped). Without passTypeIdentifier /
  // teamIdentifier the pass is invalid and Apple refuses to add it.
  const orgName = merchant?.name || ORG_NAME;
  const pass = new PKPass(buffers, passkitCertificates(), {
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    organizationName: orgName,
    description: `${orgName} Loyalty Card`,
    serialNumber: serial,
    // These two are what let the card update itself in Wallet:
    webServiceURL: `${PUBLIC_BASE_URL}/api`,
    authenticationToken: authToken,
    logoText: orgName, // shop name as text next to the logo (readability)
    // The merchant's colours win; unset ones come from their template's theme.
    backgroundColor: bg,
    foregroundColor: fg,
    labelColor: rgb(merchant?.label_color ?? null, theme.label),
    // stripColor is NOT in Apple's Pass reference: passkit-generator marks it an
    // "Undocumented feature" for the colour of a primary value drawn over the
    // strip. It is tied to the merchant's foreground so the points stay readable
    // if Wallet honours it; it may be ignored without any error, so "points
    // readable over the strip" is a check in the real-device test (RUNBOOK §5).
    stripColor: fg,
    sharingProhibited: true,
  });

  pass.type = "storeCard";

  // Field keys share one pool across every field row, and passkit-generator
  // drops an invalid or repeated field with only a console warning — keep keys
  // unique and check the issued pass.json after changing anything here.
  // String values so iOS renders the balance exactly (no locale grouping like "1,000").
  const balance = String(points);

  // Header: stays visible while the card is collapsed in the Wallet stack. This
  // is the ONE field with a changeMessage, so a balance change shows a single
  // notification. Never put one on the OFFER (the HIG forbids change messages
  // for marketing). A deactivated card (owner, /customers/<serial>) says so
  // here and in the primary field instead of the balance, with no change
  // message ("You now have DEACTIVATED points"); the balance itself stays in
  // the ledger and comes back if the owner reactivates the card.
  pass.headerFields.push(
    voided
      ? { key: "balance", label: "CARD", value: "DEACTIVATED" }
      : { key: "balance", label: "POINTS", value: balance, changeMessage: "You now have %@ points" }
  );

  // POINTS as the big primary number (over the strip) — easiest to read.
  pass.primaryFields.push(
    voided
      ? { key: "points", label: "STATUS", value: "Deactivated" }
      : { key: "points", label: "POINTS", value: balance }
  );

  const rewards = rewardsFor(merchant?.redeem_template);
  if (customerName && customerName.trim()) {
    pass.secondaryFields.push({ key: "member", label: "MEMBER", value: customerName.trim() });
  }
  pass.secondaryFields.push(
    voided
      ? { key: "next", label: "QUESTIONS?", value: `Ask the team at ${orgName}` }
      : { key: "next", label: "NEXT REWARD", value: nextReward(points, rewards) }
  );

  // Back of the card. Win-back offer first when a campaign set one — passive:
  // it shows when the customer opens the card, no lockscreen marketing.
  if (!voided && offerText && offerText.trim()) {
    pass.backFields.push({ key: "offer", label: "OFFER", value: offerText.trim() });
  }
  const parsedRate = Number(merchant?.earn_rate ?? 1);
  const rate = Number.isFinite(parsedRate) ? parsedRate : 1;
  pass.backFields.push(
    {
      key: "earn",
      label: "HOW TO EARN",
      value: `${rate} point${rate === 1 ? "" : "s"} per 1.00 spent`,
    },
    {
      key: "rewards",
      label: "REWARDS",
      value: rewards.map((r) => `${r.label}: ${r.cost} pts`).join("\n"),
    },
    // A Date, not a pre-formatted string: Wallet formats it on the device in
    // the customer's own time zone and locale (a server-side string showed the
    // server's day in dd/mm/yyyy).
    {
      key: "updated",
      label: "UPDATED",
      value: updatedAt,
      dateStyle: "PKDateStyleMedium",
      timeStyle: "PKDateStyleShort",
    },
    {
      key: "terms",
      label: "TERMS",
      value: `Points have no cash value and cannot be transferred. ${orgName} may change rewards and point values at any time.`,
    }
  );

  // The QR the merchant scans — encodes the serial for counter lookup. No
  // altText: a 36-character serial printed under the code is noise on the card,
  // and when the camera cannot read it the cashier finds the customer by phone
  // on /scan instead. A deactivated card has nothing to scan for.
  if (!voided) {
    pass.setBarcodes({
      format: "PKBarcodeFormatQR",
      message: serial,
      messageEncoding: "iso-8859-1",
    });
  }

  return pass.getAsBuffer();
}
