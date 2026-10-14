import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { applyTransaction } from "@/lib/points";
import { safeEqual } from "@/lib/safeEqual";
import { birthdayBonus, birthdaysOn, localTime, timezoneOf } from "@/lib/config";

export const runtime = "nodejs"; // applyTransaction pushes via APNs (http2)

const PAGE = 500;

// GET /api/cron/birthday — Vercel Cron, once a day (vercel.json; Hobby allows
// one run per day). Vercel sends "Authorization: Bearer $CRON_SECRET"; with no
// CRON_SECRET set every call is refused, never let through.
// The schedule, 17:00 UTC (Hobby fires somewhere in that hour), is 9-10 am
// Pacific, 12-1 pm Eastern and 7 am Hawaii (DST-dependent): daytime for the
// customer's "You now have N points" notice, and every US zone is on the same
// calendar day then.
//
// For each merchant with the birthday treat on, every card whose birthday is
// TODAY on the shop's clock gets birthdayBonus() points: reason bonus:birthday,
// idempotency key birthday:<year>:<serial>. A second run the same day (or a
// retry) replays instead of crediting twice, so it is safe at any hour; the
// redeem/adjust routes refuse client keys starting "birthday:", so nobody can
// plant one. applyTransaction pushes each credited card.
// A missed day (Vercel did not run it) is not caught up: the birthday passes.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 42703 = no birthday_reward column yet (un-migrated database): nobody has it on.
  // ponytail: one read, so at most 1000 merchants with the treat on; page here past that.
  const { data: merchants, error } = await db.from("merchants").select("*").eq("birthday_reward", true);
  if (error && error.code !== "42703") {
    console.error("birthday cron: merchants:", error.message);
    return NextResponse.json({ error: "Could not list merchants" }, { status: 500 });
  }

  let credited = 0;
  let failed = 0;
  for (const m of merchants ?? []) {
    const today = localTime(timezoneOf(m.timezone));
    const bonus = birthdayBonus(m);
    // keyset pages by serial, so a big merchant is read PAGE cards at a time
    for (let last = ""; ; ) {
      const { data: cards, error: cardsErr } = await db
        .from("passes")
        .select("serial")
        .eq("merchant_id", m.id)
        .in("birthday", birthdaysOn(today))
        .gt("serial", last)
        .order("serial")
        .limit(PAGE);
      if (cardsErr) {
        failed++;
        console.error(`birthday cron: cards of ${m.id}:`, cardsErr.message);
        break;
      }
      if (!cards.length) break;
      for (const { serial } of cards) {
        const r = await applyTransaction(serial, bonus, "bonus:birthday", null, m.id, `birthday:${today.year}:${serial}`);
        if (r.ok && !r.replay) credited++;
        else if (!r.ok && r.status === "error") {
          failed++;
          console.error(`birthday cron: ${serial}:`, r.error);
        }
      }
      last = cards[cards.length - 1].serial;
    }
  }

  // 500 when anything failed, so the run shows as failed in Vercel's cron log;
  // the next run's replays make a manual re-run safe.
  return NextResponse.json(
    { ok: failed === 0, merchants: merchants?.length ?? 0, credited, failed },
    { status: failed ? 500 : 200 }
  );
}
