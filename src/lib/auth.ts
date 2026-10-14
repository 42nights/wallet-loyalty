import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "./supabase";

const COOKIE = "staff_session";

// Resolved lazily (not at import) so `next build` doesn't need the env, but a
// missing secret in production is a hard error — never sign/verify with a known
// constant in prod (that would let anyone forge a session).
function secretKey(purpose = ""): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production")
      throw new Error("SESSION_SECRET is not set");
    return new TextEncoder().encode("dev-only-insecure-secret" + purpose);
  }
  return new TextEncoder().encode(s + purpose);
}

export type Role = "owner" | "cashier";
export type Staff = {
  id: string;
  username: string;
  merchantId: string | null;
  role: Role;
};

export async function verifyLogin(
  username: string,
  password: string
): Promise<Staff | null> {
  const { data, error } = await db
    .from("staff")
    .select("id, username, merchant_id, password_hash, role")
    .eq("username", username)
    .single();
  if (error || !data) return null;
  const ok = await bcrypt.compare(password, data.password_hash);
  if (!ok) return null;
  return {
    id: data.id,
    username: data.username,
    merchantId: data.merchant_id,
    role: (data.role as Role) ?? "cashier",
  };
}

export async function createSession(staff: Staff): Promise<void> {
  const token = await new SignJWT({ ...staff })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("12h")
    .setIssuedAt()
    .sign(secretKey());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function getStaff(): Promise<Staff | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    // The staff row, not the 12h cookie, decides: a cashier the owner removed
    // is signed out on their next request instead of keeping /scan until the
    // cookie expires.
    const { data: row } = await db.from("staff").select("id").eq("id", payload.id as string).maybeSingle();
    if (!row) return null;
    return {
      id: payload.id as string,
      username: payload.username as string,
      merchantId: (payload.merchantId as string) ?? null,
      role: (payload.role as Role) ?? "cashier",
    };
  } catch {
    return null;
  }
}

export async function signCardLink(serial: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(serial)
    .setExpirationTime("1h")
    .sign(secretKey(":card-link"));
}

export async function verifyCardLink(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(":card-link"));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

// An owner with a known merchant. Narrowing merchantId to string here means
// owner-only routes don't have to re-check it.
export type OwnerStaff = Staff & { role: "owner"; merchantId: string };

export async function requireOwner(): Promise<OwnerStaff | null> {
  const staff = await getStaff();
  if (!staff || staff.role !== "owner" || !staff.merchantId) return null;
  return { ...staff, role: "owner", merchantId: staff.merchantId };
}

// helper to hash a password when seeding staff (see README / seed script)
export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

// ---------------------------------------------------------------------------
// Creator admin (/admin) — the platform operator, not a merchant.
// Own cookie + own signing key (purpose ":admin"): a staff/owner JWT never
// verifies here and an admin JWT never verifies in getStaff(). Admin is OFF
// unless ADMIN_PASSWORD is set, and unsetting it revokes every live session.
// ---------------------------------------------------------------------------
const ADMIN_COOKIE = "admin_session";
const ADMIN_TTL_SECS = 60 * 60 * 8;

export async function createAdminSession(): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin")
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_TTL_SECS}s`)
    .sign(secretKey(":admin"));
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_TTL_SECS,
  });
}

export async function isAdmin(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD) return false;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(":admin"));
    return payload.sub === "admin";
  } catch {
    return false;
  }
}

export async function destroyAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}
