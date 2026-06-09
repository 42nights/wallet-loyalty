import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { wallet } from "@/lib/wallet";
import { safeEqual } from "@/lib/safeEqual";

export const runtime = "nodejs"; // signs a pass — passkit needs Node, not edge

// GET /api/v1/passes/{passTypeId}/{serial}
// Auth: "Authorization: ApplePass {token}". Returns the freshly signed pass.

type Params = {
  params: Promise<{ passTypeIdentifier: string; serialNumber: string }>;
};

export async function GET(req: NextRequest, { params }: Params) {
  const { serialNumber } = await params;

  const { data: pass } = await db
    .from("passes")
    .select("serial, merchant_id, points, auth_token, updated_at, offer_text")
    .eq("serial", serialNumber)
    .single();
  if (!pass) return new NextResponse("Not found", { status: 404 });

  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^ApplePass\s+/i, "");
  if (!token || !safeEqual(token, pass.auth_token))
    return new NextResponse("Unauthorized", { status: 401 });

  // NOTE: deliberately no If-Modified-Since/304 handling. updated_at and a
  // Last-Modified header are only second-resolution, so two taps in the same
  // second would yield a 304 and leave a STALE balance on the card. The pass is
  // tiny — always re-sign and return 200.
  const { buffer, contentType } = await wallet.buildPass({
    serial: pass.serial,
    merchantId: pass.merchant_id,
    points: pass.points,
    authToken: pass.auth_token,
    updatedAt: new Date(pass.updated_at),
    offerText: pass.offer_text,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Last-Modified": new Date(pass.updated_at).toUTCString(),
    },
  });
}
