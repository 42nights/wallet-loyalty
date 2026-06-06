import { db } from "./supabase";
import { wallet } from "./wallet";

export type ApplyResult =
  | { ok: true; newBalance: number }
  | { ok: false; error: string; balance?: number };

// The single source of truth for a balance change.
// 1. guard (no negative balance on redeem)
// 2. write a ledger row + update cached balance
// 3. notify every device that has this card so Wallet re-fetches
export async function applyTransaction(
  serial: string,
  delta: number,
  reason: string,
  staffId: string
): Promise<ApplyResult> {
  const { data: pass, error } = await db
    .from("passes")
    .select("serial, points")
    .eq("serial", serial)
    .single();

  if (error || !pass) return { ok: false, error: "Card not found" };

  const newBalance = pass.points + delta;
  if (newBalance < 0) {
    return { ok: false, error: "Not enough points", balance: pass.points };
  }

  // ledger row
  await db.from("transactions").insert({
    serial,
    delta,
    reason,
    staff_id: staffId,
  });

  // cached balance + updated_at (drives the "LAST UPDATED" field)
  const { error: upErr } = await db
    .from("passes")
    .update({ points: newBalance, updated_at: new Date().toISOString() })
    .eq("serial", serial);

  if (upErr) return { ok: false, error: "Update failed" };

  // notify all registered devices for this card → Wallet re-fetches
  await wallet.notify([serial]);

  return { ok: true, newBalance };
}
