import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import CustomersTable from "./CustomersTable";

export const runtime = "nodejs";

export default async function CustomersPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner") redirect("/scan");
  return <CustomersTable />;
}
