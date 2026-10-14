import { NextRequest, NextResponse } from "next/server";
import { createAdminSession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { safeEqual } from "@/lib/safeEqual";

export const runtime = "nodejs"; // node:crypto (safeEqual)

// POST /api/admin/login  body: { password } — the creator's own login.
export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected)
    return NextResponse.json({ error: "Admin is disabled: ADMIN_PASSWORD is not set" }, { status: 503 });

  // Counted before anything else so malformed attempts also burn the budget.
  // There is no username, so per-IP is the only key: 5 tries / minute.
  const allowed = await rateLimit(`admin-login:${clientIp(req)}`, 5, 60);
  if (!allowed)
    return NextResponse.json({ error: "Too many attempts, try again in a minute" }, { status: 429 });

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || !password)
    return NextResponse.json({ error: "Missing password" }, { status: 400 });
  if (!safeEqual(password, expected))
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });

  await createAdminSession();
  return NextResponse.json({ ok: true });
}
