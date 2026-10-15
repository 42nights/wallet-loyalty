"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatPhone } from "@/lib/format";
import { unitLabel, type LoyaltyMode } from "@/lib/config";
import { segmentDefinition, segmentLabel } from "@/lib/segments";
import s from "./customers.module.css";

type Cust = {
  serial: string;
  customer_name: string | null;
  customer_phone: string | null;
  points: number;
  lifetime_earned: number;
  visits: number;
  last_seen: string | null;
};
type Sort = "recent" | "points" | "lifetime" | "name";

const PAGE = 50; // the API's default page size, sent explicitly
// ponytail: the API caps one call at 200 rows, so Back restores at most 4 pages;
// fetch in a loop if owners page deeper than that.
const MAX_PAGES = 4;
const SORTS: readonly Sort[] = ["recent", "points", "lifetime", "name"];
const nf = (n: number) => n.toLocaleString("en-US");
const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
const full = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

// "Today", "Yesterday", "3 days ago", "Last week", "5 months ago": calendar
// days on this device's clock.
function ago(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.max(0, Math.round((day(now) - day(d)) / 864e5));
  const [n, unit]: [number, Intl.RelativeTimeFormatUnit] =
    days < 7 ? [days, "day"] : days < 30 ? [Math.floor(days / 7), "week"]
      : days < 365 ? [Math.floor(days / 30), "month"] : [Math.floor(days / 365), "year"];
  const t = rtf.format(-n, unit);
  return t[0].toUpperCase() + t.slice(1);
}

const initials = (name: string | null) => {
  const w = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return w.length ? w[0][0] + (w.length > 1 ? w[w.length - 1][0] : "") : "?";
};

// Phones are stored as digits ("+14155550168"), so "(415) 555-0168" only
// matches once the punctuation is gone. Names are sent as typed.
function searchTerm(q: string): string {
  const t = q.trim();
  const digits = t.replace(/\D/g, "");
  return /^[\d\s()+.-]+$/.test(t) && digits.length >= 3 ? digits : t;
}

