import { NextRequest, NextResponse } from "next/server";
import { requireOwner, hashPassword } from "@/lib/auth";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/merchant/staff/{id} — remove a cashier in the owner's merchant.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === owner.id)
    return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });

  const { data: target } = await db
    .from("staff")
    .select("id, role")
    .eq("id", id)
    .eq("merchant_id", owner.merchantId)
    .single();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role !== "cashier")
    return NextResponse.json({ error: "Only cashiers can be removed" }, { status: 403 });

  const { error } = await db
    .from("staff")
    .delete()
    .eq("id", id)
    .eq("merchant_id", owner.merchantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// PATCH /api/merchant/staff/{id}  body: { password } — reset a password.
export async function PATCH(req: NextRequest, { params }: Params) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { password } = await req.json().catch(() => ({}));
  if (!password)
    return NextResponse.json({ error: "Missing password" }, { status: 400 });

  const { data: target } = await db
    .from("staff")
    .select("id")
    .eq("id", id)
    .eq("merchant_id", owner.merchantId)
    .single();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const password_hash = await hashPassword(password);
  const { error } = await db
    .from("staff")
    .update({ password_hash })
    .eq("id", id)
    .eq("merchant_id", owner.merchantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
