"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth";
import { isSupportUsername } from "@/lib/admin/merchant";

// Owners see every staff page; cashiers only the counter. The server pages
// enforce this too — the nav just doesn't offer links a role can't open.
const NAV: Record<Role, { href: string; label: string }[]> = {
  owner: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/customers", label: "Customers" },
    { href: "/campaigns", label: "Campaigns" },
    { href: "/scan", label: "Scan" },
    { href: "/staff", label: "Staff" },
    { href: "/settings", label: "Settings" },
  ],
  cashier: [{ href: "/scan", label: "Scan" }],
};

// The one header on every logged-in staff page, rendered by (merchant)/layout.
// Client-side only for usePathname (current-page highlight).
export default function StaffHeader({
  merchantId,
  merchantName,
  username,
  role,
}: {
  merchantId: string;
  merchantName: string;
  username: string;
  role: Role;
}) {
  const path = usePathname();
  // The layout persists across client-side navigations, so a page that pushes
  // to /login on a 401 would otherwise keep showing a header for a dead session.
  if (path === "/login") return null;

  return (
    <header className="staff-top">
      {/* The creator signed in through /admin's "Manage as owner": say so on
          every page, so nobody mistakes this session for the owner's. */}
      {isSupportUsername(username) && (
        <div className="staff-support" role="note">
          <span>42nights support — managing {merchantName}</span>
          <Link href={`/admin/merchants/${merchantId}`}>Back to admin</Link>
        </div>
      )}
      <div className="staff-brand">
        <span className="dot" />
        <span className="staff-merchant">{merchantName}</span>
      </div>
      <nav className="staff-nav" aria-label="Staff pages">
        {NAV[role].map((n) => {
          const current = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined}>
              {n.label}
            </Link>
          );
        })}
      </nav>
      {/* A plain form post: the 303 to /login is a full page load, which also
          re-renders this layout without the header. Works with JS off. */}
      <form className="staff-who" method="post" action="/api/merchant/logout">
        <span className="staff-user" title={username}>{username}</span>
        <button className="staff-out" type="submit">Sign out</button>
      </form>
    </header>
  );
}
