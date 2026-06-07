import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// POST /api/v1/log  — Apple posts {"logs": [...]} here when devices hit errors.
// Useful for debugging "why isn't my pass updating".
export async function POST(req: NextRequest) {
  // Unauthenticated by Apple's spec. Cap count + strip newlines so a caller
  // can't spam logs or forge log lines (log injection).
  const body = await req.json().catch(() => ({ logs: [] }));
  const logs = Array.isArray(body.logs) ? body.logs.slice(0, 50) : [];
  for (const line of logs) {
    console.log("[wallet]", String(line).replace(/[\r\n]+/g, " ").slice(0, 1000));
  }
  return new NextResponse(null, { status: 200 });
}
