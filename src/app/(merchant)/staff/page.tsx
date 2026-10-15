import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import StaffManager from "./StaffManager";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");
  return (
    <div className="page">
      <PageHead title="Staff" sub="People who can sign in to your shop. Cashiers only see the Scan screen." />
      <StaffManager />
    </div>
  );
}
