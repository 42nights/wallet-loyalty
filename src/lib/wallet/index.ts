import { db } from "@/lib/supabase";
import { appleProvider } from "./apple/provider";
import type { WalletProvider } from "./types";

// The active wallet provider. Apple today; swap/extend for Google Wallet later
// without touching routes or the points engine.
export const wallet: WalletProvider = appleProvider;

export type { WalletProvider, PassData } from "./types";

// A merchant setting that every card shows changed (name, colours, template,
// earn rate, the stamp card, review link, location): bump each card's
// updated_at so Wallet's passesUpdatedSince poll lists it, then push, as a
// campaign does for its cards. Best-effort: the setting is already saved, and
// a card that misses the push still picks the change up on its next refresh.
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
