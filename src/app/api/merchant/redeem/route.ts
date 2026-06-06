import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { findAction } from "@/lib/config";
import { applyTransaction } from "@/lib/points";

// POST /api/merchant/redeem  body: { serial, actionId, customPoints? }
// actionId matches an entry in config.ts. customPoints lets you override
// (e.g. a freeform earn amount); positive = earn, negative = redeem.
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const result = await applyTransaction(serial, delta, reason, staff.id);
  if (!result.ok)
    return NextResponse.json(
      { error: result.error, balance: result.balance },
      { status: 422 }
    );

  return NextResponse.json({ ok: true, newBalance: result.newBalance });
}
