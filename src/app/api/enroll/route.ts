import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/lib/supabase";
import { wallet, type PassData } from "@/lib/wallet";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyCardLink } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/enroll  body: { name, phone, slug }
// Resolves slug → merchant, creates the card, returns the .pkpass.
export async function POST(req: NextRequest) {
  // Public + does expensive signing → rate-limit by IP to prevent abuse/DoS.
  const allowed = await rateLimit(`enroll:${clientIp(req)}`, 20, 60);
  if (!allowed)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { name, phone, email, consent, slug } = await req.json().catch(() => ({}));
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
  const emailNorm =
    typeof email === "string" && email.trim() ? email.trim() : null;
  const hasConsent = consent === true;

  const serial = randomUUID();
  const authToken = randomBytes(24).toString("hex");

  const { error } = await db.from("passes").insert({
    serial,
    merchant_id: merchant.id,
    customer_name: name ?? null,
    customer_phone: phoneNorm,
    customer_email: emailNorm,
    marketing_consent: hasConsent,
    consent_at: hasConsent ? new Date().toISOString() : null,
    consent_source: hasConsent ? "enroll_form" : null,
    points: 0,
    auth_token: authToken,
  });

  if (error) {
    // 23505 = unique violation on (merchant_id, customer_phone) = already enrolled.
    // Do NOT return the existing card here: the caller is unauthenticated and a
    // phone number is guessable, so re-issuing would leak that customer's signed
    // pass + auth token to anyone who knows their number. Re-sending a lost card
    // must go through staff (an authenticated path).
    if (error.code === "23505" && phoneNorm)
      return NextResponse.json(
        { error: "This phone is already enrolled here — ask staff to re-send your card." },
        { status: 409 }
      );
    return NextResponse.json({ error: "Could not create card" }, { status: 500 });
  }

  return passResponse({ serial, merchantId: merchant.id, points: 0, authToken });
}

export async function GET(req: NextRequest) {
  const serial = await verifyCardLink(req.nextUrl.searchParams.get("card") ?? "");
  if (!serial)
    return new NextResponse("This card link has expired. Ask staff for a new one.", { status: 410 });

  const { data: pass } = await db.from("passes").select("*").eq("serial", serial).single();
  if (!pass) return new NextResponse("Card not found", { status: 404 });

  return passResponse({
    serial,
    merchantId: pass.merchant_id,
    points: pass.points,
    authToken: pass.auth_token,
    updatedAt: new Date(pass.updated_at),
    offerText: pass.offer_text ?? null,
  });
}

async function passResponse(data: PassData) {
  const { buffer, contentType } = await wallet.buildPass(data);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="loyalty-${data.serial}.pkpass"`,
    },
  });
}
