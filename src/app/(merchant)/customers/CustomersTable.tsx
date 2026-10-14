"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatPhone } from "@/lib/format";
import { unitLabel, type LoyaltyMode } from "@/lib/config";

type Cust = {
  serial: string;
  customer_name: string | null;
  customer_phone: string | null;
  points: number;
  lifetime_earned: number;
  visits: number;
  last_seen: string | null;
};

const PAGE = 50; // the API's default page size, sent explicitly
const nf = (n: number) => n.toLocaleString();

export default function CustomersTable({ mode }: { mode: LoyaltyMode }) {
  const router = useRouter();
  const [rows, setRows] = useState<Cust[]>([]);
  const [total, setTotal] = useState(0);
  // Paging follows the SERVER offset (rows fetched so far), not rows.length:
  // de-duplicating a row that shifted pages made rows.length lag the offset, so
  // "Load more" re-fetched the same page forever and skipped a customer.
  const [fetched, setFetched] = useState(0);
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Bumped by every fresh search/sort, so a slow older response (first page or
  // "Load more") can't land on top of the newer list.
  const seq = useRef(0);

  async function fetchPage(offset: number) {
    const id = offset === 0 ? ++seq.current : seq.current;
    setLoading(true);
    setFailed(false);
    const res = await fetch(
      `/api/merchant/customers?search=${encodeURIComponent(search)}&sort=${sort}&limit=${PAGE}&offset=${offset}`
    ).catch(() => null);
    if (id !== seq.current) return;
    if (res?.status === 401) return router.push("/login");
    if (res?.status === 403) return router.push("/scan?denied=1");
    const d: { total?: number; customers?: Cust[] } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (id !== seq.current) return;
    setLoading(false);
    if (!d) return setFailed(true);
    const page = d.customers ?? [];
    setTotal(d.total ?? 0);
    setFetched(offset + page.length);
    setMore(page.length === PAGE);
    setRows((prev) => {
      if (offset === 0) return page;
      // A customer enrolling between pages shifts the offset by one; skip the
      // row we already have rather than render it twice.
      const have = new Set(prev.map((c) => c.serial));
      return [...prev, ...page.filter((c) => !have.has(c.serial))];
    });
  }

  // first page, debounced on search/sort
  useEffect(() => {
    const t = setTimeout(() => fetchPage(0), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort]);

  const count = more && rows.length < total
    ? `Showing ${nf(rows.length)} of ${nf(total)} members`
    : `${nf(total)} member${total === 1 ? "" : "s"}`;

  return (
    <div className="wrap">
      <div className="card stack">
        <div className="row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search name / phone…"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="btn btn-ghost"
            style={{ width: "auto", padding: "0 12px" }}
          >
            <option value="recent">Recent</option>
            <option value="points">{mode === "stamps" ? "Stamps" : "Points"}</option>
            <option value="lifetime">Lifetime</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="label">{loading && rows.length === 0 ? "…" : count}</div>
        {failed && <div className="toast bad">Couldn&apos;t load customers. Check the connection and try again.</div>}

        {rows.map((c) => (
          <Link
            key={c.serial}
            href={`/customers/${c.serial}`}
            className="row"
            style={{ justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "inherit" }}
          >
            <div style={{ minWidth: 0 }}>
              <div>{c.customer_name || "—"}</div>
              <div className="label">
                {formatPhone(c.customer_phone) || "no phone"} · {nf(c.visits)} visit{c.visits === 1 ? "" : "s"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{nf(c.points)} {unitLabel(mode, c.points, true)}</div>
              <div className="label">
                {c.last_seen ? new Date(c.last_seen).toLocaleDateString(undefined, { dateStyle: "medium" }) : "never"}
              </div>
            </div>
          </Link>
        ))}
        {!loading && !failed && rows.length === 0 && (
          <div className="label">{search.trim() ? "No customers match that search" : "No customers yet"}</div>
        )}
        {more && (
          <button className="btn btn-ghost" disabled={loading} onClick={() => fetchPage(fetched)}>
            {loading ? "Loading…" : total > rows.length ? `Load more · ${nf(total - rows.length)} left` : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
