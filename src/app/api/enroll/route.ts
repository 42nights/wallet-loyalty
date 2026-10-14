import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/lib/supabase";
import { wallet } from "@/lib/wallet";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { signCardLink, verifyCardLink } from "@/lib/auth";
import { PUBLIC_BASE_URL } from "@/lib/config";
import { validateEnroll } from "./validate";
import { assertPassConfig } from "@/lib/config";

export const runtime = "nodejs";

// POST /api/enroll  body: { name, phone, email?, consent?, slug }
// Resolves slug → merchant, validates the fields, creates the card and returns
// JSON { cardUrl }: a 1-hour signed link to the GET below, which serves the
// .pkpass. A link instead of the binary lets the page decide per device: an
// iPhone navigates to it and the Wallet sheet opens; any other device shows it
// as a QR to scan with the iPhone, so a desktop or Android visit no longer uses
// up the phone number on a card that cannot be added there (apple-wallet#1).
export async function POST(req: NextRequest) {
  try {
    assertPassConfig();
  } catch (e) {
    console.error("enroll disabled:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Sign-up is temporarily unavailable." }, { status: 503 });
  }

  // Public + creates rows → rate-limit by IP to prevent abuse.
  const allowed = await rateLimit(`enroll:${clientIp(req)}`, 20, 60);
  if (!allowed)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = (await req.json().catch(() => null)) ?? {};
  const { consent, slug } = body;
  if (!slug) return NextResponse.json({ error: "No merchant" }, { status: 400 });

  // `error` carries the first message for simple clients; `fields` maps each
  // bad field to its own message for the form's inline errors.
  const check = validateEnroll(body);
  if (!check.ok)
    return NextResponse.json(
      { error: Object.values(check.errors)[0], fields: check.errors },
      { status: 400 }
    );
  const { name, phone, email } = check.value;

  const { data: merchant } = await db
    .from("merchants")
    .select("id")
    .eq("slug", slug)
    .single();
  if (!merchant)
    return NextResponse.json({ error: "Unknown merchant" }, { status: 404 });

  const hasConsent = consent === true;
  const serial = randomUUID();
  const authToken = randomBytes(24).toString("hex");

  const { error } = await db.from("passes").insert({
    serial,
    merchant_id: merchant.id,
    customer_name: name,
    customer_phone: phone, // normalised, so the unique index catches format variants
    customer_email: email,
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
    if (error.code === "23505")
      return NextResponse.json(
        {
          error:
            "Good news: this number already has a card here. Ask a team member and they will send it to you again.",
        },
        { status: 409 }
      );
    return NextResponse.json({ error: "Could not create card" }, { status: 500 });
  }

  const cardUrl = `${PUBLIC_BASE_URL}/api/enroll?card=${await signCardLink(serial)}`;
  return NextResponse.json({ cardUrl });
}

// GET /api/enroll?card=<signed link>  → the signed .pkpass. Used by the enroll
// page's cardUrl and by staff "re-send card" links.
export async function GET(req: NextRequest) {
  // Each hit signs a pass, and a link stays valid for an hour → cap replays.
  if (!(await rateLimit(`enroll-get:${clientIp(req)}`, 30, 60)))
    return new NextResponse("Too many requests", { status: 429 });

  const serial = await verifyCardLink(req.nextUrl.searchParams.get("card") ?? "");
  if (!serial)
    return new NextResponse("This card link has expired. Ask staff for a new one.", { status: 410 });

  const { data: pass } = await db.from("passes").select("*").eq("serial", serial).single();
  if (!pass) return new NextResponse("Card not found", { status: 404 });

  const { buffer, contentType } = await wallet.buildPass({
    serial,
    merchantId: pass.merchant_id,
    points: pass.points,
    authToken: pass.auth_token,
    updatedAt: new Date(pass.updated_at),
    offerText: pass.offer_text ?? null,
    customerName: pass.customer_name ?? null,
  });
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="loyalty-${serial}.pkpass"`,
    },
  });
}
