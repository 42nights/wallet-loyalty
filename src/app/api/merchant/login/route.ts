import { NextRequest, NextResponse } from "next/server";
import { verifyLogin, createSession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs"; // bcrypt hashing — keep off edge

// POST /api/merchant/login  body: { username, password }
export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password)
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });

  // throttle brute force: 10 attempts / minute per IP+username
  const allowed = await rateLimit(`login:${clientIp(req)}:${username}`, 10, 60);
  if (!allowed)
    return NextResponse.json({ error: "Too many attempts, try later" }, { status: 429 });

  const staff = await verifyLogin(username, password);
  if (!staff)
    return NextResponse.json({ error: "Invalid login" }, { status: 401 });

  await createSession(staff);
  return NextResponse.json({ ok: true, username: staff.username });
}
