import { NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/merchant/me — the logged-in staff's identity + their merchant config.
export async function GET() {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  const { data: merchant } = await db
    .from("merchants")
    .select("name, earn_rate")
    .eq("id", staff.merchantId)
    .single();
  if (!merchant)
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  return NextResponse.json({
    username: staff.username,
    role: staff.role,
    merchantName: merchant.name,
    earnRate: Number(merchant.earn_rate),
  });
}
