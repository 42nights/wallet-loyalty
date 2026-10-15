"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Role } from "@/lib/auth";
import { isSupportUsername } from "@/lib/admin/merchant";
import Icon, { type IconName } from "@/components/Icon";
import ThemeToggle from "@/components/ThemeToggle";

// Owner places. Cashiers get no tabs: their one page is /scan. The server pages
// enforce roles too; the nav only avoids offering links a role can't open.
const TABS = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/customers", label: "Customers", icon: "users" },
  { href: "/campaigns", label: "Campaigns", icon: "megaphone" },
  { href: "/staff", label: "Staff", icon: "staff" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const satisfies readonly { href: string; label: string; icon: IconName }[];
const MORE = TABS.slice(3);

const isAt = (path: string, href: string) => path === href || path.startsWith(href + "/");
const here = (path: string, href: string) => (isAt(path, href) ? "page" : undefined);

// The one header on every logged-in staff page, rendered by (merchant)/layout.
// Phone (≤640): a top bar plus, for owners, a bottom tab bar. The tab bar is a
// sibling of <header>, not a child: the header's backdrop-filter would become
// the containing block of anything position:fixed inside it.
export default function StaffHeader({
  merchantId,
  merchantName,
  username,
  role,
  theme,
}: {
  merchantId: string;
  merchantName: string;
  username: string;
  role: Role;
  theme: "light" | "dark";
}) {
  const path = usePathname();
  const acct = useRef<HTMLDetailsElement>(null);
  const more = useRef<HTMLDetailsElement>(null);

  // The layout persists across client navigations, so close the menus when the
  // page changes, on Escape, and on a click outside them (or on one of their links).
  useEffect(() => {
    for (const d of [acct.current, more.current]) if (d) d.open = false;
  }, [path]);
  useEffect(() => {
    const menus = () => [acct.current, more.current].filter((d): d is HTMLDetailsElement => !!d?.open);
    function onClick(e: MouseEvent) {
      const t = e.target as Element;
      for (const d of menus()) if (!d.contains(t) || t.closest(".acct-menu a, .more-sheet a")) d.open = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      for (const d of menus()) {
        d.open = false;
        d.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // A page that pushes to /login on a 401 would otherwise keep a header for a dead session.
  if (path === "/login") return null;

  const owner = role === "owner";
  // A plain form post: the 303 to /login is a full page load, which also
  // re-renders the layout without the header. Works with JS off.
  const signOut = (
    <form method="post" action="/api/merchant/logout">
      <button className={owner ? "acct-row staff-out" : "btn btn-ghost btn-sm staff-out"} type="submit">
        Sign out
      </button>
    </form>
  );

  return (
    <>
      {/* The creator signed in through /admin's "Manage as owner": say so on
          every page, so nobody mistakes this session for the owner's. */}
      {isSupportUsername(username) && (
        <div className="staff-support" role="note">
          <div className="staff-support__in">
            <Icon name="shield" />
            <span>42nights support — managing {merchantName}</span>
            <Link href={`/admin/merchants/${merchantId}`}>Back to admin</Link>
          </div>
        </div>
      )}
      <header className="staff-top">
        <div className="staff-bar">
          <Link className="staff-brand" href={owner ? "/dashboard" : "/scan"}>
            <span className="mono-tile" aria-hidden="true">{Array.from(merchantName.trim())[0]?.toUpperCase()}</span>
            <span className="staff-merchant">{merchantName}</span>
          </Link>
          {owner && (
            <nav className="staff-nav" aria-label="Main">
              {TABS.map((t) => (
                <Link key={t.href} href={t.href} aria-current={here(path, t.href)}>
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
          {owner && (
            <Link className="btn btn-primary btn-sm staff-scan" href="/scan" aria-current={here(path, "/scan")}>
              <Icon name="scan" />
              <span className="staff-scan__label">Scan</span>
            </Link>
          )}
          <details className="acct" ref={acct}>
            <summary aria-label={`Account: ${username}`}>
              <span className="avatar avatar--sm" aria-hidden="true">{username.slice(0, 2)}</span>
              <span className="staff-user" title={username}>{username}</span>
              <Icon name="chevron-down" className="acct-chev" />
            </summary>
            <div className="acct-menu">
              <div className="acct-name">Signed in as {username}</div>
              <ThemeToggle initial={theme} />
              {owner && signOut}
            </div>
          </details>
          {!owner && signOut}
        </div>
      </header>
      {owner && (
        <nav className="tabbar" aria-label="Main">
          {TABS.slice(0, 2).map((t) => <Tab key={t.href} path={path} {...t} />)}
          <Link className="tab tab--scan" href="/scan" aria-current={here(path, "/scan")}>
            <span className="tab-ico"><Icon name="scan" size={20} /></span>
            Scan
          </Link>
          <Tab path={path} {...TABS[2]} />
          <details className="tab-more" ref={more}>
            <summary className="tab" data-current={MORE.some((t) => isAt(path, t.href)) || undefined}>
              <span className="tab-ico"><Icon name="more" size={20} /></span>
              More
            </summary>
            <div className="more-sheet">
              {MORE.map((t) => (
                <Link key={t.href} href={t.href} aria-current={here(path, t.href)}>
                  <Icon name={t.icon} size={20} />
                  {t.label}
                  <Icon name="chevron-right" className="more-chev" />
                </Link>
              ))}
            </div>
          </details>
        </nav>
      )}
    </>
  );
}

function Tab({ path, href, icon, label }: { path: string; href: string; icon: IconName; label: string }) {
  return (
    <Link className="tab" href={href} aria-current={here(path, href)}>
      <span className="tab-ico"><Icon name={icon} size={20} /></span>
      {label}
    </Link>
  );
}
