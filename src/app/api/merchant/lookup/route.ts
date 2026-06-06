import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST /api/merchant/lookup  body: { serial }
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  const allowed = await rateLimit(`lookup:${staff.id}`, 120, 60);
  if (!allowed)
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const { serial } = await req.json().catch(() => ({}));
  if (!serial) return NextResponse.json({ error: "No serial" }, { status: 400 });

  // Scope to the cashier's merchant. A serial from another café returns 404 —
  // same as a non-existent card, so we never leak its existence (no IDOR).
  const { data } = await db
    .from("passes")
    .select("serial, customer_name, points")
    .eq("serial", serial)
    .eq("merchant_id", staff.merchantId)
    .single();

  if (!data) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({
    serial: data.serial,
    name: data.customer_name,
    points: data.points,
  });
}
