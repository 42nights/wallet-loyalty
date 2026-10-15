import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import PageHead from "@/components/PageHead";
import SettingsForm from "./SettingsForm";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");
  return (
    <div className="page">
      <PageHead
        title="Settings"
        sub="How your loyalty card works. Changes reach customers' Wallet cards within seconds."
      />
      <SettingsForm />
    </div>
  );
}
