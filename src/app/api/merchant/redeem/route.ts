import { NextRequest, NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { STAMP_EARN_MAX, happyHourMultiplier, loyaltyMode, merchantRedemptions } from "@/lib/config";
import { applyTransaction, isServerKey, VOIDED_ERROR } from "@/lib/points";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { formatMoney } from "@/lib/format";

export const runtime = "nodejs"; // applyTransaction pushes via APNs (http2) — needs Node

// POST /api/merchant/redeem  body: { serial, actionId } | { serial, amount, confirm? } | { serial, stamps }
// Header: Idempotency-Key (required) — a per-tap UUID so a retry can't double-apply.
//   actionId → one of the merchant's redeem buttons (config.ts merchantRedemptions:
//              the template's, or the one stamp reward on a stamp card; negative delta).
//   amount   → points cards only: a bill total; earns round(merchant.earn_rate * amount) points.
//              Over merchants.max_bill → 422. Half of max_bill or more needs
//              confirm: true, else 409 { confirm: { points } } and nothing is
//              written — /scan shows those points and resends with confirm.
//              Inside the merchant's happy hour the points are multiplied
//              (2x/3x); the ledger keeps reason earn:purchase and the raw bill.
//   stamps   → stamp cards only: 1..STAMP_EARN_MAX stamps for this tap ("earn:stamp").
// Success and confirm (409) answers carry happyHour: the multiplier in force
// now, or null, so /scan's banner follows the window without polling. Success
// also carries points: the delta actually applied.
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.merchantId)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey)
    return NextResponse.json({ error: "Idempotency-Key required" }, { status: 400 });
  // keys with a colon are the server's (undo, birthday cron, campaigns): see isServerKey
  if (isServerKey(idempotencyKey))
    return NextResponse.json({ error: "Invalid Idempotency-Key" }, { status: 400 });

  const allowed = await rateLimit(`redeem:${staff.id}`, 120, 60);
  if (!allowed)
    return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const { serial, actionId, amount, confirm, stamps } = await req.json().catch(() => ({}));
  if (!serial) return NextResponse.json({ error: "No serial" }, { status: 400 });

  // select("*") so a database that hasn't run the redeem_template migration
  // yet still works (templateKey() falls back to the default template).
  const { data: merchant } = await db
    .from("merchants")
    .select("*")
    .eq("id", staff.merchantId)
    .single();
  if (!merchant)
    return NextResponse.json({ error: "No merchant" }, { status: 403 });

  // Largest bill one earn may carry. `?? 1000` is the schema default, so a
  // database without the max_bill column yet still gets the cap.
  const maxBill = Number(merchant.max_bill ?? 1000);
  const multiplier = happyHourMultiplier(merchant);
  const happyHour = multiplier > 1 ? multiplier : null;

  let delta: number;
  let reason: string;
  let billAmount: number | null = null;
  // A merchant runs points OR stamps, and each refuses the other's earn, so a
  // stale counter tab or a crafted request can't credit a bill on a stamp card
  // or stamps on a points card. Redeem buttons are scoped by merchantRedemptions.
  const stampCard = loyaltyMode(merchant.loyalty_mode) === "stamps";
  if (stampCard && amount !== undefined)
    return NextResponse.json({ error: "This shop collects stamps: tap a stamp button, no bill amount" }, { status: 400 });
  if (!stampCard && stamps !== undefined)
    return NextResponse.json({ error: "This shop earns points from the bill, not stamps" }, { status: 400 });

  if (stamps !== undefined) {
    if (!Number.isInteger(stamps) || stamps < 1 || stamps > STAMP_EARN_MAX)
      return NextResponse.json({ error: `Add 1 to ${STAMP_EARN_MAX} stamps at a time` }, { status: 400 });
    delta = stamps;
    reason = "earn:stamp";
  } else if (amount !== undefined) {
    // points-per-dollar earn: delta computed server-side from the merchant rate
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1_000_000)
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    if (amt > maxBill)
      return NextResponse.json(
        { error: `Bill is over this shop's limit of ${formatMoney(maxBill)} — check the amount, or ask the owner to raise the limit in Settings` },
        { status: 422 }
      );
    delta = Math.round(Number(merchant.earn_rate) * amt * multiplier);
    reason = "earn:purchase";
    billAmount = amt; // persist the raw bill $ for real revenue analytics
  } else {
    // only this merchant's buttons are redeemable here
    const action = merchantRedemptions(merchant).find((a) => a.id === actionId);
    if (!action)
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    delta = action.points;
    reason = `${action.kind}:${action.id}`;
  }

  // Bound delta well within int4 to avoid overflow / fat-finger over-credit.
  // Checked after the happy-hour multiplier: the cap is on what gets credited.
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000)
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

  if (billAmount !== null && billAmount >= maxBill / 2 && confirm !== true)
    // The hint is for a terminal still running an older /scan bundle that has no
    // confirm step: reloading picks up the version that shows one.
    return NextResponse.json(
      { error: "Confirm this bill (reload the page if no confirm button appears)", confirm: { points: delta }, happyHour },
      { status: 409 }
    );

  const result = await applyTransaction(
    serial,
    delta,
    reason,
    staff.id,
    staff.merchantId,
    idempotencyKey,
    billAmount
  );

  if (result.ok)
    return NextResponse.json({
      ok: true,
      newBalance: result.newBalance,
      replay: result.replay,
      points: delta,
      happyHour,
    });

  if (result.status === "insufficient")
    return NextResponse.json(
      { error: stampCard ? "Not enough stamps" : "Not enough points", balance: result.balance },
      { status: 422 }
    );
  if (result.status === "not_found")
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  if (result.status === "voided")
    return NextResponse.json({ error: VOIDED_ERROR }, { status: 409 });

  console.error("redeem failed:", result.error);
  return NextResponse.json({ error: "Could not apply points" }, { status: 500 });
}
