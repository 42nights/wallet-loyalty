import { PKPass } from "passkit-generator";
import { db } from "@/lib/supabase";
import { PASS_TYPE_ID, TEAM_ID, ORG_NAME, PUBLIC_BASE_URL } from "@/lib/config";
import { defaultAssetBuffer } from "@/lib/passDefaults";
import { passkitCertificates } from "./certs";
import type { PassData } from "../types";

// Build the .pkpass entirely from in-memory buffers — per-merchant branding,
// no static disk model (Vercel file-tracing safe, multi-tenant). Art is fetched
// from Supabase storage by merchant_id; anything missing falls back to bundled
// default buffers so a brand-new merchant still issues a valid pass.

const STORAGE_BUCKET = "pass-assets";

// Apple pass image set. icon.png is MANDATORY or Wallet silently rejects the pass.
const ASSET_NAMES = [
  "icon.png",
  "icon@2x.png",
  "icon@3x.png",
  "logo.png",
  "logo@2x.png",
  "strip.png",
  "strip@2x.png",
  "strip@3x.png",
] as const;

type MerchantBranding = {
  id: string;
  name: string;
  bg_color: string | null;
  fg_color: string | null;
  label_color: string | null;
  assets_updated_at: string | null;
};

// Apple wants rgb(r,g,b) strings — hex makes a pass silently un-addable. Accept
// rgb()/hex from the merchant row, else fall back.
function rgb(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(v)) return v;
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

async function assetBuffer(
  merchant: MerchantBranding | null,
  name: string
): Promise<Buffer | undefined> {
  if (!merchant) return defaultAssetBuffer(name);
  const key = `${merchant.id}:${merchant.assets_updated_at ?? "0"}:${name}`;
  const cached = assetCache.get(key);
  if (cached) return cached;

  const { data, error } = await db.storage
    .from(STORAGE_BUCKET)
    .download(`merchants/${merchant.id}/${name}`);
  if (error || !data) return defaultAssetBuffer(name);

  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length === 0) return defaultAssetBuffer(name);
  assetCache.set(key, buf);
  return buf;
}

export async function buildApplePass(data: PassData): Promise<Buffer> {
  const { serial, merchantId, points, authToken, updatedAt = new Date(), offerText } = data;

  let merchant: MerchantBranding | null = null;
  if (merchantId) {
    const { data: row } = await db
      .from("merchants")
      .select("id, name, bg_color, fg_color, label_color, assets_updated_at")
      .eq("id", merchantId)
      .single();
    merchant = (row as MerchantBranding | null) ?? null;
  }

  // Assemble the in-memory bundle.
  const buffers: Record<string, Buffer> = {};
  for (const name of ASSET_NAMES) {
    const buf = await assetBuffer(merchant, name);
    if (buf) buffers[name] = buf;
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
    backgroundColor: rgb(merchant?.bg_color ?? null, "rgb(255,255,255)"),
    foregroundColor: rgb(merchant?.fg_color ?? null, "rgb(20,20,20)"),
    labelColor: rgb(merchant?.label_color ?? null, "rgb(120,120,120)"),
    // stripColor = color of PRIMARY field value rendered over the strip. Apple
    // defaults it to WHITE (ignores foregroundColor there), so the points looked
    // white. Tie it to the merchant's foreground so points stay readable.
    stripColor: rgb(merchant?.fg_color ?? null, "rgb(20,20,20)"),
    sharingProhibited: true,
  });

  pass.type = "storeCard";

  // POINTS as the big primary number (over the strip) — easiest to read.
  // String value so iOS renders it exactly (no locale grouping like "1,000").
  pass.primaryFields.push({ key: "points", label: "POINTS", value: String(points) });

  // "UPDATED" — refreshes every time we re-issue the pass
  pass.secondaryFields.push({
    key: "updated",
    label: "UPDATED",
    value: updatedAt.toLocaleDateString("en-GB"), // dd/mm/yyyy
  });

  // Win-back offer on the BACK of the card (campaign-set). Passive: it shows when
  // the customer opens the card in Wallet — no lockscreen marketing.
  if (offerText && offerText.trim()) {
    pass.backFields.push({ key: "offer", label: "OFFER", value: offerText.trim() });
  }

  // The QR the merchant scans — encodes the serial for counter lookup.
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: serial,
    messageEncoding: "iso-8859-1",
  });

  return pass.getAsBuffer();
}
