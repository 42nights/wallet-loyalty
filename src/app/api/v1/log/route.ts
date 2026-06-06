import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// POST /api/v1/log  — Apple posts {"logs": [...]} here when devices hit errors.
// Useful for debugging "why isn't my pass updating".
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ logs: [] }));
  for (const line of body.logs ?? []) console.log("[wallet]", line);
  return new NextResponse(null, { status: 200 });
}
