import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "./supabase";

const COOKIE = "staff_session";

// Resolved lazily (not at import) so `next build` doesn't need the env, but a
// missing secret in production is a hard error — never sign/verify with a known
// constant in prod (that would let anyone forge a session).
function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production")
      throw new Error("SESSION_SECRET is not set");
    return new TextEncoder().encode("dev-only-insecure-secret");
  }
  return new TextEncoder().encode(s);
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
