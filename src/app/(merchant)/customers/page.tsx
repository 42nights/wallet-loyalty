import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { loyaltyMode } from "@/lib/config";
import PageHead from "@/components/PageHead";
import CustomersTable, { ExportMenu } from "./CustomersTable";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");
  const [{ data: merchant }, { data: seg }] = await Promise.all([
    // "*": the loyalty_mode column may not exist yet (then it's points)
    db.from("merchants").select("*").eq("id", staff.merchantId).maybeSingle(),
    db.rpc("merchant_segments", { p_merchant: staff.merchantId }),
  ]);
  // merchant_segments lists every card of this shop, so it also gives the
  // all-customers total for the header, whatever the search box holds.
  const list = (seg as { customers?: { serial: string; segment: string }[] } | null)?.customers ?? [];
  const groups = Object.fromEntries(list.map((c) => [c.serial, c.segment]));
  const total = list.length;

  return (
    <div className="page">
      <PageHead
        title="Customers"
        sub={`${total.toLocaleString("en-US")} customer${total === 1 ? "" : "s"}`}
        actions={<ExportMenu />}
      />
      <CustomersTable mode={loyaltyMode(merchant?.loyalty_mode)} groups={groups} />
    </div>
  );
}
