import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { UUID_RE } from "@/lib/admin/merchant";

export const runtime = "nodejs";

type Params = { params: Promise<{ batch: string }> };

// DELETE /api/admin/sales/import/{batch} → {deleted, kept}
// Undo an import: removes the batch's leads that have no activities. A lead
// someone has worked (or marked do-not-contact) stays; suppressions survive
// regardless.
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { batch } = await params;
  if (!UUID_RE.test(batch)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ids: string[] = [];
  let dnc = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("sales_leads")
      .select("id, do_not_contact")
      .eq("import_batch", batch)
      .order("id")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: "Query failed" }, { status: 500 });
    for (const r of data ?? []) r.do_not_contact ? dnc++ : ids.push(r.id);
    if (!data?.length) break;
  }
  if (!ids.length && !dnc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const worked = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db.from("sales_activities").select("lead_id").in("lead_id", ids.slice(i, i + 150));
    if (error) return NextResponse.json({ error: "Query failed" }, { status: 500 });
    for (const r of data ?? []) worked.add(r.lead_id);
  }
  const doomed = ids.filter((id) => !worked.has(id));
  let deleted = 0;
  for (let i = 0; i < doomed.length; i += 150) {
    // Re-checked in the delete itself: a lead marked do-not-contact since the
    // read above is kept.
    const { data, error } = await db
      .from("sales_leads")
      .delete()
      .in("id", doomed.slice(i, i + 150))
      .eq("do_not_contact", false)
      .select("id");
    if (error) return NextResponse.json({ error: `Stopped after ${deleted} rows`, deleted }, { status: 500 });
    deleted += data?.length ?? 0;
  }
  return NextResponse.json({ deleted, kept: ids.length + dnc - deleted });
}
