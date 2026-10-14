import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/v1/devices/{deviceLibId}/registrations/{passTypeId}?passesUpdatedSince=TAG
// Returns serials updated since the tag.
//
// The tag is opaque to Wallet: whatever lastUpdated we return, the device sends
// back verbatim next time. It is the newest updated_at at full (microsecond)
// precision, written with "Z" instead of "+00:00": the old tag kept the '+',
// which decodes to a space if the device sends it unencoded — Postgres then
// rejected the filter, the error was ignored and the route answered 204
// "nothing changed" forever, a silent dead update loop.

type Params = {
  params: Promise<{
    deviceLibraryIdentifier: string;
    passTypeIdentifier: string;
  }>;
};

// Tag → timestamp for the filter, kept as a string so Postgres compares at full
// precision. Old tags still held by devices get their '+' back if it arrived
// as ' '. Anything unparseable → null = "send everything": a spurious
// re-download is harmless, a missed update is not.
function sinceFromTag(tag: string | null): string | null {
  if (!tag) return null;
  const t = tag.trim().replace(" ", "+");
  return Number.isFinite(Date.parse(t)) ? t : null;
}

// PostgREST renders timestamptz in UTC as "…+00:00"; swap to "Z" so the tag
// has no '+'. Any other offset (not expected) falls back to millisecond ISO.
function tagFromTimestamp(ts: string): string {
  const z = ts.replace(/\+00:00$/, "Z");
  return z.includes("+") ? new Date(Date.parse(ts)).toISOString() : z;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { deviceLibraryIdentifier } = await params;
  const since = sinceFromTag(req.nextUrl.searchParams.get("passesUpdatedSince"));

  // serials this device is registered for
  const { data: regs, error: regErr } = await db
    .from("registrations")
    .select("serial")
    .eq("device_lib_id", deviceLibraryIdentifier);
  if (regErr) return new NextResponse(null, { status: 500 });

  const serials = (regs ?? []).map((r) => r.serial);
  if (!serials.length) return new NextResponse(null, { status: 204 });

  let q = db
    .from("passes")
    .select("serial, updated_at")
    .in("serial", serials);
  if (since) q = q.gt("updated_at", since);

  // A failed query must not read as "no changes" (see above) — 500 makes the
  // device retry later instead of silently skipping the update.
  const { data: passes, error } = await q;
  if (error) return new NextResponse(null, { status: 500 });
  const changed = passes ?? [];
  if (!changed.length) return new NextResponse(null, { status: 204 });

  // Newest updated_at. Date.parse only has millisecond precision, so ties
  // within a millisecond are broken on the string (same format, so lexical
  // order matches time order down to the microsecond).
  const newest = changed
    .map((p) => p.updated_at as string)
    .reduce((a, b) => {
      const d = Date.parse(b) - Date.parse(a);
      return d > 0 || (d === 0 && b > a) ? b : a;
    });

  return NextResponse.json({
    serialNumbers: changed.map((p) => p.serial),
    lastUpdated: tagFromTimestamp(newest),
  });
}