export default function CustomersTable({ mode, groups }: { mode: LoyaltyMode; groups: Record<string, string> }) {
  const router = useRouter();
  const params = useSearchParams();
  const fromUrl = () => {
    const sort = params.get("sort") as Sort;
    const n = parseInt(params.get("n") ?? "", 10) || 1;
    return {
      q: params.get("q") ?? "",
      sort: SORTS.includes(sort) ? sort : "recent",
      n: Math.min(Math.max(n, 1), MAX_PAGES),
    };
  };
  // Back from a customer remounts this on the URL that replaceState left.
  const [init] = useState(fromUrl);
  const [q, setQ] = useState(init.q); // the box
  const [term, setTerm] = useState(init.q); // what was searched, debounced
  const [sort, setSort] = useState<Sort>(init.sort);
  const [rows, setRows] = useState<Cust[]>([]);
  const [total, setTotal] = useState(0);
  // Paging follows the SERVER offset (rows fetched so far), not rows.length:
  // de-duplicating a row that shifted pages made rows.length lag the offset, so
  // "Load more" re-fetched the same page forever and skipped a customer.
  const [fetched, setFetched] = useState(0);
  const [more, setMore] = useState(false);
  const [loadingAt, setLoadingAt] = useState<number | null>(0); // offset in flight
  const [failed, setFailed] = useState(false);
  // Bumped by every fresh search/sort, so a slow older response (first page or
  // "Load more") can't land on top of the newer list.
  const seq = useRef(0);
  // The first load brings back every page the URL says was open; set to one
  // page by the handlers, not the effect, so a double-run effect can't lose it.
  const firstLimit = useRef(init.n * PAGE);
  const last = useRef({ offset: 0, limit: PAGE });
  const box = useRef<HTMLInputElement>(null);
  // The rows load after mount, so the browser's own scroll restoration lands
  // on an empty list. A row click keeps scrollY in history.state; Back puts it
  // back once the first rows are on screen.
  const restoreY = useRef<number | null>(null);
  // Cleared by a row click: a search response landing mid-navigation must not
  // replaceState the list URL back, which cancels the move to the customer.
  const live = useRef(true);

  async function fetchPage(offset: number, limit: number) {
    const id = offset === 0 ? ++seq.current : seq.current;
    last.current = { offset, limit };
    setLoadingAt(offset);
    setFailed(false);
    const res = await fetch(
      `/api/merchant/customers?search=${encodeURIComponent(searchTerm(term))}&sort=${sort}&limit=${limit}&offset=${offset}`
    ).catch(() => null);
    if (id !== seq.current) return;
    if (res?.status === 401) return router.push("/login");
    if (res?.status === 403) return router.push("/scan?denied=1");
    const d: { total?: number; customers?: Cust[] } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (id !== seq.current) return;
    setLoadingAt(null);
    if (!d) return setFailed(true);
    const page = d.customers ?? [];
    setTotal(d.total ?? 0);
    setFetched(offset + page.length);
    setMore(page.length === limit);
    setRows((prev) => {
      if (offset === 0) return page;
      // A customer enrolling between pages shifts the offset by one; skip the
      // row we already have rather than render it twice.
      const have = new Set(prev.map((c) => c.serial));
      return [...prev, ...page.filter((c) => !have.has(c.serial))];
    });
    // Native replaceState, not router.replace: Next keeps useSearchParams in
    // step without re-rendering the server page on every keystroke.
    const url = new URLSearchParams();
    if (term.trim()) url.set("q", term.trim());
    if (sort !== "recent") url.set("sort", sort);
    const pages = Math.ceil((offset + page.length) / PAGE);
    if (pages > 1) url.set("n", String(pages));
    const qs = url.toString();
    if (!live.current) return;
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }

  useEffect(() => {
    if (q === term) return;
    const t = setTimeout(() => setTerm(q), 250);
    return () => clearTimeout(t);
  }, [q, term]);

  useEffect(() => {
    const y: unknown = window.history.state?.scrollY;
    if (typeof y === "number") restoreY.current = y;
  }, []);

  useLayoutEffect(() => {
    if (restoreY.current === null || rows.length === 0) return;
    window.scrollTo(0, restoreY.current);
    restoreY.current = null;
  }, [rows]);

  useEffect(() => {
    fetchPage(0, firstLimit.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, sort]);

  // A link to plain /customers (the Customers tab) changes the URL without
  // remounting this; our own replaceState always matches term and sort.
  const qs = params.toString();
  useEffect(() => {
    const url = fromUrl();
    if (url.q === term.trim() && url.sort === sort) return;
    firstLimit.current = PAGE;
    setQ(url.q);
    setTerm(url.q);
    setSort(url.sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  function type(v: string) {
    firstLimit.current = PAGE;
    setQ(v);
  }
  function clear() {
    firstLimit.current = PAGE;
    setQ("");
    setTerm("");
    box.current?.focus();
  }
  function sortBy(v: Sort) {
    firstLimit.current = PAGE;
    setSort(v);
  }

  const loading = loadingAt !== null;
  const first = loading && rows.length === 0 && !failed;
  const unit = mode === "stamps" ? "Stamps" : "Points";
  const left = Math.max(0, total - rows.length);
  const count = rows.length < total
    ? `Showing ${nf(rows.length)} of ${nf(total)} customers`
    : `${nf(total)} customer${total === 1 ? "" : "s"}`;
  const head: { label: string; sort?: Sort; num?: boolean; cls?: string }[] = [
    { label: "Name", sort: "name" },
    { label: "Phone" },
    { label: "Group", cls: s.colGroup },
    { label: "Balance", sort: "points", num: true },
    { label: `${unit} earned`, sort: "lifetime", num: true, cls: s.colLifetime },
    { label: "Visits", num: true },
    { label: "Last visit", sort: "recent", num: true },
  ];
  const order: Record<Sort, string> = {
    name: "A to Z", points: "highest first", lifetime: "highest first", recent: "most recent first",
  };

  return (
    <section
      className={`panel ${s.panel}`}
      aria-label="Customer list"
      aria-busy={loading}
      data-pending={(loadingAt === 0 && rows.length > 0) || undefined}
    >
      <div className={s.toolbar}>
        <div className={s.search}>
          <Icon name="search" />
          <input
            ref={box}
            type="search"
            value={q}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.preventDefault();
                clear();
              }
            }}
            placeholder="search name / phone…"
            aria-label="Search customers"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {q && (
            <button type="button" className={s.clear} onClick={clear} aria-label="Clear search">
              <Icon name="x" />
            </button>
          )}
        </div>
        <label className={s.sortBy}>
          Sort by
          <select value={sort} onChange={(e) => sortBy(e.target.value as Sort)}>
            <option value="recent">Last visit</option>
            <option value="points">Balance</option>
            <option value="lifetime">{unit} earned</option>
            <option value="name">Name</option>
          </select>
        </label>
        <p className={s.count} aria-live="polite">
          {first ? <span className={`skel-line ${s.countSkel}`} /> : !(failed && rows.length === 0) && count}
        </p>
      </div>

      <div className={`tbl ${s.tbl}`}>
        <div className="tbl-head">
          {head.map((h) => {
            const on = h.sort === sort;
            return (
              <div
                key={h.label}
                className={`th${h.num ? " num" : ""} ${h.cls ?? ""}`}
                aria-sort={on ? (sort === "name" ? "ascending" : "descending") : undefined}
              >
                {h.sort ? (
                  <button type="button" className={`th-sort ${s.sortBtn}`} onClick={() => sortBy(h.sort!)}>
                    {h.label}
                    <Icon name="chevron-down" className={h.sort === "name" ? s.up : undefined} />
                    {on && <span className="sr-only">, sorted {order[sort]}</span>}
                  </button>
                ) : (
                  h.label
                )}
              </div>
            );
          })}
        </div>

        {first ? (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`tbl-row ${s.skelRow}`} aria-hidden="true">
              <span className={`td td-name ${s.name}`}>
                <span className={`skel ${s.skelAvatar}`} />
                <span className={`skel-line ${s.skName}`} />
              </span>
              <span className="td"><span className={`skel-line ${s.skPhone}`} /></span>
              <span className={`td ${s.colGroup}`}><span className={`skel-line ${s.skChip}`} /></span>
              <span className="td num td-value"><span className={`skel-line ${s.skNum}`} /></span>
              <span className={`td num ${s.colLifetime}`}><span className={`skel-line ${s.skNum}`} /></span>
              <span className="td num"><span className={`skel-line ${s.skTiny}`} /></span>
              <span className="td num td-date"><span className={`skel-line ${s.skDate}`} /></span>
              <span className="td td-meta phone-only"><span className={`skel-line ${s.skPhone}`} /></span>
            </div>
          ))
        ) : (
          <div className="pending-dim">
            {rows.map((c) => {
              const seg = groups[c.serial];
              const phone = formatPhone(c.customer_phone);
              return (
                <Link
                  key={c.serial}
                  href={`/customers/${c.serial}`}
                  className="tbl-row"
                  onClick={(e) => {
                    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) live.current = false;
                    window.history.replaceState({ ...window.history.state, scrollY: window.scrollY }, "");
                  }}
                >
                  <span className={`td td-name ${s.name}`}>
                    <span className={`avatar ${s.avatar}`} aria-hidden="true">{initials(c.customer_name)}</span>
                    <span className={s.nameText}>{c.customer_name || "No name"}</span>
                    {seg && <span className={`chip ${s.phoneChip}`} data-seg={seg}>{segmentLabel(seg)}</span>}
                  </span>
                  <span className={`td ${s.dim}`}>{phone || "—"}</span>
                  <span className={`td ${s.colGroup}`}>
                    {seg && <span className="chip" data-seg={seg} title={segmentDefinition(seg)}>{segmentLabel(seg)}</span>}
                  </span>
                  <span className={`td num td-value ${s.balance}`}>{nf(c.points)} {unitLabel(mode, c.points, true)}</span>
                  <span className={`td num ${s.dim} ${s.colLifetime}`}>{nf(c.lifetime_earned)}</span>
                  <span className={`td num ${s.dim}`}>{nf(c.visits)}</span>
                  {c.visits > 0 && c.last_seen ? (
                    <span className={`td num td-date ${s.dim}`} title={full.format(new Date(c.last_seen))}>{ago(c.last_seen)}</span>
                  ) : (
                    <span className={`td num td-date ${s.never}`}>No visits</span>
                  )}
                  <span className="td td-meta phone-only">
                    {[phone, `${nf(c.visits)} visit${c.visits === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {failed && (
        <div className={s.error}>
          <div className="toast bad" role="alert">
            <Icon name="alert" />
            Couldn&apos;t load customers — check the connection and try again.
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fetchPage(last.current.offset, last.current.limit)}>
            Try again
          </button>
        </div>
      )}

      {!loading && !failed && rows.length === 0 && (term.trim() ? (
        <div className="empty">
          <Icon name="search" />
          <p className="empty-t">No customers match &ldquo;{term.trim()}&rdquo;</p>
          <p className="empty-p">Check the spelling, or search by phone number instead.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear search</button>
        </div>
      ) : (
        <div className="empty">
          <Icon name="users" />
          <p className="empty-t">No customers yet</p>
          <p className="empty-p">Share your sign-up poster — customers who scan it show up here.</p>
          <Link className="btn btn-ghost btn-sm" href="/settings/poster">Print sign-up poster</Link>
        </div>
      ))}

      {more && left > 0 && !failed && (
        <div className={s.foot}>
          <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => fetchPage(fetched, PAGE)}>
            {loadingAt ? "Loading…" : left > PAGE ? `Show ${PAGE} more · ${nf(left)} left` : `Show ${nf(left)} more`}
          </button>
        </div>
      )}
    </section>
  );
}

// Plain links: the route's Content-Disposition names the file. Exports are
// always everyone, whatever the search box holds.
export function ExportMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function close(e: MouseEvent | KeyboardEvent) {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        d.open = false;
        d.querySelector("summary")?.focus();
      } else if (!d.contains(e.target as Node) || (e.target as Element).closest("a")) {
        d.open = false;
      }
    }
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className={s.export}>
      <summary className="btn btn-ghost">
        <Icon name="download" />
        Export
        <Icon name="chevron-down" className={s.chev} />
      </summary>
      <div className={s.menu}>
        <a href="/api/merchant/export?type=customers" download>
          <span className={s.menuT}>Customer list (CSV)</span>
          <span className={s.menuP}>Name, phone, balance and visits</span>
        </a>
        <a href="/api/merchant/export?type=transactions" download>
          <span className={s.menuT}>Every visit &amp; reward (CSV)</span>
          <span className={s.menuP}>The full history, one row per entry</span>
        </a>
        <p className={s.menuFoot}>Opens in Excel or Google Sheets.</p>
      </div>
    </details>
  );
}
