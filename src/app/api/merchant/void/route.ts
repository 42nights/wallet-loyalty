import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { VOID_REASONS } from "@/lib/config";
import { db } from "@/lib/supabase";
import { wallet } from "@/lib/wallet";

export const runtime = "nodejs"; // wallet.notify pushes via APNs (http2)

// POST   /api/merchant/void  body: { serial, reason }  → deactivate the card
// DELETE /api/merchant/void  body: { serial }          → reactivate it
// Owner-only and scoped to the owner's merchant: another shop's serial is a 404.
// The balance and ledger stay as they are; points.ts refuses any balance change
// while voided_at is set. Either way the card is pushed so Wallet re-fetches it
// (pass.ts draws a deactivated card as DEACTIVATED, without its QR).
export async function POST(req: NextRequest) {
  return setVoided(req, true);
}

export async function DELETE(req: NextRequest) {
  return setVoided(req, false);
}

async function setVoided(req: NextRequest, voided: boolean) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { serial, reason } = await req.json().catch(() => ({}));
  if (typeof serial !== "string" || !serial)
    return NextResponse.json({ error: "No serial" }, { status: 400 });
  if (voided && !(typeof reason === "string" && Object.hasOwn(VOID_REASONS, reason)))
    return NextResponse.json({ error: "Pick a reason" }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("passes")
    .update(
      voided
        ? { voided_at: now, void_reason: reason, updated_at: now }
        : { voided_at: null, void_reason: null, updated_at: now }
    )
    .eq("serial", serial)
    .eq("merchant_id", owner.merchantId)
    .select("serial");
  if (error) {
    console.error("void update failed:", error.message);
    return NextResponse.json({ error: "Could not change the card" }, { status: 500 });
  }
  if (!data.length) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  // best-effort, like every push: the change is already saved
  try {
    await wallet.notify([serial]);
  } catch (e) {
    console.warn("void notify failed:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true, voided });
}
