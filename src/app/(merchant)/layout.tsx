import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import StaffHeader from "@/components/StaffHeader";

// Shared shell for the staff app. Logged out (e.g. /login) there is no header;
// logged in, every page gets the same one. Pages still do their own role
// checks — this layout only decides what to show, never who may see a page.
export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  if (!staff?.merchantId) return children;

  const { data: merchant } = await db
    .from("merchants")
    .select("name")
    .eq("id", staff.merchantId)
    .maybeSingle();

  return (
    <>
      <StaffHeader
        merchantName={merchant?.name ?? "Your shop"}
        username={staff.username}
        role={staff.role}
      />
      {children}
    </>
  );
}
