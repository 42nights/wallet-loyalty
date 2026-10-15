import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { UUID_RE } from "@/lib/admin/merchant";
import { personFields } from "@/lib/sales/fields";
import type { Person } from "@/lib/sales/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/sales/people/{id}  body: any person fields → {person}
// Deactivate with {active: false}; there is no delete, so payouts and
// "sourced by" history keep their names.
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const checked = personFields(b);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  if (!Object.keys(checked.value).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  if ((checked.value.name?.length ?? 0) > 80) return NextResponse.json({ error: "name: 80 characters max" }, { status: 400 });
  const { data, error } = await db.from("sales_people").update(checked.value).eq("id", id).select("*").maybeSingle();
  if (error) {
    console.error("sales person update failed:", error.message);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ person: data as Person });
}
