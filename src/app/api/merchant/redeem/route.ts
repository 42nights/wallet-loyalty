import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { findAction } from "@/lib/config";
import { applyTransaction } from "@/lib/points";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs"; // applyTransaction pushes via APNs (http2) — needs Node

// POST /api/merchant/redeem  body: { serial, actionId } | { serial, amount }
// Header: Idempotency-Key (required) — a per-tap UUID so a retry can't double-apply.
//   actionId → one of the fixed redeem buttons in config.ts (negative delta).
//   amount   → a bill total; earns round(merchant.earn_rate * amount) points.
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey)
    return NextResponse.json({ error: "Idempotency-Key required" }, { status: 400 });

  const allowed = await rateLimit(`redeem:${staff.id}`, 120, 60);
  if (!allowed)
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const { serial, actionId, amount } = await req.json().catch(() => ({}));
  if (!serial) return NextResponse.json({ error: "No serial" }, { status: 400 });

  let delta: number;
  let reason: string;

  if (amount !== undefined) {
    // points-per-dollar earn: delta computed server-side from the merchant rate
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1_000_000)
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    const { data: merchant } = await db
      .from("merchants")
      .select("earn_rate")
      .eq("id", staff.merchantId)
      .single();
    if (!merchant)
      return NextResponse.json({ error: "No merchant" }, { status: 403 });
    delta = Math.round(Number(merchant.earn_rate) * amt);
    reason = "earn:purchase";
  } else {
    const action = findAction(actionId);
    if (!action)
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    delta = action.points;
    reason = `${action.kind}:${action.id}`;
  }

  // Bound delta well within int4 to avoid overflow / fat-finger over-credit.
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000)
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

  const result = await applyTransaction(
    serial,
    delta,
    reason,
    staff.id,
    staff.merchantId,
    idempotencyKey
  );

  if (result.ok)
    return NextResponse.json({
      ok: true,
      newBalance: result.newBalance,
      replay: result.replay,
    });

  if (result.status === "insufficient")
    return NextResponse.json(
      { error: "Not enough points", balance: result.balance },
      { status: 422 }
    );
  if (result.status === "not_found")
    return NextResponse.json({ error: "Card not found" }, { status: 404 });

  console.error("redeem failed:", result.error);
  return NextResponse.json({ error: "Could not apply points" }, { status: 500 });
}
