import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { applyTransaction } from "@/lib/points";

export const runtime = "nodejs"; // applyTransaction pushes via APNs (http2)

// POST /api/merchant/adjust  body: { serial, delta }  header: Idempotency-Key
// Owner-only manual point adjustment. Routes through apply_points → audited in
// the ledger as reason 'adjust:manual' with the owner's staff_id.
export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const idem = req.headers.get("idempotency-key");
  if (!idem) return NextResponse.json({ error: "Idempotency-Key required" }, { status: 400 });

  const { serial, delta } = await req.json().catch(() => ({}));
  if (!serial) return NextResponse.json({ error: "No serial" }, { status: 400 });

  const d = Number(delta);
  if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 1_000_000)
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

  const result = await applyTransaction(serial, d, "adjust:manual", owner.id, owner.merchantId, idem);

  if (result.ok)
    return NextResponse.json({ ok: true, newBalance: result.newBalance, replay: result.replay });
  if (result.status === "insufficient")
    return NextResponse.json({ error: "Would go negative", balance: result.balance }, { status: 422 });
  if (result.status === "not_found")
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({ error: "Could not adjust" }, { status: 500 });
}
