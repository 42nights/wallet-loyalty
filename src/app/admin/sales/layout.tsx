import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { AdminHeader } from "../ui";
import SalesNav from "./SalesNav";

export const runtime = "nodejs";

// The Sales section's frame: the admin header and the section tabs. Pages
// render only their own content, and each one checks isAdmin() itself too.
export default async function SalesLayout({ children }: { children: ReactNode }) {
  if (!(await isAdmin())) redirect("/admin/login");
  return (
    <div className="dash">
      <AdminHeader />
      <SalesNav />
      {children}
    </div>
  );
}
