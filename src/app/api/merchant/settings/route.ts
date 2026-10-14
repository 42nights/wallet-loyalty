import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { EARN_RATE, PUBLIC_BASE_URL, REDEEM_TEMPLATES, templateKey } from "@/lib/config";
import { formatLocation, parseLocation, parseReviewUrl } from "@/lib/admin/merchant";
import { refreshMerchantCards } from "@/lib/wallet";

export const runtime = "nodejs"; // refreshMerchantCards pushes via APNs (http2)

// Earn rate: EARN_RATE in config.ts (shared with the creator admin). The
// settings form mirrors these limits as input min/max; this route is the authority.

// largest bill one earn may carry (merchants.max_bill, enforced by the redeem route)
const MAX_BILL_MIN = 10;
const MAX_BILL_MAX = 100_000;

type MerchantRow = {
  name: string;
  slug: string | null;
  earn_rate: number | string;
  redeem_template?: string | null;
  max_bill?: number | string | null;
  review_url?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

function settings(m: MerchantRow) {
  return {
    merchantName: m.name,
    template: templateKey(m.redeem_template),
    earnRate: Number(m.earn_rate),
    maxBill: Number(m.max_bill ?? 1000), // 1000 = schema default (un-migrated database)
    enrollUrl: m.slug ? `${PUBLIC_BASE_URL}/enroll/${m.slug}` : null,
    reviewUrl: m.review_url ?? "",
    location: formatLocation(m.latitude, m.longitude),
  };
}

// GET /api/merchant/settings — the owner's merchant settings.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // select("*") so a database without the redeem_template / max_bill columns
  // still works (templateKey() and settings() fall back to the defaults).
  const { data } = await db.from("merchants").select("*").eq("id", owner.merchantId).single();
  if (!data) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  return NextResponse.json(settings(data));
}

// PATCH /api/merchant/settings  body: { template?, earnRate?, maxBill?, reviewUrl?, location? }
// Strict: an unknown template or out-of-range rate is a 400, never silently
// defaulted — the owner must see that their change did not take.
// reviewUrl: https link or "" to clear. location: "lat, lng" or "" to clear.
export async function PATCH(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { template, earnRate, maxBill, reviewUrl, location } = await req.json().catch(() => ({}));
  const update: {
    redeem_template?: string;
    earn_rate?: number;
    max_bill?: number;
    review_url?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } = {};

  if (template !== undefined) {
    if (typeof template !== "string" || !Object.hasOwn(REDEEM_TEMPLATES, template))
      return NextResponse.json({ error: "Unknown template" }, { status: 400 });
    update.redeem_template = template;
  }
  if (earnRate !== undefined) {
    if (typeof earnRate !== "number" || !(earnRate >= EARN_RATE.min && earnRate <= EARN_RATE.max))
      return NextResponse.json(
        { error: `Earn rate must be between ${EARN_RATE.min} and ${EARN_RATE.max}` },
        { status: 400 }
      );
    update.earn_rate = earnRate;
  }
  if (maxBill !== undefined) {
    if (typeof maxBill !== "number" || !(maxBill >= MAX_BILL_MIN && maxBill <= MAX_BILL_MAX))
      return NextResponse.json(
        { error: `Bill limit must be between ${MAX_BILL_MIN} and ${MAX_BILL_MAX}` },
        { status: 400 }
      );
    update.max_bill = maxBill;
  }
  if (reviewUrl !== undefined) {
    const r = parseReviewUrl(reviewUrl);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    update.review_url = r.value;
  }
  if (location !== undefined) {
    const r = parseLocation(location);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    update.latitude = r.value?.latitude ?? null;
    update.longitude = r.value?.longitude ?? null;
  }
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // The redeem route refuses any single earn above 1,000,000 points, so a rate x
  // limit pair above that would let the counter accept bills it then rejects
  // with a bare "Invalid amount". Check the pair as it will be after this save.
  if (update.earn_rate !== undefined || update.max_bill !== undefined) {
    const { data: cur } = await db.from("merchants").select("*").eq("id", owner.merchantId).single();
    const rate = update.earn_rate ?? Number(cur?.earn_rate ?? 1);
    const bill = update.max_bill ?? Number(cur?.max_bill ?? 1000);
    if (Math.round(rate * bill) > 1_000_000)
      return NextResponse.json(
        { error: `At ${rate} points per 1.00, the bill limit can be at most ${Math.floor(1_000_000 / rate)}` },
        { status: 400 }
      );
  }

  const { data, error } = await db
    .from("merchants")
    .update(update)
    .eq("id", owner.merchantId)
    .select("*")
    .single();
  if (error || !data) {
    console.error("settings update failed:", error?.message);
    return NextResponse.json({ error: "Could not save settings" }, { status: 500 });
  }
  // everything here but the bill limit is printed on the card
  if (Object.keys(update).some((k) => k !== "max_bill")) await refreshMerchantCards(owner.merchantId);
  return NextResponse.json(settings(data));
}
