import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { applyPoints } from "@/lib/points";
import { wallet } from "@/lib/wallet";

export const runtime = "nodejs"; // wallet.notify pushes via APNs

const SEGMENTS = ["vip", "regular", "new", "active", "at_risk", "lapsed", "dormant"] as const;
const MAX_TARGETS = 2000; // café-scale guard; one APNs push per targeted card
const APPLY_CONCURRENCY = 10;
const WRITE_CHUNK = 100;

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

// POST /api/merchant/campaigns  body: { id?, name, segment, bonusPoints, offerText? }
// Creates a campaign and sends it: credits +bonus to every card in the target
// segment via apply_points (reason campaign:<id>, idempotency <id>:<serial>),
// optionally sets a Wallet win-back back-field, and notifies devices. The ledger
// is the audit trail; campaign_lift reads real return-visits straight from it.
export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const m = owner.merchantId;

  const b = await req.json().catch(() => ({}));
  const id = typeof b.id === "string" ? b.id : null;

  const { data: existing } = id
    ? await db
        .from("campaigns")
        .select("id, name, segment, bonus_points, offer_text, targeted, status")
        .eq("id", id)
        .eq("merchant_id", m)
        .maybeSingle()
    : { data: null };
  if (existing?.status === "sent")
    return NextResponse.json({ ok: true, campaignId: existing.id, targeted: existing.targeted });

  const name: string =
    existing?.name ?? (typeof b.name === "string" ? b.name.trim().slice(0, 80) : "");
  const segment: string =
    existing?.segment ?? (SEGMENTS.includes(b.segment) ? (b.segment as string) : "");
  const bonus: number = existing?.bonus_points ?? Math.trunc(Number(b.bonusPoints));
  const offerText: string | null = existing
    ? existing.offer_text
    : typeof b.offerText === "string" && b.offerText.trim()
      ? b.offerText.trim().slice(0, 120)
      : null;

  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!segment) return NextResponse.json({ error: "Unknown segment" }, { status: 400 });
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > 100_000)
    return NextResponse.json({ error: "Invalid bonus" }, { status: 400 });
  if (bonus === 0 && !offerText)
    return NextResponse.json({ error: "Add bonus points or an offer" }, { status: 400 });

  if (!existing) {
    const { data: pending } = await db
      .from("campaigns")
      .select("id")
      .eq("merchant_id", m)
      .eq("segment", segment)
      .eq("status", "draft")
      .limit(1)
      .maybeSingle();
    if (pending)
      return NextResponse.json(
        { error: "A campaign to this segment hasn't finished sending. Use Finish sending in History." },
        { status: 409 }
      );
  }

  // Resolve the target serials from the live segment RPC (single source of truth
  // for the RFM ladder — no duplicated logic here).
  const { data: seg } = await db.rpc("merchant_segments", { p_merchant: m });
  const customers = ((seg as { customers?: SegCustomer[] } | null)?.customers ?? []).filter(
    (c) => c.segment === segment
  );
  const serials = customers.map((c) => c.serial).slice(0, MAX_TARGETS);
  if (serials.length === 0)
    return NextResponse.json({ error: "No customers in that segment" }, { status: 422 });

  let campaignId: string | undefined = existing?.id;
  if (!campaignId) {
    const { data: campaign, error: cErr } = await db
      .from("campaigns")
      .insert({
        ...(id ? { id } : {}),
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
    campaignId = campaign.id as string;
  }
  const reason = `campaign:${campaignId}`;

  const failed = new Set<string>();
  if (offerText) {
    for (let i = 0; i < serials.length; i += WRITE_CHUNK) {
      const chunk = serials.slice(i, i + WRITE_CHUNK);
      const { error } = await db
        .from("passes")
        .update({ offer_text: offerText, updated_at: new Date().toISOString() })
        .eq("merchant_id", m)
        .in("serial", chunk);
      if (error) chunk.forEach((serial) => failed.add(serial));
    }
  }

  const credited = new Set<string>();
  if (bonus > 0) {
    let next = 0;
    await Promise.all(
      Array.from({ length: APPLY_CONCURRENCY }, async () => {
        while (next < serials.length) {
          const serial = serials[next++];
          const r = await applyPoints(serial, bonus, reason, owner.id, m, `${campaignId}:${serial}`, null);
          if (r.ok) credited.add(serial);
          else if (r.status === "error") failed.add(serial);
        }
      })
    );
  }

  const { error: sendsErr } = await db.from("campaign_sends").upsert(
    serials
      .filter((serial) => !failed.has(serial))
      .map((serial) => ({
        campaign_id: campaignId,
        merchant_id: m,
        serial,
        points_applied: credited.has(serial) ? bonus : 0,
      })),
    { onConflict: "campaign_id,serial" }
  );

  try {
    await wallet.notify(serials);
  } catch (e) {
    console.warn("campaign notify failed:", e instanceof Error ? e.message : e);
  }

  if (failed.size || sendsErr)
    return NextResponse.json(
      {
        error: `Sent to ${serials.length - failed.size} of ${serials.length}. Use Finish sending in History to retry the rest.`,
        campaignId,
      },
      { status: 502 }
    );

  await db
    .from("campaigns")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("merchant_id", m);

  return NextResponse.json({
    ok: true,
    campaignId,
    targeted: serials.length,
    applied: bonus > 0 ? credited.size : serials.length,
  });
}
