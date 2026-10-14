import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { applyTransaction } from "@/lib/points";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs"; // applyTransaction pushes via APNs (http2) — needs Node

// /scan offers Undo for 10 s; the server allows a little longer so a slow
// network or a retry still lands. Past this, the owner adjusts the points.
const UNDO_WINDOW_MS = 2 * 60 * 1000;

// POST /api/merchant/undo  body: { idempotencyKey }
// Reverses one counter tap — an earn (earn:purchase, earn:stamp) or a reward (redeem:*) —
// identified by the Idempotency-Key that tap was sent with. The ledger row is
// never edited: the reversal is a new apply_points row with the opposite delta,
// reason "undo:<original reason>" and key "undo:<original key>", so a
// double-tapped or retried undo replays instead of reversing twice.
// Only the staff member who made the tap, or an owner, may undo it.
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  // the redeem route's bucket: an undo is one more counter tap on the same budget
  const allowed = await rateLimit(`redeem:${staff.id}`, 120, 60);
  if (!allowed)
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const { idempotencyKey } = await req.json().catch(() => ({}));
  if (typeof idempotencyKey !== "string" || !idempotencyKey)
    return NextResponse.json({ error: "idempotencyKey required" }, { status: 400 });

  const { data: txns, error } = await db
    .from("transactions")
    .select("serial, delta, reason, staff_id, created_at")
    .eq("merchant_id", staff.merchantId)
    .eq("idempotency_key", idempotencyKey)
    .limit(2);
  if (error) {
    console.error("undo lookup failed:", error.message);
    return NextResponse.json({ error: "Could not undo" }, { status: 500 });
  }
  if (!txns?.length)
    return NextResponse.json({ error: "Nothing to undo" }, { status: 404 });
  // Keys are only unique per (merchant, card). /scan sends a fresh UUID per tap,
  // so two cards sharing one means a client reused it: refuse rather than guess.
  if (txns.length > 1)
    return NextResponse.json({ error: "That key matches more than one card" }, { status: 409 });

  const txn = txns[0];
  if (staff.role !== "owner" && txn.staff_id !== staff.id)
    return NextResponse.json(
      { error: "Only the person who made this, or an owner, can undo it" },
      { status: 403 }
    );
  const reason = String(txn.reason ?? "");
  if (reason !== "earn:purchase" && reason !== "earn:stamp" && !reason.startsWith("redeem:"))
    return NextResponse.json({ error: "Only an earn or a reward can be undone" }, { status: 400 });
  // Already undone → answer as a replay, even past the window, so a retried
  // undo never reads as a failure and invites a second, manual reversal. The
  // row must really be this tap's reversal: "undo:" keys are reserved for this
  // route (redeem/adjust refuse them), so anything else is a conflict.
  const { data: prior } = await db
    .from("transactions")
    .select("reason, delta")
    .eq("merchant_id", staff.merchantId)
    .eq("serial", txn.serial)
    .eq("idempotency_key", `undo:${idempotencyKey}`)
    .maybeSingle();
  if (prior) {
    if (prior.reason !== `undo:${reason}` || prior.delta !== -txn.delta)
      return NextResponse.json({ error: "That tap has a conflicting undo record" }, { status: 409 });
    const { data: card } = await db
      .from("passes")
      .select("points")
      .eq("serial", txn.serial)
      .eq("merchant_id", staff.merchantId)
      .single();
    return NextResponse.json({ ok: true, newBalance: card?.points ?? 0, replay: true });
  }

  if (Date.now() - Date.parse(txn.created_at) > UNDO_WINDOW_MS)
    return NextResponse.json(
      { error: "Too late to undo — the owner can adjust points on the customer's page" },
      { status: 409 }
    );

  const result = await applyTransaction(
    txn.serial,
    -txn.delta,
    `undo:${reason}`,
    staff.id,
    staff.merchantId,
    `undo:${idempotencyKey}`
  );

  if (result.ok)
    return NextResponse.json({ ok: true, newBalance: result.newBalance, replay: result.replay });
  // undoing an earn whose points the customer has since spent would go negative
  if (result.status === "insufficient")
    return NextResponse.json(
      { error: "Those points were already used", balance: result.balance },
      { status: 422 }
    );
  if (result.status === "not_found")
    return NextResponse.json({ error: "Card not found" }, { status: 404 });

  console.error("undo failed:", result.error);
  return NextResponse.json({ error: "Could not undo" }, { status: 500 });
}
