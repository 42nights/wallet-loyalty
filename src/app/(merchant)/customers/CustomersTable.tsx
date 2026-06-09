"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Cust = {
  serial: string;
  customer_name: string | null;
  customer_phone: string | null;
  points: number;
  lifetime_earned: number;
  visits: number;
  last_seen: string | null;
};

export default function CustomersTable() {
  const router = useRouter();
  const [rows, setRows] = useState<Cust[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/merchant/customers?search=${encodeURIComponent(search)}&sort=${sort}`
    );
    setLoading(false);
    if (res.status === 401) return router.push("/login");
    if (res.status === 403) return router.push("/scan");
    if (!res.ok) return;
    const d = await res.json();
    setRows(d.customers || []);
    setTotal(d.total || 0);
  }, [search, sort, router]);

  // debounce search/sort
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>customers</small>
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        <Link className="btn btn-ghost" href="/dashboard">Dashboard</Link>
        <Link className="btn btn-ghost" href="/scan">Scan</Link>
      </div>

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
            <option value="points">Points</option>
            <option value="lifetime">Lifetime</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="label">{loading ? "…" : `${total} member${total === 1 ? "" : "s"}`}</div>

        {rows.map((c) => (
          <Link
            key={c.serial}
            href={`/customers/${c.serial}`}
            className="row"
            style={{ justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "inherit" }}
          >
            <div>
              <div>{c.customer_name || "—"}</div>
              <div className="label">
                {c.customer_phone || "no phone"} · {c.visits} visit{c.visits === 1 ? "" : "s"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700 }}>{c.points} pts</div>
              <div className="label">
                {c.last_seen ? new Date(c.last_seen).toLocaleDateString("en-GB") : "never"}
              </div>
            </div>
          </Link>
        ))}
        {!loading && rows.length === 0 && <div className="label">No customers yet</div>}
      </div>
    </div>
  );
}
