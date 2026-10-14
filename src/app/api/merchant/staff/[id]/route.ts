import { NextRequest, NextResponse } from "next/server";
import { requireOwner, hashPassword } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { SUPPORT_NO_PASSWORD, isSupportUsername } from "@/lib/admin/merchant";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/merchant/staff/{id} — remove a cashier, or the 42nights support
// login (the creator's next "Manage as owner" makes it again), in the owner's
// merchant.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === owner.id)
    return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });

  const { data: target } = await db
    .from("staff")
    .select("id, role, username")
    .eq("id", id)
    .eq("merchant_id", owner.merchantId)
    .single();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role !== "cashier" && !isSupportUsername(target.username))
    return NextResponse.json({ error: "Only cashiers can be removed" }, { status: 403 });

  const { error } = await db
    .from("staff")
    .delete()
    .eq("id", id)
    .eq("merchant_id", owner.merchantId);
  if (error) {
    console.error("staff update failed:", error.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

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
    .select("id, username")
    .eq("id", id)
    .eq("merchant_id", owner.merchantId)
    .single();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (isSupportUsername(target.username))
    return NextResponse.json({ error: SUPPORT_NO_PASSWORD }, { status: 400 });

  const password_hash = await hashPassword(password);
  const { error } = await db
    .from("staff")
    .update({ password_hash })
    .eq("id", id)
    .eq("merchant_id", owner.merchantId);
  if (error) {
    console.error("staff update failed:", error.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
