import { redirect } from "next/navigation";
import Link from "next/link";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import CampaignsClient from "./CampaignsClient";

export const runtime = "nodejs";

const SEGMENT_ORDER = ["vip", "regular", "new", "active", "at_risk", "lapsed", "dormant"];
const SEGMENT_LABEL: Record<string, string> = {
  vip: "VIP", regular: "Regular", new: "New", active: "Active",
  at_risk: "At-risk", lapsed: "Lapsed", dormant: "Dormant",
};

export default async function CampaignsPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan");

  // Segment counts so the owner sees how many cards each target hits.
  const { data: seg } = await db.rpc("merchant_segments", { p_merchant: staff.merchantId });
  const counts = (seg as { counts?: Record<string, number> } | null)?.counts ?? {};
  const segments = SEGMENT_ORDER.map((k) => ({
    key: k,
    label: SEGMENT_LABEL[k],
    count: counts[k] ?? 0,
  }));

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>campaigns</small>
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        <Link className="btn btn-ghost" href="/dashboard">← Dashboard</Link>
        <Link className="btn btn-ghost" href="/customers">Customers</Link>
      </div>
      <CampaignsClient segments={segments} />
    </div>
  );
}
