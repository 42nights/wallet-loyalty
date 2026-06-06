import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

// GET /api/v1/devices/{deviceLibId}/registrations/{passTypeId}?passesUpdatedSince=TAG
// Returns serials updated since the tag. Tag here = ISO timestamp.

type Params = {
  params: Promise<{
    deviceLibraryIdentifier: string;
    passTypeIdentifier: string;
  }>;
};

export async function GET(req: NextRequest, { params }: Params) {
  const { deviceLibraryIdentifier } = await params;
  const since = req.nextUrl.searchParams.get("passesUpdatedSince");

  // serials this device is registered for
  const { data: regs } = await db
    .from("registrations")
    .select("serial")
    .eq("device_lib_id", deviceLibraryIdentifier);

  const serials = (regs ?? []).map((r) => r.serial);
  if (!serials.length) return new NextResponse(null, { status: 204 });

  let q = db
    .from("passes")
    .select("serial, updated_at")
    .in("serial", serials);
  if (since) q = q.gt("updated_at", since);

  const { data: passes } = await q;
  const changed = passes ?? [];
  if (!changed.length) return new NextResponse(null, { status: 204 });

  const lastUpdated = changed
    .map((p) => p.updated_at)
    .sort()
    .at(-1)!;

  return NextResponse.json({
    serialNumbers: changed.map((p) => p.serial),
    lastUpdated,
  });
}
