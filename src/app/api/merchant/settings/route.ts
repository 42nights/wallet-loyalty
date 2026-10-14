import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { PUBLIC_BASE_URL, REDEEM_TEMPLATES, templateKey } from "@/lib/config";

export const runtime = "nodejs";

// points per 1 unit of currency. The settings form mirrors these as input
// min/max; this route is the authority.
const EARN_RATE_MIN = 0.1;
// The redeem route caps one earn at 1,000,000 points, so at rate r any bill above
// 1,000,000 / r is refused at the counter. 100 keeps bills up to 10,000 working.
const EARN_RATE_MAX = 100;
// largest bill one earn may carry (merchants.max_bill, enforced by the redeem route)
const MAX_BILL_MIN = 10;
const MAX_BILL_MAX = 100_000;

type MerchantRow = {
  name: string;
  slug: string | null;
  earn_rate: number | string;
  redeem_template?: string | null;
  max_bill?: number | string | null;
};

function settings(m: MerchantRow) {
  return {
    merchantName: m.name,
    template: templateKey(m.redeem_template),
    earnRate: Number(m.earn_rate),
    maxBill: Number(m.max_bill ?? 1000), // 1000 = schema default (un-migrated database)
    enrollUrl: m.slug ? `${PUBLIC_BASE_URL}/enroll/${m.slug}` : null,
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

// PATCH /api/merchant/settings  body: { template?, earnRate?, maxBill? }
// Strict: an unknown template or out-of-range rate is a 400, never silently
// defaulted — the owner must see that their change did not take.
export async function PATCH(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { template, earnRate, maxBill } = await req.json().catch(() => ({}));
  const update: { redeem_template?: string; earn_rate?: number; max_bill?: number } = {};

  if (template !== undefined) {
    if (typeof template !== "string" || !Object.hasOwn(REDEEM_TEMPLATES, template))
      return NextResponse.json({ error: "Unknown template" }, { status: 400 });
    update.redeem_template = template;
  }
  if (earnRate !== undefined) {
    if (typeof earnRate !== "number" || !(earnRate >= EARN_RATE_MIN && earnRate <= EARN_RATE_MAX))
      return NextResponse.json(
        { error: `Earn rate must be between ${EARN_RATE_MIN} and ${EARN_RATE_MAX}` },
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
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

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
  return NextResponse.json(settings(data));
}
