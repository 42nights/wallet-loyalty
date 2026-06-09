import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { applyTransaction } from "@/lib/points";
import { wallet } from "@/lib/wallet";

export const runtime = "nodejs"; // applyTransaction + wallet.notify push via APNs

const SEGMENTS = ["vip", "regular", "new", "active", "at_risk", "lapsed", "dormant"] as const;
const MAX_TARGETS = 2000; // café-scale guard; one APNs push per targeted card

type SegCustomer = { serial: string; segment: string };

// GET /api/merchant/campaigns → { campaigns: [{...campaign, lift?}] }
export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const m = owner.merchantId;

  const { data: rows } = await db
    .from("campaigns")
    .select("id, name, segment, bonus_points, offer_text, status, targeted, created_at, sent_at")
    .eq("merchant_id", m)
    .order("created_at", { ascending: false })
    .limit(50);

  const campaigns = await Promise.all(
    (rows ?? []).map(async (c) => {
      if (c.status !== "sent") return { ...c, lift: null };
      const { data: lift } = await db.rpc("campaign_lift", { p_merchant: m, p_campaign: c.id });
      return { ...c, lift: lift ?? null };
    })
  );
  return NextResponse.json({ campaigns });
}

// POST /api/merchant/campaigns  body: { name, segment, bonusPoints, offerText? }
// Creates a campaign and sends it: credits +bonus to every card in the target
// segment via apply_points (reason campaign:<id>, idempotency <id>:<serial>),
// optionally sets a Wallet win-back back-field, and notifies devices. The ledger
// is the audit trail; campaign_lift reads real return-visits straight from it.
export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const m = owner.merchantId;

  const b = await req.json().catch(() => ({}));
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
  const segment = SEGMENTS.includes(b.segment) ? (b.segment as string) : "";
  const bonus = Math.trunc(Number(b.bonusPoints));
  const offerText =
    typeof b.offerText === "string" && b.offerText.trim()
      ? b.offerText.trim().slice(0, 120)
      : null;

  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!segment) return NextResponse.json({ error: "Unknown segment" }, { status: 400 });
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > 100_000)
    return NextResponse.json({ error: "Invalid bonus" }, { status: 400 });
  if (bonus === 0 && !offerText)
    return NextResponse.json({ error: "Add bonus points or an offer" }, { status: 400 });

  // Resolve the target serials from the live segment RPC (single source of truth
  // for the RFM ladder — no duplicated logic here).
  const { data: seg } = await db.rpc("merchant_segments", { p_merchant: m });
  const customers = ((seg as { customers?: SegCustomer[] } | null)?.customers ?? []).filter(
    (c) => c.segment === segment
  );
  const serials = customers.map((c) => c.serial).slice(0, MAX_TARGETS);
  if (serials.length === 0)
    return NextResponse.json({ error: "No customers in that segment" }, { status: 422 });

  // Create the campaign row first so bonuses can reference its id.
  const { data: campaign, error: cErr } = await db
    .from("campaigns")
    .insert({
      merchant_id: m,
      name,
      segment,
      bonus_points: bonus,
      offer_text: offerText,
      targeted: serials.length,
      created_by: owner.id,
    })
    .select("id")
    .single();
  if (cErr || !campaign)
    return NextResponse.json({ error: "Could not create campaign" }, { status: 500 });
  const campaignId = campaign.id as string;
  const reason = `campaign:${campaignId}`;

  let applied = 0;
  const offerOnly: string[] = [];
  for (const serial of serials) {
    // Set the win-back copy BEFORE notifying, so the device's re-fetch (triggered
    // by apply_points below, or the batch notify for offer-only) sees the offer.
    if (offerText) {
      await db.from("passes").update({ offer_text: offerText }).eq("serial", serial).eq("merchant_id", m);
    }
    let pointsApplied = 0;
    if (bonus > 0) {
      const r = await applyTransaction(
        serial,
        bonus,
        reason,
        owner.id,
        m,
        `${campaignId}:${serial}`, // idempotent: re-running never double-credits
        null
      );
      if (r.ok) {
        pointsApplied = r.replay ? 0 : bonus;
        applied += 1;
      }
    } else {
      offerOnly.push(serial); // offer-only: notify in one batch below
    }
    await db
      .from("campaign_sends")
      .upsert(
        { campaign_id: campaignId, merchant_id: m, serial, points_applied: pointsApplied },
        { onConflict: "campaign_id,serial" }
      );
  }

  // Offer-only cards got no apply_points push; nudge them to re-fetch the offer.
  if (offerOnly.length) {
    try {
      await wallet.notify(offerOnly);
    } catch (e) {
      console.warn("campaign notify failed:", e instanceof Error ? e.message : e);
    }
  }

  await db
    .from("campaigns")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("merchant_id", m);

  return NextResponse.json({
    ok: true,
    campaignId,
    targeted: serials.length,
    applied: bonus > 0 ? applied : offerOnly.length,
  });
}
