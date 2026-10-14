import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { merchantFields, UUID_RE } from "@/lib/admin/merchant";
import { formatMoney } from "@/lib/format";
import { happyHourOf } from "@/lib/config";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/merchants/{id}
// body: any of { name, earnRate, template, bgColor, fgColor, labelColor, timezone }.
// The slug is deliberately not editable: it is printed on counter posters and
// baked into links customers already have.
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const patch = merchantFields(b, true);
  if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // Same pair check as owner Settings: the redeem route refuses any single earn
  // above 1,000,000 points, so rate x the owner's bill limit must stay under it
  // or the counter would accept bills it then rejects. The bill limit is the
  // owner's to set (Settings), so name the highest rate that fits instead.
  // The owner's happy-hour multiplier counts: the cap is on what's credited.
  if (patch.earn_rate !== undefined) {
    const { data: cur } = await db.from("merchants").select("*").eq("id", id).maybeSingle();
    if (!cur) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const bill = Number(cur.max_bill ?? 1000); // 1000 = schema default (un-migrated database)
    const mult = happyHourOf(cur.happy_hour)?.multiplier ?? 1;
    if (Math.round(patch.earn_rate * bill * mult) > 1_000_000)
      return NextResponse.json(
        {
          error:
            `At ${patch.earn_rate} points per $1, this shop's bill limit of ${formatMoney(bill)}${mult > 1 ? ` and its ${mult}× happy hour` : ""} could earn over ` +
            `1,000,000 points at once. Use at most ${Math.floor((10 * 1_000_000) / (bill * mult)) / 10}, ` +
            "or have the owner lower the bill limit in Settings.",
        },
        { status: 400 }
      );
  }

  const { data, error } = await db.from("merchants").update(patch).eq("id", id).select("id");
  if (error) {
    console.error("admin merchant update failed:", error.message);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  if (!data?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
