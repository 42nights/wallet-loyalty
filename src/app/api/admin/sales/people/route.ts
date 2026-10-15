import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { personFields } from "@/lib/sales/fields";
import type { Person } from "@/lib/sales/types";

export const runtime = "nodejs";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// GET /api/admin/sales/people → {people} (active first, then by name)
// Reps and partners are names on a roster, not logins (spec C6).
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  const { data, error } = await db.from("sales_people").select("*").order("active", { ascending: false }).order("name");
  if (error) return NextResponse.json({ error: "Query failed" }, { status: 500 });
  return NextResponse.json({ people: data as Person[] });
}

// POST /api/admin/sales/people  body: {name, kind, partner_type?, phone?, email?,
// payout_terms?, active?, started_on?, notes?} → 201 {person}
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const checked = personFields(b);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const p = checked.value;
  if (!p.name || !p.kind) return NextResponse.json({ error: "name and kind are required" }, { status: 400 });
  if (p.name.length > 80) return NextResponse.json({ error: "name: 80 characters max" }, { status: 400 });
  const { data, error } = await db.from("sales_people").insert(p).select("*").single();
  if (error || !data) {
    console.error("sales person create failed:", error?.message);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  return NextResponse.json({ person: data as Person }, { status: 201 });
}
