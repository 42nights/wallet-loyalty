import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { wallet } from "@/lib/wallet";
import {
  EARN_RATE, PUBLIC_BASE_URL, REDEEM_TEMPLATES, birthdayBonus, happyHourOf, parseHappyHour, templateKey, timezoneOf,
  type HappyHour,
} from "@/lib/config";

export const runtime = "nodejs"; // wallet.notify pushes via APNs (http2)

// Earn rate: EARN_RATE in config.ts (shared with the creator admin). The
// settings form mirrors these limits as input min/max; this route is the authority.

// largest bill one earn may carry (merchants.max_bill, enforced by the redeem route)
const MAX_BILL_MIN = 10;
const MAX_BILL_MAX = 100_000;

type MerchantRow = {
  name: string;
  slug: string | null;
  earn_rate: number | string;
  redeem_template?: string | null;
  max_bill?: number | string | null;
  timezone?: string | null;
  birthday_reward?: boolean | null;
  happy_hour?: unknown;
};

function settings(m: MerchantRow) {
  return {
    merchantName: m.name,
    template: templateKey(m.redeem_template),
    earnRate: Number(m.earn_rate),
    maxBill: Number(m.max_bill ?? 1000), // 1000 = schema default (un-migrated database)
    enrollUrl: m.slug ? `${PUBLIC_BASE_URL}/enroll/${m.slug}` : null,
    // set by 42nights in /admin; shown here because happy hour runs on it
    timezone: timezoneOf(m.timezone),
    birthdayReward: m.birthday_reward === true,
    birthdayBonus: birthdayBonus(m),
    happyHour: happyHourOf(m.happy_hour),
  };
}

// GET /api/merchant/settings — the owner's merchant settings.
export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // select("*") so a database without the later columns (redeem_template,
  // max_bill, timezone, birthday_reward, happy_hour) still works: settings()
  // falls back to the defaults.
  const { data } = await db.from("merchants").select("*").eq("id", owner.merchantId).single();
  if (!data) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  return NextResponse.json(settings(data));
}

// PATCH /api/merchant/settings
//   body: { template?, earnRate?, maxBill?, birthdayReward?, happyHour? }
//   happyHour: { days: [0-6], start: "HH:MM", end: "HH:MM", multiplier: 2|3 } | null (off)
// Strict: an unknown template, out-of-range rate or malformed window is a 400,
// never silently defaulted — the owner must see that their change did not take.
export async function PATCH(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { template, earnRate, maxBill, birthdayReward, happyHour } = await req.json().catch(() => ({}));
  const update: {
    redeem_template?: string;
    earn_rate?: number;
    max_bill?: number;
    birthday_reward?: boolean;
    happy_hour?: HappyHour | null;
  } = {};

  if (template !== undefined) {
    if (typeof template !== "string" || !Object.hasOwn(REDEEM_TEMPLATES, template))
      return NextResponse.json({ error: "Unknown template" }, { status: 400 });
    update.redeem_template = template;
  }
  if (earnRate !== undefined) {
    if (typeof earnRate !== "number" || !(earnRate >= EARN_RATE.min && earnRate <= EARN_RATE.max))
      return NextResponse.json(
        { error: `Earn rate must be between ${EARN_RATE.min} and ${EARN_RATE.max}` },
        { status: 400 }
      );
    update.earn_rate = earnRate;
  }
  if (maxBill !== undefined) {
    if (typeof maxBill !== "number" || !(maxBill >= MAX_BILL_MIN && maxBill <= MAX_BILL_MAX))
      return NextResponse.json(
        { error: `Bill limit must be between ${MAX_BILL_MIN} and ${MAX_BILL_MAX}` },
        { status: 400 }
      );
    update.max_bill = maxBill;
  }
  if (birthdayReward !== undefined) {
    if (typeof birthdayReward !== "boolean")
      return NextResponse.json({ error: "birthdayReward must be true or false" }, { status: 400 });
    update.birthday_reward = birthdayReward;
  }
  if (happyHour !== undefined) {
    const window = parseHappyHour(happyHour);
    if (typeof window === "string") return NextResponse.json({ error: window }, { status: 400 });
    update.happy_hour = window;
  }
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // The redeem route refuses any single earn above 1,000,000 points, so a
  // rate x limit (x happy-hour multiplier) combination above that would let the
  // counter accept bills it then rejects with a bare "Invalid amount". Check
  // the combination as it will be after this save.
  if (update.earn_rate !== undefined || update.max_bill !== undefined || update.happy_hour) {
    const { data: cur } = await db.from("merchants").select("*").eq("id", owner.merchantId).single();
    const rate = update.earn_rate ?? Number(cur?.earn_rate ?? 1);
    const bill = update.max_bill ?? Number(cur?.max_bill ?? 1000);
    const mult = (update.happy_hour !== undefined ? update.happy_hour : happyHourOf(cur?.happy_hour))?.multiplier ?? 1;
    if (Math.round(rate * bill * mult) > 1_000_000)
      return NextResponse.json(
        {
          error:
            mult > 1
              ? `At ${rate} points per 1.00 with ${mult}× happy hour, the bill limit can be at most ${Math.floor(1_000_000 / (rate * mult))}`
              : `At ${rate} points per 1.00, the bill limit can be at most ${Math.floor(1_000_000 / rate)}`,
        },
        { status: 400 }
      );
  }

  const { data, error } = await db
    .from("merchants")
    .update(update)
    .eq("id", owner.merchantId)
    .select("*")
    .single();
  if (error || !data) {
    console.error("settings update failed:", error?.message);
    return NextResponse.json({ error: "Could not save settings" }, { status: 500 });
  }

  // Everything but the bill limit shows on the card (rewards, earn line, happy
  // hour, birthday), so refresh the merchant's cards the way a campaign does:
  // bump updated_at (the device's passesUpdatedSince then lists them) and push.
  // Best effort — the save already happened; a failed push only delays the
  // card until its next balance change.
  if (Object.keys(update).some((k) => k !== "max_bill")) {
    const touched = await db
      .from("passes")
      .update({ updated_at: new Date().toISOString() })
      .eq("merchant_id", owner.merchantId);
    if (touched.error) console.error("settings card refresh failed:", touched.error.message);
    else
      try {
        // keyset pages: PostgREST caps one read at 1000 rows
        for (let last = ""; ; ) {
          const { data: page } = await db
            .from("passes")
            .select("serial")
            .eq("merchant_id", owner.merchantId)
            .gt("serial", last)
            .order("serial")
            .limit(1000);
          if (!page?.length) break;
          await wallet.notify(page.map((p) => p.serial as string));
          last = page[page.length - 1].serial as string;
        }
      } catch (e) {
        console.warn("settings notify failed:", e instanceof Error ? e.message : e);
      }
  }
  return NextResponse.json(settings(data));
}
