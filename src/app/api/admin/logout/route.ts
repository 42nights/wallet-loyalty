import { NextRequest, NextResponse } from "next/server";
import { destroyAdminSession, isAdmin } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/admin/logout — posted by the plain <form> in the admin header, so
// it answers with a 303 back to the login page (no client JS needed). Like
// every /api/admin/* route except login, it is 401 without a valid session.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await destroyAdminSession();
  return NextResponse.redirect(new URL("/admin/login", req.url), 303);
}
