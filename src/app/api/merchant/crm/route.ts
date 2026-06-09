import { NextRequest, NextResponse } from "next/server";
import { requireOwner, OwnerStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

// Confirm a card belongs to this merchant before any note/tag write (no IDOR).
async function ownsCard(owner: OwnerStaff, serial: string): Promise<boolean> {
  const { data } = await db
    .from("passes")
    .select("serial")
    .eq("serial", serial)
    .eq("merchant_id", owner.merchantId)
    .maybeSingle();
  return !!data;
}

// GET /api/merchant/crm?serial=  → { notes, assignedTagIds, allTags }
export async function GET(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serial = req.nextUrl.searchParams.get("serial");
  if (!serial || !(await ownsCard(owner, serial)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [notes, assigned, allTags] = await Promise.all([
    db.from("customer_notes").select("id, body, created_at").eq("serial", serial)
      .eq("merchant_id", owner.merchantId).order("created_at", { ascending: false }),
    db.from("customer_tags").select("tag_id").eq("serial", serial).eq("merchant_id", owner.merchantId),
    db.from("tags").select("id, label, color").eq("merchant_id", owner.merchantId).order("label"),
  ]);
  return NextResponse.json({
    notes: notes.data ?? [],
    assignedTagIds: (assigned.data ?? []).map((t) => t.tag_id as string),
    allTags: allTags.data ?? [],
  });
}

// POST /api/merchant/crm  { action, serial?, body?, label?, color?, tagId? }
export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const m = owner.merchantId;

  switch (b.action) {
    case "addNote": {
      if (!b.serial || !(await ownsCard(owner, b.serial)))
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      const body = typeof b.body === "string" ? b.body.trim().slice(0, 2000) : "";
      if (!body) return NextResponse.json({ error: "Empty note" }, { status: 400 });
      const { error } = await db.from("customer_notes")
        .insert({ serial: b.serial, merchant_id: m, staff_id: owner.id, body });
      if (error) return NextResponse.json({ error: "Failed" }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    case "createTag": {
      const label = typeof b.label === "string" ? b.label.trim().slice(0, 40) : "";
      if (!label) return NextResponse.json({ error: "Empty label" }, { status: 400 });
      const { error } = await db.from("tags")
        .insert({ merchant_id: m, label, color: b.color ?? null });
      if (error)
        return NextResponse.json({ error: error.code === "23505" ? "Tag exists" : "Failed" },
          { status: error.code === "23505" ? 409 : 500 });
      return NextResponse.json({ ok: true });
    }
    case "assignTag":
    case "removeTag": {
      if (!b.serial || !b.tagId || !(await ownsCard(owner, b.serial)))
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      // tag must belong to this merchant
      const { data: tag } = await db.from("tags").select("id").eq("id", b.tagId).eq("merchant_id", m).maybeSingle();
      if (!tag) return NextResponse.json({ error: "Unknown tag" }, { status: 404 });
      if (b.action === "assignTag") {
        await db.from("customer_tags").upsert({ serial: b.serial, tag_id: b.tagId, merchant_id: m });
      } else {
        await db.from("customer_tags").delete().eq("serial", b.serial).eq("tag_id", b.tagId).eq("merchant_id", m);
      }
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
