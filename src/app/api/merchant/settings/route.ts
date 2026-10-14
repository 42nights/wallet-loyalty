import { NextRequest, NextResponse, after } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { cardVisibleChange, refreshMerchantCards } from "@/lib/wallet";
import {
  EARN_RATE, PUBLIC_BASE_URL, REDEEM_TEMPLATES, STAMP_REWARD_MAX, birthdayBonus, happyHourOf, loyaltyMode,
  parseHappyHour, stampGoal, stampReward, templateKey, timezoneOf, type HappyHour,
} from "@/lib/config";
import { formatLocation, parseLocation, parseReviewUrl } from "@/lib/admin/merchant";

export const runtime = "nodejs"; // card-visible changes push card updates (APNs, http2)

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
  loyalty_mode?: string | null;
  stamp_goal?: number | null;
  stamp_reward?: string | null;
  timezone?: string | null;
  birthday_reward?: boolean | null;
  happy_hour?: unknown;
  review_url?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

function settings(m: MerchantRow) {
  return {
    merchantName: m.name,
    template: templateKey(m.redeem_template),
    earnRate: Number(m.earn_rate),
    maxBill: Number(m.max_bill ?? 1000), // 1000 = schema default (un-migrated database)
    enrollUrl: m.slug ? `${PUBLIC_BASE_URL}/enroll/${m.slug}` : null,
    // read-only here: 42nights sets the mode and goal (admin), the owner names the reward
    mode: loyaltyMode(m.loyalty_mode),
    stampGoal: stampGoal(m.stamp_goal),
    stampReward: stampReward(m.stamp_reward),
    // set by 42nights in /admin; shown here because happy hour runs on it
    timezone: timezoneOf(m.timezone),
    birthdayReward: m.birthday_reward === true,
    birthdayBonus: birthdayBonus(m),
    happyHour: happyHourOf(m.happy_hour),
    reviewUrl: m.review_url ?? "",
    location: formatLocation(m.latitude, m.longitude),
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
//   body: { template?, earnRate?, maxBill?, stampReward?, birthdayReward?, happyHour?, reviewUrl?, location? }
//   happyHour: { days: [0-6], start: "HH:MM", end: "HH:MM", multiplier: 2|3 } | null (off)
//   reviewUrl: https link or "" to clear. location: "lat, lng" or "" to clear.
// Strict: an unknown template, out-of-range rate or malformed window is a 400,
// never silently defaulted — the owner must see that their change did not take.
// stampReward renames a stamp card's reward; a points merchant has none to rename.
export async function PATCH(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { template, earnRate, maxBill, stampReward: reward, birthdayReward, happyHour, reviewUrl, location } =
    await req.json().catch(() => ({}));
  const update: {
    redeem_template?: string;
    earn_rate?: number;
    max_bill?: number;
    stamp_reward?: string;
    birthday_reward?: boolean;
    happy_hour?: HappyHour | null;
    review_url?: string | null;
    latitude?: number | null;
    longitude?: number | null;
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
  if (reward !== undefined) {
    const label = typeof reward === "string" ? reward.trim() : "";
    if (!label || label.length > STAMP_REWARD_MAX)
      return NextResponse.json({ error: `The reward needs a name of 1 to ${STAMP_REWARD_MAX} characters` }, { status: 400 });
    update.stamp_reward = label;
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
  if (reviewUrl !== undefined) {
    const r = parseReviewUrl(reviewUrl);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    update.review_url = r.value;
  }
  if (location !== undefined) {
    const r = parseLocation(location);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    update.latitude = r.value?.latitude ?? null;
    update.longitude = r.value?.longitude ?? null;
  }
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { data: cur } = await db.from("merchants").select("*").eq("id", owner.merchantId).single();
  if (update.stamp_reward !== undefined && loyaltyMode(cur?.loyalty_mode) !== "stamps")
    return NextResponse.json({ error: "This shop runs points, so there is no stamp reward to rename" }, { status: 400 });

  // The redeem route refuses any single earn above 1,000,000 points, so a
  // rate x limit (x happy-hour multiplier) combination above that would let the
  // counter accept bills it then rejects with a bare "Invalid amount". Check
  // the combination as it will be after this save.
  if (update.earn_rate !== undefined || update.max_bill !== undefined || update.happy_hour) {
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
  // A change the cards show (not the bill limit, not a value saved unchanged)
  // refreshes them, after the response so the save never waits on APNs.
  if (cardVisibleChange(cur, data)) after(() => refreshMerchantCards(owner.merchantId));
  return NextResponse.json(settings(data));
}
