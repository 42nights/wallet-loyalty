import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/lib/supabase";
import { buildPass } from "@/lib/pass";

// POST /api/enroll  body: { name, phone, merchantId? }
// Creates the card row and returns the .pkpass (Safari shows "Add to Wallet").
export async function POST(req: NextRequest) {
  const { name, phone, merchantId } = await req.json().catch(() => ({}));

  const serial = randomUUID();
  const authToken = randomBytes(24).toString("hex");

  const { error } = await db.from("passes").insert({
    serial,
    merchant_id: merchantId ?? null,
    customer_name: name ?? null,
    customer_phone: phone ?? null,
    points: 0,
    auth_token: authToken,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const buffer = await buildPass({ serial, authToken, points: 0 });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="loyalty-${serial}.pkpass"`,
    },
  });
}
