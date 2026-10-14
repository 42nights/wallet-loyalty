import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { AdminHeader } from "../../ui";
import NewMerchant from "./NewMerchant";

export const runtime = "nodejs";

export default async function NewMerchantPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return (
    <div className="dash">
      <AdminHeader />
      <NewMerchant />
    </div>
  );
}
