import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { loyaltyMode, stampGoal, unitLabel } from "@/lib/config";
import { SEGMENTS } from "@/lib/segments";
import PageHead from "@/components/PageHead";
import CampaignsClient from "./CampaignsClient";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string | string[] }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");

  // Group counts so the owner sees how many cards each target hits.
  const [{ data: seg }, { data: merchant }, { segment: asked }] = await Promise.all([
    db.rpc("merchant_segments", { p_merchant: staff.merchantId }),
    // "*": the loyalty_mode column may not exist yet (then it's points)
    db.from("merchants").select("*").eq("id", staff.merchantId).maybeSingle(),
    searchParams,
  ]);
  const counts = (seg as { counts?: Record<string, number> } | null)?.counts ?? {};
  const mode = loyaltyMode(merchant?.loyalty_mode);
  // ?segment= (the dashboard's win-back link) picks the group, unless it's empty.
  const initial =
    SEGMENTS.find((s) => s.key === asked && (counts[s.key] ?? 0) > 0) ??
    SEGMENTS.find((s) => (counts[s.key] ?? 0) > 0) ??
    SEGMENTS[0];

  return (
    <div className="page">
      <PageHead
        title="Campaigns"
        sub={`Give a group of customers bonus ${unitLabel(mode, 2)} or an offer on their Wallet card.`}
      />
      <CampaignsClient
        key={initial.key}
        counts={counts}
        initialSegment={initial.key}
        mode={mode}
        stampGoal={stampGoal(merchant?.stamp_goal)}
      />
    </div>
  );
}
