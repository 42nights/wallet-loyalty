import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { MIN_PHONE_DIGITS, digitsOf, maskPhone, phoneMatches, phoneSuffixPattern } from "./phone";

export const runtime = "nodejs";

// POST /api/merchant/lookup
//   body: { serial } → { serial, name, points, voided }            (QR scan / manual serial)
//   body: { phone }  → { matches: [{ serial, name, phone, points, voided }] }  (≤ 5, phone masked)
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  const allowed = await rateLimit(`lookup:${staff.id}`, 120, 60);
  if (!allowed)
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const { serial, phone } = await req.json().catch(() => ({}));

  if (!serial && typeof phone === "string") {
    const typed = digitsOf(phone);
    if (typed.length < MIN_PHONE_DIGITS)
      return NextResponse.json(
        { error: `Enter at least ${MIN_PHONE_DIGITS} digits` },
        { status: 400 }
      );

    // Same merchant scoping as the serial path. The regex narrows to phones
    // ending in the same last 4 digits; phoneMatches() then compares digits.
    // ponytail: reads at most 50 phones sharing the last 4 digits (the most
    // recently active first); that ceiling only bites at hundreds of thousands
    // of cards per merchant — then store a digits-only phone column + index.
    const { data, error } = await db
      .from("passes")
      .select("*") // "*": a database without passes.voided_at still answers
      .eq("merchant_id", staff.merchantId)
      .regexMatch("customer_phone", phoneSuffixPattern(typed))
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("phone lookup failed:", error.message);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    const matches = data
      .filter((p) => phoneMatches(p.customer_phone, typed))
      .slice(0, 5)
      .map((p) => ({
        serial: p.serial,
        name: p.customer_name,
        phone: maskPhone(p.customer_phone),
        points: p.points,
        voided: Boolean(p.voided_at),
      }));
    return NextResponse.json({ matches });
  }

  if (!serial) return NextResponse.json({ error: "No serial" }, { status: 400 });

  // Scope to the cashier's merchant. A serial from another café returns 404 —
  // same as a non-existent card, so we never leak its existence (no IDOR).
  const { data } = await db
    .from("passes")
    .select("*")
    .eq("serial", serial)
    .eq("merchant_id", staff.merchantId)
    .single();

  if (!data) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({
    serial: data.serial,
    name: data.customer_name,
    points: data.points,
    voided: Boolean(data.voided_at), // /scan shows it as deactivated, no buttons
  });
}
