import { NextRequest, NextResponse } from "next/server";
import { hashPassword, isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { generatePassword, UUID_RE } from "@/lib/admin/merchant";

export const runtime = "nodejs"; // bcrypt hashing — keep off edge

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/staff/{id}/password — set a fresh generated password and
// return it once. Only the bcrypt hash is stored; it can't be shown again.
// Existing sessions of that user stay valid until they expire (12h).
export async function POST(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const password = generatePassword();
  const { data, error } = await db
    .from("staff")
    .update({ password_hash: await hashPassword(password) })
    .eq("id", id)
    .select("username");
  if (error) {
    console.error("admin password reset failed:", error.message);
    return NextResponse.json({ error: "Could not reset" }, { status: 500 });
  }
  if (!data?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ username: data[0].username, password });
}
