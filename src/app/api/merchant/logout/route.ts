import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/merchant/logout — posted by the plain <form> in the staff header,
// so it answers with a 303 to /login (the browser follows it as a GET). No
// session check: clearing a cookie is harmless, and an expired tab's "Sign out"
// should land on the login page, not a raw 401. Matters on shared counter
// tablets where the owner and a cashier use the same device.
export async function POST(req: NextRequest) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
