import { db } from "@/lib/supabase";
import { buildApplePass } from "./pass";
import { pushMany } from "./apns";
import type { WalletProvider, PassData } from "../types";

// Apple Wallet implementation of the provider seam.
export const appleProvider: WalletProvider = {
  async buildPass(data: PassData) {
    const buffer = await buildApplePass(data);
    return { buffer, contentType: "application/vnd.apple.pkpass" };
  },

  async notify(serials: string[]) {
    if (!serials.length) return;

    const { data: regs } = await db
      .from("registrations")
      .select("device_lib_id")
      .in("serial", serials);

    const deviceIds = Array.from(
      new Set((regs ?? []).map((r) => r.device_lib_id as string))
    );
    if (!deviceIds.length) return;

    const { data: devs } = await db
      .from("devices")
      .select("push_token")
      .in("device_lib_id", deviceIds);

    const tokens = Array.from(
      new Set(
        (devs ?? [])
          .map((d) => d.push_token as string)
          .filter((t): t is string => Boolean(t))
      )
    );

    if (!tokens.length) return;

    const results = await pushMany(tokens);

    // 410 Gone → the device unregistered the pass; prune it. Deleting the device
    // cascades to its registrations (FK on delete cascade).
    const dead = results.filter((r) => r.status === 410).map((r) => r.token);
    if (dead.length) {
      await db.from("devices").delete().in("push_token", dead);
    }
  },
};
