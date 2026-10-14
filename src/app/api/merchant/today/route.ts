import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { allRows } from "@/lib/admin/stats";

export const runtime = "nodejs";

// Merchants have no time zone, so /scan sends its own local midnight. Accept up
// to 36 h back (the widest UTC offset is 14 h, plus a DST day) and never the
// future: the window can't be stretched into an all-time report.
const MAX_BACK_MS = 36 * 60 * 60 * 1000;

type Row = { serial: string; delta: number; reason: string | null; idempotency_key: string | null };
type Undo = { serial: string; idempotency_key: string };

// GET /api/merchant/today?since=<ISO time> — the signed-in staff member's own
// counter taps since `since`, for the "Today" panel on /scan:
//   { since, customers (distinct cards), points (given), rewards, undos }
// A tap that was undone (an "undo:<its key>" row on the same card, by this
// staff member or an owner) counts only as an undo, so the other three numbers
// are what the customers actually kept. Owner adjustments aren't counter taps.
export async function GET(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });
  const merchantId = staff.merchantId;

  const asked = Date.parse(req.nextUrl.searchParams.get("since") ?? "");
  if (Number.isNaN(asked))
    return NextResponse.json({ error: "since must be a date" }, { status: 400 });
  const now = Date.now();
  const since = new Date(Math.min(now, Math.max(asked, now - MAX_BACK_MS))).toISOString();

  let taps: Row[], undoRows: Undo[];
  try {
    [taps, undoRows] = await Promise.all([
      allRows<Row>((from, to) =>
        db.from("transactions").select("serial, delta, reason, idempotency_key")
          .eq("merchant_id", merchantId).eq("staff_id", staff.id).gte("created_at", since)
          .order("id").range(from, to).overrideTypes<Row[], { merge: false }>()),
      // an undo lands within 2 minutes of its tap, so the same window holds it
      allRows<Undo>((from, to) =>
        db.from("transactions").select("serial, idempotency_key")
          .eq("merchant_id", merchantId).like("reason", "undo:%").gte("created_at", since)
          .order("id").range(from, to).overrideTypes<Undo[], { merge: false }>()),
    ]);
  } catch (e) {
    console.error("today summary failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not load today's numbers" }, { status: 500 });
  }

  const undone = new Set(undoRows.map((u) => `${u.serial} ${u.idempotency_key}`));
  const cards = new Set<string>();
  let points = 0, rewards = 0, undos = 0;
  for (const t of taps) {
    const earn = t.reason?.startsWith("earn:");
    if (!earn && !t.reason?.startsWith("redeem:")) continue;
    if (undone.has(`${t.serial} undo:${t.idempotency_key}`)) { undos++; continue; }
    cards.add(t.serial);
    if (earn) points += t.delta;
    else rewards++;
  }
  return NextResponse.json({ since, customers: cards.size, points, rewards, undos });
}
