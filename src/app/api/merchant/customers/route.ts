import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const SORTS = ["recent", "points", "lifetime", "name"];

// GET /api/merchant/customers?search=&sort=&limit=&offset=  (owner-only)
export async function GET(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const allowed = await rateLimit(`customers:${owner.id}`, 120, 60);
  if (!allowed) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim() || null;
  const sortParam = sp.get("sort") || "recent";
  const sort = SORTS.includes(sortParam) ? sortParam : "recent";
  const limit = Math.min(Math.max(parseInt(sp.get("limit") || "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(sp.get("offset") || "0", 10) || 0, 0);

  const { data, error } = await db.rpc("merchant_customers", {
    p_merchant: owner.merchantId,
    p_search: search,
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    console.error("merchant_customers failed:", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
  return NextResponse.json(data ?? { total: 0, customers: [] });
}
