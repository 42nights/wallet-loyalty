import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";

// The one page header on every owner page (design spec §3.6): optional back
// link, the page title, a one-line description and the page's actions.
// titleAs="div" is for a page whose own content holds the only h1 (the poster).
export default function PageHead({
  title,
  sub,
  back,
  actions,
  titleAs: Title = "h1",
}: {
  title: ReactNode;
  sub?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  titleAs?: "h1" | "div";
}) {
  return (
    <header className="page-head">
      {back && (
        <Link className="back-link" href={back.href}>
          <Icon name="chevron-right" />
          {back.label}
        </Link>
      )}
      <div className="page-head__row">
        <div className="page-head__text">
          <Title className="page-title">{title}</Title>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {actions && <div className="page-head__actions">{actions}</div>}
      </div>
    </header>
  );
}
