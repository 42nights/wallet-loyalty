import { NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { redemptionsFor, templateKey } from "@/lib/config";

export const runtime = "nodejs";

// GET /api/merchant/me — the logged-in staff's identity + their merchant config.
export async function GET() {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  const { data: merchant } = await db
    .from("merchants")
    .select("*")
    .eq("id", staff.merchantId)
    .single();
  if (!merchant)
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  return NextResponse.json({
    username: staff.username,
    role: staff.role,
    merchantName: merchant.name,
    earnRate: Number(merchant.earn_rate),
    // largest bill one earn may carry: /scan flags a bigger one while it's typed
    // (the redeem route still refuses it). 1000 = schema default, as there.
    maxBill: Number(merchant.max_bill ?? 1000),
    template: templateKey(merchant.redeem_template),
    redemptions: redemptionsFor(merchant.redeem_template),
  });
}
