import { NextRequest, NextResponse } from "next/server";
import { destroyAdminSession } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/admin/logout — posted by the plain <form> in the admin header, so
// it answers with a 303 back to the login page (no client JS needed). No
// session check: clearing a cookie is harmless, and an expired tab's "Log out"
// should land on the login page, not a raw 401.
export async function POST(req: NextRequest) {
  await destroyAdminSession();
  return NextResponse.redirect(new URL("/admin/login", req.url), 303);
}
