import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { getStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import StaffHeader from "@/components/StaffHeader";

// Owner-app head settings live here, not in the root layout, so the landing,
// demo, enroll and admin pages keep their titles, bar colour and fonts.
export const metadata: Metadata = {
  title: { default: "42nights Loyalty", template: "%s · 42nights" },
};

// The bar colour follows the theme cookie (not the OS), like <html data-theme>.
export async function generateViewport(): Promise<Viewport> {
  const light = (await cookies()).get("theme")?.value === "light";
  return { themeColor: light ? "#f6f3ee" : "#0f0e0d", viewportFit: "cover" };
}

// The root link loads only Bricolage 600/800; enroll, landing and admin render
// weight 700 as that 800, so the full range would change them. The owner app
// needs real 400–800.
const OWNER_FONTS = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap";

// Shared shell for the staff app: .app scopes the owner design tokens (globals.css),
// so /enroll, / and /admin never see them. Logged out (e.g. /login) there is no
// header. Pages still do their own role checks — this layout only decides what
// to show, never who may see a page.
export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  let header: React.ReactNode = null;
  if (staff?.merchantId) {
    const { data: merchant } = await db
      .from("merchants")
      .select("name")
      .eq("id", staff.merchantId)
      .maybeSingle();
    header = (
      <StaffHeader
        merchantId={staff.merchantId}
        merchantName={merchant?.name ?? "Your shop"}
        username={staff.username}
        role={staff.role}
        theme={(await cookies()).get("theme")?.value === "light" ? "light" : "dark"}
      />
    );
  }

  return (
    <div className="app" data-role={staff?.merchantId ? staff.role : "none"}>
      <link rel="stylesheet" href={OWNER_FONTS} />
      <a className="skip-link" href="#main">Skip to content</a>
      {header}
      <main id="main" className="app-main">{children}</main>
    </div>
  );
}
