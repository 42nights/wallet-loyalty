import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { safeEqual } from "@/lib/safeEqual";

export const runtime = "nodejs";

// Apple calls these on the path built from the pass's webServiceURL:
//   POST   /api/v1/devices/{deviceLibId}/registrations/{passTypeId}/{serial}
//   DELETE /api/v1/devices/{deviceLibId}/registrations/{passTypeId}/{serial}
// Auth header: "Authorization: ApplePass {authenticationToken}"

type Params = {
  params: Promise<{
    deviceLibraryIdentifier: string;
    passTypeIdentifier: string;
    serialNumber: string;
  }>;
};

async function authOk(req: NextRequest, serial: string): Promise<boolean> {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^ApplePass\s+/i, "");
  if (!token) return false;
  const { data } = await db
    .from("passes")
    .select("auth_token")
    .eq("serial", serial)
    .single();
  return !!data && safeEqual(token, data.auth_token);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { deviceLibraryIdentifier, serialNumber } = await params;
  if (!(await authOk(req, serialNumber)))
    return new NextResponse("Unauthorized", { status: 401 });

  const { pushToken } = await req.json().catch(() => ({}));
  if (!pushToken) return new NextResponse("Bad Request", { status: 400 });

  // upsert device + registration
  await db
    .from("devices")
    .upsert({ device_lib_id: deviceLibraryIdentifier, push_token: pushToken });

  const { data: existing } = await db
    .from("registrations")
    .select("serial")
    .eq("device_lib_id", deviceLibraryIdentifier)
    .eq("serial", serialNumber)
    .maybeSingle();

  await db.from("registrations").upsert({
    device_lib_id: deviceLibraryIdentifier,
    serial: serialNumber,
  });

  // 201 = newly registered, 200 = already had it
  return new NextResponse(null, { status: existing ? 200 : 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { deviceLibraryIdentifier, serialNumber } = await params;
  if (!(await authOk(req, serialNumber)))
    return new NextResponse("Unauthorized", { status: 401 });

  await db
    .from("registrations")
    .delete()
    .eq("device_lib_id", deviceLibraryIdentifier)
    .eq("serial", serialNumber);

  return new NextResponse(null, { status: 200 });
}
