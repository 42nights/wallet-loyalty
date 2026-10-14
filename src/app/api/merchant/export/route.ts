import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { formatPhone } from "@/lib/format";
import { loyaltyMode } from "@/lib/config";

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

const csvLines = (rows: Cell[][]) => rows.map((r) => r.map(cell).join(",") + "\r\n").join("");

// The file goes out in chunks (one per page of rows) instead of one buffered
// string: Vercel refuses a buffered function response over 4.5 MB, which a busy
// shop's ledger passes within a year (about 55k rows); a streamed one has no
// size cap.

// Only what /customers and a customer's page already show the owner — no
// email, birthday or consent columns. merchant_customers returns one jsonb
// value, so PostgREST's max_rows does not cut it: one call, every card.
// `unit` heads the balance column: "Points", or "Stamps" on a stamp card.
async function* customers(m: string, unit: string): AsyncGenerator<string> {
  const { data, error } = await db.rpc("merchant_customers", {
    p_merchant: m, p_search: null, p_sort: "name", p_limit: 1_000_000, p_offset: 0,
  });
  if (error) throw new Error(`export customers failed: ${error.message}`);
  const list = (data as { customers?: Customer[] } | null)?.customers ?? [];
  yield csvLines([
    ["Name", "Phone", unit, "Lifetime earned", "Lifetime redeemed", "Visits", "Last seen (UTC)"],
    ...list.map((c) => [c.customer_name, formatPhone(c.customer_phone), c.points, c.lifetime_earned, c.lifetime_redeemed, c.visits, utc(c.last_seen)]),
  ]);
}

// The whole ledger in id (insert) order: a unique key, so offset pages never
// overlap, and a row added mid-export lands at the end. Stops on an empty page
// rather than a short one, so a lower max_rows can't silently cut the file.
async function* transactions(m: string, unit: string): AsyncGenerator<string> {
  let chunk: Cell[][] = [["Date (UTC)", "Customer", "Phone", "Kind", "Reason", unit, "Bill ($)", "Staff"]];
  for (let from = 0; ; ) {
    const { data, error } = await db
      .from("transactions")
      .select("created_at, delta, reason, amount, passes(customer_name, customer_phone), staff(username)")
      .eq("merchant_id", m)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`export transactions failed: ${error.message}`);
    for (const t of data as unknown as Txn[])
      chunk.push([
        utc(t.created_at), t.passes?.customer_name ?? null, formatPhone(t.passes?.customer_phone ?? null),
        t.reason?.split(":")[0] ?? null, t.reason, t.delta, t.amount, t.staff?.username ?? null,
      ]);
    if (chunk.length) yield csvLines(chunk);
    if (!data.length) return;
    chunk = [];
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
  // "*": loyalty_mode may not exist yet (then it's points)
  const { data: merchant } = await db.from("merchants").select("*").eq("id", m).maybeSingle();
  const unit = loyaltyMode(merchant?.loyalty_mode) === "stamps" ? "Stamps" : "Points";
  const chunks = type === "customers" ? customers(m, unit) : transactions(m, unit);
  // The first chunk is read before any byte is sent, so a failing query
  // still answers 500 instead of a file cut short.
  const first = await chunks.next().catch((e: Error) => (console.error(e.message), null));
  if (!first) return NextResponse.json({ error: "Export failed" }, { status: 500 });

  const slug = String(merchant?.slug ?? "").replace(/[^\w-]/g, "") || "shop";
  const day = new Date().toISOString().slice(0, 10);
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    // The BOM makes Excel read the file as UTF-8 (accented names stay intact).
    start: (c) => c.enqueue(enc.encode("\uFEFF" + (first.value ?? ""))),
    async pull(c) {
      try {
        const { value, done } = await chunks.next();
        if (done) c.close();
        else c.enqueue(enc.encode(value));
      } catch (e) {
        // Headers are already out: erroring the stream makes the browser mark
        // the download as failed rather than save a silently short file.
        console.error((e as Error).message);
        c.error(e);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${type}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
