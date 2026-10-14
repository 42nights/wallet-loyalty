import { db } from "@/lib/supabase";
import { appleProvider } from "./apple/provider";
import type { WalletProvider } from "./types";

// The active wallet provider. Apple today; swap/extend for Google Wallet later
// without touching routes or the points engine.
export const wallet: WalletProvider = appleProvider;

// A merchant setting every card shows has changed (the stamp reward, mode or
// goal): mark all the merchant's cards changed, so Wallet's passesUpdatedSince
// poll lists them, and push — what the campaigns route does for the cards it
// touches. Best-effort like applyTransaction: the setting is already saved, so
// a failure is logged and the cards catch up on their next earn or redeem.
// ponytail: pushes inline (~100 cards per APNs batch); a shop with tens of
// thousands of cards would want this in a background job.
export async function refreshMerchantCards(merchantId: string): Promise<void> {
  try {
    const { data, error } = await db
      .from("passes")
      .update({ updated_at: new Date().toISOString() })
      .eq("merchant_id", merchantId)
      .select("serial");
    if (error) throw new Error(error.message);
    await wallet.notify((data ?? []).map((p) => p.serial as string));
  } catch (e) {
    console.warn("refreshMerchantCards failed:", e instanceof Error ? e.message : e);
  }
}

export type { WalletProvider, PassData } from "./types";
