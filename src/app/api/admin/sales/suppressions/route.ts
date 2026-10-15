import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { leadFields, salesPhone } from "@/lib/sales/fields";
import { markDoNotContact } from "@/lib/sales/server";
import type { Lead, Suppression } from "@/lib/sales/types";

export const runtime = "nodejs";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// GET /api/admin/sales/suppressions?q → {suppressions} (newest 200)
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const q = (req.nextUrl.searchParams.get("q") ?? "").toLowerCase().replace(/[^a-z0-9@.+_-]/g, "").slice(0, 80);
  let query = db.from("sales_suppressions").select("*").order("created_at", { ascending: false }).limit(200);
  if (q) query = query.ilike("value", `%${q}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Query failed" }, { status: 500 });
  return NextResponse.json({ suppressions: data as Suppression[] });
}

// POST /api/admin/sales/suppressions  body: {value: phone or email, reason?}
// → 201 {suppression, leadsMarked}
// For an opt-out that arrives without a lead page in front of you (a "remove
// me" reply). Opt-outs are global: any lead with that phone or email is marked
// do-not-contact too. There is no DELETE.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  const b = await req.json().catch(() => null);
  const raw = typeof b?.value === "string" ? b.value.trim() : "";
  const isEmail = raw.includes("@");
  const value = isEmail ? leadFields({ email: raw }) : null;
  const normalized = isEmail ? (value?.ok ? value.value.email ?? null : null) : salesPhone(raw);
  if (!normalized) return NextResponse.json({ error: "Enter a phone number (10+ digits) or an email" }, { status: 400 });
  const reason = typeof b?.reason === "string" && b.reason.trim() ? b.reason.trim().slice(0, 200) : "opt_out";

  const { data: leads, error: findErr } = await db.from("sales_leads").select("*").eq(isEmail ? "email" : "phone", normalized);
  if (findErr) return NextResponse.json({ error: "Query failed" }, { status: 500 });
  // The suppression first: it is what blocks re-imports and new leads.
  const { error } = await db
    .from("sales_suppressions")
    .upsert(
      { value: normalized, kind: isEmail ? "email" : "phone", reason, lead_id: (leads as Lead[] | null)?.[0]?.id ?? null },
      { onConflict: "value", ignoreDuplicates: true }
    );
  if (error) {
    console.error("sales suppression insert failed:", error.message);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  let marked = 0;
  for (const lead of (leads ?? []) as Lead[]) {
    if (lead.do_not_contact) continue;
    try {
      await markDoNotContact(lead, isEmail ? "email" : "other", `suppression list: ${reason}`, "opted out");
      marked++;
    } catch (e) {
      console.error((e as Error).message);
      return NextResponse.json({ error: "Saved the suppression, but a lead was not marked. Try again." }, { status: 500 });
    }
  }
  const { data: row } = await db.from("sales_suppressions").select("*").eq("value", normalized).single();
  return NextResponse.json({ suppression: row as Suppression, leadsMarked: marked }, { status: 201 });
}
