import { db } from "@/lib/supabase";
import { appleProvider } from "./apple/provider";
import type { WalletProvider } from "./types";

// The active wallet provider. Apple today; swap/extend for Google Wallet later
// without touching routes or the points engine.
export const wallet: WalletProvider = appleProvider;

export type { WalletProvider, PassData } from "./types";

// The merchant columns a card prints (pass.ts). timezone and max_bill are not
// among them: the happy-hour line is the shop's wall-clock window, no zone.
const CARD_COLUMNS = [
  "name", "bg_color", "fg_color", "label_color", "redeem_template", "earn_rate",
  "loyalty_mode", "stamp_goal", "stamp_reward", "review_url", "latitude", "longitude",
  "happy_hour", "birthday_reward",
] as const;

// Did a save change anything a card shows? Both rows come from the same
// select("*"), so a column compares equal in the same representation.
export function cardVisibleChange(before: Record<string, unknown> | null, after: Record<string, unknown> | null): boolean {
  return CARD_COLUMNS.some((c) => JSON.stringify(before?.[c] ?? null) !== JSON.stringify(after?.[c] ?? null));
}

// A merchant setting every card shows changed: bump each card's updated_at so
// Wallet's passesUpdatedSince poll lists it, then push, as a campaign does for
// its cards. Best-effort: the setting is already saved, and a card that misses
// the push still picks the change up on its next refresh. Callers run it with
// next/server's after(), so the save's response never waits on APNs.
export async function refreshMerchantCards(merchantId: string): Promise<void> {
  try {
    const { error } = await db
      .from("passes")
      .update({ updated_at: new Date().toISOString() })
      .eq("merchant_id", merchantId);
    if (error) throw new Error(error.message);
    // keyset pages: PostgREST caps one read at 1000 rows
    for (let last = ""; ; ) {
      const { data: page, error: readError } = await db
        .from("passes")
        .select("serial")
        .eq("merchant_id", merchantId)
        .gt("serial", last)
        .order("serial")
        .limit(1000);
      if (readError) throw new Error(readError.message);
      if (!page?.length) break;
      await wallet.notify(page.map((p) => p.serial as string));
      if (page.length < 1000) break;
      last = page[page.length - 1].serial as string;
    }
  } catch (e) {
    console.warn("refreshMerchantCards failed:", e instanceof Error ? e.message : e);
  }
}
