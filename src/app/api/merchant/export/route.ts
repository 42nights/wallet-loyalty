import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { formatPhone } from "@/lib/format";

export const runtime = "nodejs";

const PAGE = 1000; // PostgREST max_rows (supabase/config.toml)

type Cell = string | number | null;
type Customer = {
  serial: string;
  customer_name: string | null;
  customer_phone: string | null;
  points: number;
  lifetime_earned: number;
  lifetime_redeemed: number;
  visits: number;
  last_seen: string | null;
};
type Txn = {
  created_at: string;
  delta: number;
  reason: string | null;
  amount: number | null;
  passes: { customer_name: string | null; customer_phone: string | null } | null;
  staff: { username: string } | null;
};

// One RFC 4180 field. Text a spreadsheet would run as a formula (= + - @, or a
// leading tab/CR) gets a leading apostrophe; numbers we computed stay numeric,
// so a redeem's -80 is still a number.
function cell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// "2026-10-14 18:05:09": UTC (merchants have no time zone), a form Excel and
// Sheets read as a date-time.
const utc = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 19).replace("T", " ") : null);

// Only what /customers and a customer's page already show the owner — no
// email, birthday or consent columns.
async function customers(m: string): Promise<Cell[][] | null> {
  const out: Cell[][] = [["Name", "Phone", "Points", "Lifetime earned", "Lifetime redeemed", "Visits", "Last seen (UTC)"]];
  // A customer enrolling mid-export shifts the offset by one; skip the repeat.
  const seen = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.rpc("merchant_customers", {
      p_merchant: m, p_search: null, p_sort: "name", p_limit: PAGE, p_offset: offset,
    });
    if (error) {
      console.error("export customers failed:", error.message);
      return null;
    }
    const page = (data as { customers?: Customer[] } | null)?.customers ?? [];
    for (const c of page) {
      if (seen.has(c.serial)) continue;
      seen.add(c.serial);
      out.push([c.customer_name, formatPhone(c.customer_phone), c.points, c.lifetime_earned, c.lifetime_redeemed, c.visits, utc(c.last_seen)]);
    }
    if (page.length < PAGE) return out;
  }
}

// The whole ledger in id (insert) order: a unique key, so offset pages never
// overlap, and a row added mid-export lands at the end. Stops on an empty page
// rather than a short one, so a lower max_rows can't silently cut the file.
async function transactions(m: string): Promise<Cell[][] | null> {
  const out: Cell[][] = [["Date (UTC)", "Customer", "Phone", "Kind", "Reason", "Points", "Bill ($)", "Staff"]];
  for (let from = 0; ; ) {
    const { data, error } = await db
      .from("transactions")
      .select("created_at, delta, reason, amount, passes(customer_name, customer_phone), staff(username)")
      .eq("merchant_id", m)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("export transactions failed:", error.message);
      return null;
    }
    if (!data.length) return out;
    for (const t of data as unknown as Txn[])
      out.push([
        utc(t.created_at), t.passes?.customer_name ?? null, formatPhone(t.passes?.customer_phone ?? null),
        t.reason?.split(":")[0] ?? null, t.reason, t.delta, t.amount, t.staff?.username ?? null,
      ]);
    from += data.length;
  }
}

// GET /api/merchant/export?type=customers|transactions  (owner-only) → CSV file
export async function GET(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (staff.role !== "owner" || !staff.merchantId)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const type = req.nextUrl.searchParams.get("type");
  if (type !== "customers" && type !== "transactions")
    return NextResponse.json({ error: "Unknown export" }, { status: 400 });

  if (!(await rateLimit(`export:${staff.id}`, 10, 60)))
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const m = staff.merchantId;
  const [rows, { data: merchant }] = await Promise.all([
    type === "customers" ? customers(m) : transactions(m),
    db.from("merchants").select("slug").eq("id", m).maybeSingle(),
  ]);
  if (!rows) return NextResponse.json({ error: "Export failed" }, { status: 500 });

  const slug = String(merchant?.slug ?? "").replace(/[^\w-]/g, "") || "shop";
  const day = new Date().toISOString().slice(0, 10);
  // The BOM makes Excel read the file as UTF-8 (accented names stay intact).
  const body = "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${type}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
