import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getStaff, signCardLink } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { PUBLIC_BASE_URL } from "@/lib/config";

export const runtime = "nodejs";

// POST /api/merchant/card-link  body: { serial } → { url, qrSvg, expiresInMinutes }
// Lost-card re-send. Signed on demand (not at page render) so the link is
// always fresh when shown. Opening the url on an iPhone re-issues the .pkpass
// (GET /api/enroll?card=…). Any logged-in staff, scoped to their merchant.
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  // A card link hands out the whole pass (incl. its Wallet auth token), so cap
  // how fast one staff session can mint them.
  const allowed = await rateLimit(`card-link:${staff.id}`, 30, 60);
  if (!allowed)
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const { serial } = await req.json().catch(() => ({}));
  if (typeof serial !== "string" || !serial)
    return NextResponse.json({ error: "No serial" }, { status: 400 });

  // Another merchant's serial → 404, same as a non-existent card (no IDOR).
  const { data } = await db
    .from("passes")
    .select("serial")
    .eq("serial", serial)
    .eq("merchant_id", staff.merchantId)
    .single();
  if (!data) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const url = `${PUBLIC_BASE_URL}/api/enroll?card=${await signCardLink(data.serial)}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1 });
  return NextResponse.json({ url, qrSvg, expiresInMinutes: 60 }); // signCardLink: 1h
}
