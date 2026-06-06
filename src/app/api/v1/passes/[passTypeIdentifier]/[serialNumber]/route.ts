import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { wallet } from "@/lib/wallet";

// GET /api/v1/passes/{passTypeId}/{serial}
// Auth: "Authorization: ApplePass {token}". Returns the freshly signed pass.

type Params = {
  params: Promise<{ passTypeIdentifier: string; serialNumber: string }>;
};

export async function GET(req: NextRequest, { params }: Params) {
  const { serialNumber } = await params;

  const { data: pass } = await db
    .from("passes")
    .select("serial, merchant_id, points, auth_token, updated_at")
    .eq("serial", serialNumber)
    .single();
  if (!pass) return new NextResponse("Not found", { status: 404 });

  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^ApplePass\s+/i, "");
  if (token !== pass.auth_token)
    return new NextResponse("Unauthorized", { status: 401 });

  // If-Modified-Since support → 304 when nothing changed
  const ims = req.headers.get("if-modified-since");
  if (ims && new Date(pass.updated_at) <= new Date(ims)) {
    return new NextResponse(null, { status: 304 });
  }

  const { buffer, contentType } = await wallet.buildPass({
    serial: pass.serial,
    merchantId: pass.merchant_id,
    points: pass.points,
    authToken: pass.auth_token,
    updatedAt: new Date(pass.updated_at),
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Last-Modified": new Date(pass.updated_at).toUTCString(),
    },
  });
}
