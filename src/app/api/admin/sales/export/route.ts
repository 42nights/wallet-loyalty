import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { formatPhone } from "@/lib/format";
import { csvLines, type Cell } from "@/lib/sales/csv";
import { LEAD_RULES } from "@/lib/sales/fields";
import { leadsQuery } from "@/lib/sales/server";

export const runtime = "nodejs";

const PAGE = 1000; // PostgREST max_rows (supabase/config.toml)
// Every column of our own records: the editable fields plus the server's.
const PHONES = new Set(["phone", "consent_phone"]);
const COLUMNS = ["id", ...Object.keys(LEAD_RULES), "national_dnc_checked_at", "consent_at", "last_contacted_at", "do_not_contact", "dnc_at", "dnc_channel", "dnc_note", "import_batch", "created_at", "updated_at"];

// GET /api/admin/sales/export?(the list's filters) → CSV of the filtered view
// Our own lead records only; nothing from Google, Yelp or LinkedIn is stored,
// so nothing needs excluding. Streamed a page at a time (Vercel refuses a
// buffered response over 4.5 MB) and formula-safe (csvCell).
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await rateLimit("sales-export", 10, 60))) return NextResponse.json({ error: "Slow down" }, { status: 429 });
  const sp = req.nextUrl.searchParams;

  async function* pages(): AsyncGenerator<string> {
    yield csvLines([COLUMNS]);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await leadsQuery(sp, COLUMNS.join(","))
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`sales export failed: ${error.message}`);
      if (!data?.length) return;
      const rows = data as unknown as Record<string, Cell>[];
      // Phones as "(415) 555-0110", like the merchant export: a bare "+1…"
      // would get csvCell's formula apostrophe.
      yield csvLines(rows.map((r) => COLUMNS.map((c) => (PHONES.has(c) ? formatPhone(r[c] as string | null) : r[c]))));
    }
  }

  const chunks = pages();
  const header = await chunks.next();
  // The first page is read before any byte goes out, so a failing query
  // still answers 500 instead of a file cut short.
  const first = await chunks.next().catch((e: Error) => (console.error(e.message), null));
  if (!first) return NextResponse.json({ error: "Export failed" }, { status: 500 });
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start: (c) => c.enqueue(enc.encode("﻿" + (header.value ?? "") + (first.value ?? ""))),
    async pull(c) {
      try {
        const { value, done } = await chunks.next();
        if (done) c.close();
        else c.enqueue(enc.encode(value));
      } catch (e) {
        console.error((e as Error).message);
        c.error(e);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
