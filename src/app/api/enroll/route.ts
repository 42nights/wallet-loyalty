import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/lib/supabase";
import { wallet } from "@/lib/wallet";

export const runtime = "nodejs";

// POST /api/enroll  body: { name, phone, slug }
// Resolves slug → merchant, creates (or re-uses) the card, returns the .pkpass.
export async function POST(req: NextRequest) {
  const { name, phone, slug } = await req.json().catch(() => ({}));
  if (!slug) return NextResponse.json({ error: "No merchant" }, { status: 400 });

  const { data: merchant } = await db
    .from("merchants")
    .select("id")
    .eq("slug", slug)
    .single();
  if (!merchant)
    return NextResponse.json({ error: "Unknown merchant" }, { status: 404 });

  const phoneNorm =
    typeof phone === "string" && phone.trim() ? phone.trim() : null;

  // Resolve to a card: try to create one; if this phone already has a card with
  // this merchant (partial unique index), re-issue the existing card instead.
  let serial = randomUUID();
  let authToken = randomBytes(24).toString("hex");
  let points = 0;

  const { error } = await db.from("passes").insert({
    serial,
    merchant_id: merchant.id,
    customer_name: name ?? null,
    customer_phone: phoneNorm,
    points: 0,
    auth_token: authToken,
  });

  if (error) {
    // 23505 = unique violation on (merchant_id, customer_phone) → existing card
    if (error.code === "23505" && phoneNorm) {
      const { data: existing } = await db
        .from("passes")
        .select("serial, auth_token, points")
        .eq("merchant_id", merchant.id)
        .eq("customer_phone", phoneNorm)
        .single();
      if (!existing)
        return NextResponse.json({ error: error.message }, { status: 500 });
      serial = existing.serial;
      authToken = existing.auth_token;
      points = existing.points;
    } else {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { buffer, contentType } = await wallet.buildPass({
    serial,
    merchantId: merchant.id,
    points,
    authToken,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="loyalty-${serial}.pkpass"`,
    },
  });
}
