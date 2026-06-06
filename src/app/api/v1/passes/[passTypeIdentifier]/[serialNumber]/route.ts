import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { buildPass } from "@/lib/pass";

// GET /api/v1/passes/{passTypeId}/{serial}
// Auth: "Authorization: ApplePass {token}". Returns the freshly signed pass.

type Params = {
  params: Promise<{ passTypeIdentifier: string; serialNumber: string }>;
};

export async function GET(req: NextRequest, { params }: Params) {
  const { serialNumber } = await params;

  const { data: pass } = await db
    .from("passes")
    .select("serial, points, auth_token, updated_at")
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

  const buffer = await buildPass({
    serial: pass.serial,
    authToken: pass.auth_token,
    points: pass.points,
    updatedAt: new Date(pass.updated_at),
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Last-Modified": new Date(pass.updated_at).toUTCString(),
    },
  });
}
