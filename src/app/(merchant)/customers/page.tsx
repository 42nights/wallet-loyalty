import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import CustomersTable from "./CustomersTable";

export const runtime = "nodejs";

export default async function CustomersPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");
  return <CustomersTable />;
}
