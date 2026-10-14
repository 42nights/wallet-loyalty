import { NextRequest, NextResponse } from "next/server";
import { createSession, hashPassword, isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { UUID_RE, generatePassword, supportUsername } from "@/lib/admin/merchant";

export const runtime = "nodejs"; // bcrypt hashing — keep off edge

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/merchants/{id}/manage — "Manage as owner". Posted by a plain
// <form> on the admin merchant page; signs the creator in to the staff app as
// the shop's 42nights support login (an owner row of that shop, created on the
// first click) and 303s to /dashboard. Everything done there carries the
// support row's staff id, never the real owner's. POST only: the admin cookie
// is SameSite=Lax, so another site can't post this with it.
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: m } = await db.from("merchants").select("id, slug").eq("id", id).maybeSingle();
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const username = supportUsername(m);
  // role too: a same-shop cashier that held this name before the prefix was
  // reserved has a password a real person knows — never sign in as that row.
  const find = () =>
    db.from("staff").select("id").eq("username", username).eq("merchant_id", m.id).eq("role", "owner").maybeSingle();
  let { data: row } = await find();
  if (!row) {
    // A random password nobody ever sees: the row can't be signed in to at /login.
    const { error } = await db.from("staff").insert({
      merchant_id: m.id,
      username,
      password_hash: await hashPassword(generatePassword(32)),
      role: "owner",
    });
    // 23505 = the name exists: a double-click's other request just made it
    // (found below), or it belongs to another shop's row (never sign in as that).
    if (error && error.code !== "23505") {
      console.error("support login create failed:", error.message);
      return NextResponse.json({ error: "Could not create the support login" }, { status: 500 });
    }
    ({ data: row } = await find());
    if (!row)
      return NextResponse.json({ error: `The username ${username} belongs to another shop's login` }, { status: 409 });
  }

  await createSession({ id: row.id, username, merchantId: m.id, role: "owner" });
  return NextResponse.redirect(new URL("/dashboard", req.url), 303);
}
