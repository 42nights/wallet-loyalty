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
  loyaltyMode,
  stampGoal,
  stampReward,
  birthdayBonus,
  describeHappyHour,
  happyHourOf,
} from "@/lib/config";
import { withDefaultArt } from "@/lib/passDefaults";
import { PASS_THEMES } from "@/lib/passThemes";
import { passkitCertificates } from "./certs";
import { ASSET_NAMES } from "./assets";
import { stampStrip } from "./stampStrip";
import type { PassData } from "../types";

// Build the .pkpass entirely from in-memory buffers — per-merchant branding,
// no static disk model (Vercel file-tracing safe, multi-tenant). Art is fetched
// from Supabase storage by merchant_id; anything missing falls back to bundled
// default buffers (the merchant's template set) so a brand-new merchant still
// issues a valid, on-brand pass.

const STORAGE_BUCKET = "pass-assets";


// The merchants row is read with select("*") so a database that has not run a
// later migration still issues passes; the columns those migrations add
// (earn_rate, redeem_template, the stamp card ones, birthday_reward,
// happy_hour, review_url, latitude, longitude) are therefore optional here.
type MerchantRow = {
  id: string;
  name: string;
  bg_color: string | null;
  fg_color: string | null;
  label_color: string | null;
  assets_updated_at: string | null;
  earn_rate?: number | string | null;
  redeem_template?: string | null;
  loyalty_mode?: string | null;
  stamp_goal?: number | null;
  stamp_reward?: string | null;
  birthday_reward?: boolean | null;
  happy_hour?: unknown;
  review_url?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

// The review link joins the back of the card from this many earn visits on
// (the same "visits" as the owner's customer page: ledger rows "earn:…").
const REVIEW_AFTER_VISITS = 3;

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
    birthday,
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
  const label = rgb(merchant?.label_color ?? null, theme.label);
  const buffers = withDefaultArt(uploaded, template);
  const stamps = loyaltyMode(merchant?.loyalty_mode) === "stamps";
  const goal = stampGoal(merchant?.stamp_goal);
  const reward = stampReward(merchant?.stamp_reward);
  if (stamps) {
    // On a stamp card the strip IS the balance: the grid, drawn for this card's
    // count in the card's real colours, replaces any uploaded or default strip.
    for (const [name, scale] of [["strip.png", 1], ["strip@2x.png", 2], ["strip@3x.png", 3]] as const)
      buffers[name] = stampStrip(points, goal, { bg, fg, label }, scale);
  } else if (bg !== theme.bg || fg !== theme.fg) {
    // The default strip is drawn for the theme's colours. Under a merchant's own
    // background/foreground it could swallow the big points number (dark text on
    // the dark themed strip), so their card goes without a strip until they
    // upload one.
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
    labelColor: label,
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
  if (voided) {
    pass.headerFields.push({ key: "balance", label: "CARD", value: "DEACTIVATED" });
    pass.primaryFields.push({ key: "points", label: "STATUS", value: "Deactivated" });
  } else if (stamps) {
    // A stamp card has no primary number: the strip's grid shows the count.
    pass.headerFields.push({
      key: "balance",
      label: "STAMPS",
      value: `${balance} of ${goal}`,
      changeMessage: "Stamps: %@",
    });
  } else {
    pass.headerFields.push({
      key: "balance",
      label: "POINTS",
      value: balance,
      changeMessage: "You now have %@ points",
    });

    // POINTS as the big primary number (over the strip) — easiest to read.
    pass.primaryFields.push({ key: "points", label: "POINTS", value: balance });
  }

  const rewards = rewardsFor(merchant?.redeem_template);
  if (customerName && customerName.trim()) {
    pass.secondaryFields.push({ key: "member", label: "MEMBER", value: customerName.trim() });
  }
  pass.secondaryFields.push(
    voided
      ? { key: "next", label: "QUESTIONS?", value: `Ask the team at ${orgName}` }
      : stamps
      ? { key: "next", label: "REWARD", value: points >= goal ? `Ready: ${reward}` : `${reward} at ${goal}` }
      : { key: "next", label: "NEXT REWARD", value: nextReward(points, rewards) }
  );

  // Back of the card. Win-back offer first when a campaign set one — passive:
  // it shows when the customer opens the card, no lockscreen marketing.
  if (!voided && offerText && offerText.trim()) {
    pass.backFields.push({ key: "offer", label: "OFFER", value: offerText.trim() });
  }
  // The merchant's review link, once the customer is a regular. Only ever a
  // link: nothing is earned or unlocked by leaving a review.
  const reviewUrl = merchant?.review_url;
  if (!voided && merchantId && reviewUrl) {
    const { count } = await db
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("merchant_id", merchantId)
      .eq("serial", serial)
      .like("reason", "earn:%");
    if ((count ?? 0) >= REVIEW_AFTER_VISITS) {
      // attributedValue takes HTML (Apple allows <a href> only) and overrides
      // value; value stays as the plain fallback (watchOS shows that one).
      const href = reviewUrl.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      pass.backFields.push({
        key: "review",
        label: `Enjoying ${orgName}?`,
        value: `Leave us a review: ${reviewUrl}`,
        attributedValue: `<a href='${href}'>Leave us a review</a>`,
      });
    }
  }
  const parsedRate = Number(merchant?.earn_rate ?? 1);
  const rate = Number.isFinite(parsedRate) ? parsedRate : 1;
  pass.backFields.push({
    key: "earn",
    label: "HOW TO EARN",
    value: stamps
      ? `1 stamp per visit or item, added by staff at the counter. Collect ${goal} for ${reward}.`
      : `${rate} point${rate === 1 ? "" : "s"} per 1.00 spent`,
  });
  // The earn boosters, under the earn line. The window is the shop's own wall
  // clock ("3-5 pm"), which is the customer's too: they shop there.
  const happyHour = happyHourOf(merchant?.happy_hour);
  if (happyHour) {
    pass.backFields.push({ key: "happyhour", label: "HAPPY HOUR", value: describeHappyHour(happyHour) });
  }
  // Only on cards that gave a birthday: a member without one would never get it.
  if (merchant?.birthday_reward === true && birthday) {
    const on = new Date(`${birthday}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
    pass.backFields.push({ key: "birthday", label: "BIRTHDAY", value: `${birthdayBonus(merchant)} bonus points on ${on}` });
  }
  pass.backFields.push(
    stamps
      ? { key: "rewards", label: "REWARD", value: `${reward} when you collect ${goal} stamps` }
      : { key: "rewards", label: "REWARDS", value: rewards.map((r) => `${r.label}: ${r.cost} pts`).join("\n") },
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
      value: stamps
        ? `Stamps have no cash value and cannot be transferred. ${orgName} may change the reward at any time.`
        : `Points have no cash value and cannot be transferred. ${orgName} may change rewards and point values at any time.`,
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

  // Lock-screen relevance: near the shop, iOS may offer the card on the Lock
  // Screen with this text (Apple's Pass.locations, up to 10; we send the one
  // shop). Whether it shows is iOS's call (Location Services, the card's
  // "Suggest on Lock Screen" switch), so check it in the RUNBOOK §5 device test.
  const lat = Number(merchant?.latitude ?? NaN);
  const lng = Number(merchant?.longitude ?? NaN);
  if (!voided && Number.isFinite(lat) && Number.isFinite(lng)) {
    pass.setLocations({ latitude: lat, longitude: lng, relevantText: `Show your ${orgName} card` });
  }

  return pass.getAsBuffer();
}
