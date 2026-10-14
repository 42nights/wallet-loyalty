import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { loyaltyMode } from "@/lib/config";
import CustomersTable from "./CustomersTable";

export const runtime = "nodejs";

export default async function CustomersPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");
  // "*": the loyalty_mode column may not exist yet (then it's points)
  const { data: merchant } = await db.from("merchants").select("*").eq("id", staff.merchantId).maybeSingle();
  return <CustomersTable mode={loyaltyMode(merchant?.loyalty_mode)} />;
}
