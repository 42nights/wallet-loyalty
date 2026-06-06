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
  | { ok: false; status: "error"; error: string };

type ApplyRow = { status: string; balance: number | null };

export async function applyTransaction(
  serial: string,
  delta: number,
  reason: string,
  staffId: string,
  merchantId: string,
  idempotencyKey: string
): Promise<ApplyResult> {
  const { data, error } = await db.rpc("apply_points", {
    p_serial: serial,
    p_delta: delta,
    p_reason: reason,
    p_staff: staffId,
    p_merchant: merchantId,
    p_idempo: idempotencyKey,
  });

  if (error) return { ok: false, status: "error", error: error.message };

  // apply_points returns table(status, balance) → a one-row array.
  const row = (Array.isArray(data) ? data[0] : data) as ApplyRow | undefined;
  if (!row) return { ok: false, status: "error", error: "No result" };

  switch (row.status) {
    case "applied":
      // a real change → tell every device holding this card to re-fetch
      await wallet.notify([serial]);
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
