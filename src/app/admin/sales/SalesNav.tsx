"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./sales.module.css";

const TABS = [
  ["/admin/sales", "Today"],
  ["/admin/sales/leads", "Leads"],
  ["/admin/sales/import", "Import"],
  ["/admin/sales/team", "Team"],
  ["/admin/sales/scripts", "Scripts"],
  ["/admin/sales/practice", "Practice"],
] as const;

export default function SalesNav() {
  const path = usePathname();
  return (
    <nav className={s.tabs} aria-label="Sales">
      {TABS.map(([href, name]) => {
        const on = href === "/admin/sales" ? path === href : path === href || path.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} className={s.tab} aria-current={on ? "page" : undefined}>
            {name}
          </Link>
        );
      })}
    </nav>
  );
}
