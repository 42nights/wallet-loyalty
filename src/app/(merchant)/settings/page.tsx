import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import SettingsForm from "./SettingsForm";

export const runtime = "nodejs";

export default async function SettingsPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan");
  return <SettingsForm />;
}
