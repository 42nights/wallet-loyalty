import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { findAction } from "@/lib/config";
import { applyTransaction } from "@/lib/points";

export const runtime = "nodejs"; // applyTransaction pushes via APNs (http2) — needs Node

// POST /api/merchant/redeem  body: { serial, actionId, customPoints? }
// Header: Idempotency-Key (required) — a per-tap UUID so a retry can't double-apply.
// actionId matches an entry in config.ts. customPoints lets you override
// (e.g. a freeform earn amount); positive = earn, negative = redeem.
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey)
    return NextResponse.json({ error: "Idempotency-Key required" }, { status: 400 });

  const { serial, actionId, customPoints } = await req.json().catch(() => ({}));
  if (!serial) return NextResponse.json({ error: "No serial" }, { status: 400 });

  let delta: number;
  let reason: string;

  if (typeof customPoints === "number") {
    delta = customPoints;
    reason = customPoints >= 0 ? "earn:custom" : "redeem:custom";
  } else {
    const action = findAction(actionId);
    if (!action)
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    delta = action.points;
    reason = `${action.kind}:${action.id}`;
  }

  if (!Number.isInteger(delta) || delta === 0)
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

  return NextResponse.json({ error: result.error }, { status: 500 });
}
