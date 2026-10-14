import { NextRequest, NextResponse } from "next/server";
import { hashPassword, isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { PUBLIC_BASE_URL } from "@/lib/config";
import { isSupportUsername, merchantFields, MIN_PASSWORD, SLUG_RE, SUPPORT_RESERVED, USERNAME_RE } from "@/lib/admin/merchant";

export const runtime = "nodejs"; // bcrypt hashing — keep off edge

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// GET /api/admin/merchants?slug=x — live "is this enroll link free?" check
// for the onboarding wizard.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  if (!SLUG_RE.test(slug)) return NextResponse.json({ valid: false, available: false });
  const { data, error } = await db.from("merchants").select("id").eq("slug", slug).maybeSingle();
  if (error) return NextResponse.json({ error: "Query failed" }, { status: 500 });
  return NextResponse.json({ valid: true, available: !data });
}

type Login = { username: string; password: string; role: "owner" | "cashier" };

function login(v: unknown, role: Login["role"]): Login | string {
  const o = (v ?? {}) as Record<string, unknown>;
  const username = typeof o.username === "string" ? o.username.trim() : "";
  const password = typeof o.password === "string" ? o.password : "";
  if (!USERNAME_RE.test(username))
    return `${role} username must be 3-40 characters: lowercase letters, digits, . _ -`;
  if (isSupportUsername(username)) return SUPPORT_RESERVED;
  if (password.length < MIN_PASSWORD || password.length > 128)
    return `${role} password must be at least ${MIN_PASSWORD} characters`;
  return { username, password, role };
}

// POST /api/admin/merchants — create a merchant + its owner (+ optional
// cashier) in one go.
// body: { name, slug, template, earnRate, bgColor, fgColor, labelColor,
//         owner: { username, password }, cashier?: { username, password } }
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // No rate x bill-limit check here (PATCH has one): a new merchant starts at
  // the schema default max_bill of 1000, and EARN_RATE.max (100) x 1000 is
  // 100,000 points, well under the redeem route's 1,000,000 per-earn cap.
  const fields = merchantFields(b, false);
  if (typeof fields === "string") return NextResponse.json({ error: fields }, { status: 400 });
  const slug = typeof b.slug === "string" ? b.slug : "";
  if (!SLUG_RE.test(slug))
    return NextResponse.json({ error: "Link name must be lowercase letters, digits and dashes" }, { status: 400 });

  const raw: [unknown, Login["role"]][] = [[b.owner, "owner"]];
  if (b.cashier) raw.push([b.cashier, "cashier"]);
  const logins: Login[] = [];
  for (const [v, role] of raw) {
    const l = login(v, role);
    if (typeof l === "string") return NextResponse.json({ error: l }, { status: 400 });
    logins.push(l);
  }
  if (logins.length === 2 && logins[0].username === logins[1].username)
    return NextResponse.json({ error: "Owner and cashier need different usernames" }, { status: 400 });

  // Friendly conflicts up front. The unique constraints below still decide
  // races (23505), these just give a precise message in the common case.
  const usernames = logins.map((l) => l.username);
  const [slugTaken, userTaken] = await Promise.all([
    db.from("merchants").select("id").eq("slug", slug).maybeSingle(),
    db.from("staff").select("username").in("username", usernames),
  ]);
  if (slugTaken.data) return NextResponse.json({ error: `The link /enroll/${slug} is taken` }, { status: 409 });
  if (userTaken.data?.length)
    return NextResponse.json({ error: `Username taken: ${userTaken.data.map((r) => r.username).join(", ")}` }, { status: 409 });

  // Hash before inserting so the merchant never sits without its staff for
  // the ~0.5s bcrypt takes.
  const hashed = await Promise.all(logins.map(async (l) => ({ ...l, hash: await hashPassword(l.password) })));

  const { data: merchant, error } = await db.from("merchants").insert({ ...fields, slug }).select("id").single();
  if (error || !merchant) {
    if (error?.code === "23505") return NextResponse.json({ error: `The link /enroll/${slug} is taken` }, { status: 409 });
    console.error("admin merchant create failed:", error?.message);
    return NextResponse.json({ error: "Could not create merchant" }, { status: 500 });
  }

  // One multi-row insert = one statement, so it's all-or-nothing. If it fails,
  // remove the merchant again rather than leave one nobody can log in to.
  const { error: staffErr } = await db.from("staff").insert(
    hashed.map((l) => ({ merchant_id: merchant.id, username: l.username, password_hash: l.hash, role: l.role }))
  );
  if (staffErr) {
    await db.from("merchants").delete().eq("id", merchant.id);
    if (staffErr.code === "23505") return NextResponse.json({ error: "A username was just taken, pick another" }, { status: 409 });
    console.error("admin staff create failed:", staffErr.message);
    return NextResponse.json({ error: "Could not create logins" }, { status: 500 });
  }

  return NextResponse.json(
    { id: merchant.id, slug, enrollUrl: `${PUBLIC_BASE_URL}/enroll/${slug}`, loginUrl: `${PUBLIC_BASE_URL}/login` },
    { status: 201 }
  );
}
