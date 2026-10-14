import { db } from "./supabase";
import { wallet } from "./wallet";

// The single source of truth for a balance change. All the hard guarantees —
// atomic update, no negative balance, tenant scoping, idempotent replay — live
// in the apply_points() SQL function (BUILD_PLAN §6.1). App code never
// read-then-writes a balance. After a real change, notify devices to re-fetch.

export type ApplyResult =
  | { ok: true; newBalance: number; replay: boolean }
  | { ok: false; status: "insufficient"; balance: number }
  | { ok: false; status: "not_found" }
  | { ok: false; status: "voided" }
  | { ok: false; status: "error"; error: string };

type ApplyRow = { status: string; balance: number | null };

// What staff are told when they try to use a deactivated card (409).
export const VOIDED_ERROR = "This card is deactivated. The owner can reactivate it on the customer's page.";

export async function applyTransaction(
  ...args: Parameters<typeof applyPoints>
): Promise<ApplyResult> {
  const result = await applyPoints(...args);
  if (result.ok && !result.replay) {
    // a real change → tell every device holding this card to re-fetch.
    // Best-effort: the balance is already committed, so a push error must not
    // turn a successful redeem/earn into a failure response.
    try {
      await wallet.notify([args[0]]);
    } catch (e) {
      console.warn("wallet.notify failed:", e instanceof Error ? e.message : e);
    }
  }
  return result;
}

export async function applyPoints(
  serial: string,
  delta: number,
  reason: string,
  staffId: string | null, // null = no person (the birthday cron)
  merchantId: string,
  idempotencyKey: string,
  amount?: number | null
): Promise<ApplyResult> {
  // A deactivated card takes no balance change of any kind. Checked here
  // because every balance change goes through this function: redeem, adjust
  // and undo (via applyTransaction) and campaigns. select("*") so a database
  // without passes.voided_at yet behaves as before.
  // ponytail: a void that commits between this read and the RPC lets that one
  // in-flight tap through; closing it needs the check inside apply_points.
  const { data: card, error: cardError } = await db
    .from("passes")
    .select("*")
    .eq("serial", serial)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (cardError) return { ok: false, status: "error", error: cardError.message };
  if (card?.voided_at) return { ok: false, status: "voided" };

  const { data, error } = await db.rpc("apply_points", {
    p_serial: serial,
    p_delta: delta,
    p_reason: reason,
    p_staff: staffId,
    p_merchant: merchantId,
    p_idempo: idempotencyKey,
    p_amount: amount ?? null,
  });

  if (error) return { ok: false, status: "error", error: error.message };

  // apply_points returns table(status, balance) → a one-row array.
  const row = (Array.isArray(data) ? data[0] : data) as ApplyRow | undefined;
  if (!row) return { ok: false, status: "error", error: "No result" };

  switch (row.status) {
    case "applied":
      return { ok: true, newBalance: row.balance ?? 0, replay: false };
    case "replay":
      // duplicate (idempotent retry): balance unchanged, no push needed
      return { ok: true, newBalance: row.balance ?? 0, replay: true };
    case "insufficient":
      return { ok: false, status: "insufficient", balance: row.balance ?? 0 };
    case "not_found":
      return { ok: false, status: "not_found" };
    default:
      return { ok: false, status: "error", error: `Unexpected status: ${row.status}` };
  }
}
