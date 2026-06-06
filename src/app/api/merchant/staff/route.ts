import { NextRequest, NextResponse } from "next/server";
import { requireOwner, hashPassword } from "@/lib/auth";
import { db } from "@/lib/supabase";

export const runtime = "nodejs"; // bcrypt hashing — keep off edge

// GET /api/merchant/staff — list staff for the owner's merchant.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data } = await db
    .from("staff")
    .select("id, username, role, created_at")
    .eq("merchant_id", owner.merchantId)
    .order("created_at");

  return NextResponse.json({ staff: data ?? [], selfId: owner.id });
}

// POST /api/merchant/staff  body: { username, password } — add a cashier.
export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password)
    return NextResponse.json({ error: "Missing username or password" }, { status: 400 });

  const password_hash = await hashPassword(password);
  const { error } = await db.from("staff").insert({
    merchant_id: owner.merchantId,
    username: String(username).trim(),
    password_hash,
    role: "cashier",
  });

  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ error: "Username taken" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
