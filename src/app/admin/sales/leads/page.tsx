import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { PRESETS } from "@/lib/sales/import";
import { LEAD_LIST_SELECT, leadsQuery } from "@/lib/sales/server";
import { PERSONAS, SEGMENTS, STAGES, type LeadListRow, type Person } from "@/lib/sales/types";
import { nf } from "../../ui";
import LeadTable from "./LeadTable";
import { PERSONA_LABEL, STAGE_LABEL, human } from "./labels";
import a from "../../admin.module.css";
import s from "../sales.module.css";

export const runtime = "nodejs";

// The lead list (admin-sales spec §2.2). Filters, search, sort and paging all
// live in the URL (a plain GET form), so a view can be bookmarked and the CSV
// export gets exactly the same filters. "Load more" asks for a longer list.

const STEP = 50;
const MAX = 1000; // PostgREST max_rows: past this, filter instead of scrolling
const SORTS = {
  new: { label: "Newest", col: "created_at", asc: false },
  owner: { label: "Owner reach", col: "owner_phone_odds", asc: false, then: "owner_email_odds" },
  next: { label: "Next action due", col: "next_action_at", asc: true },
  contacted: { label: "Last contacted", col: "last_contacted_at", asc: false },
  name: { label: "Name A-Z", col: "business_name", asc: true },
} as const;
type SortKey = keyof typeof SORTS;
// Sources the spec names, plus each import preset's.
const SOURCES = [...new Set([...Object.values(PRESETS).map((p) => p.source), "walk_in", "referral", "partner", "inbound", "manual"])];
const FILTER_KEYS = ["q", "stage", "assignee", "sourced_by", "source", "segment", "cluster", "persona", "city", "state", "has_phone", "apollo", "franchise", "dnc"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const raw = await searchParams;
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const filters = new URLSearchParams();
  for (const k of FILTER_KEYS) if (one(k)) filters.set(k, one(k));
  const sort: SortKey = Object.hasOwn(SORTS, one("sort")) ? (one("sort") as SortKey) : "new";
  const show = Math.min(Math.max(parseInt(one("show"), 10) || STEP, STEP), MAX);
  const o = SORTS[sort];

  let list = leadsQuery(filters, LEAD_LIST_SELECT, true).order(o.col, { ascending: o.asc, nullsFirst: false });
  if ("then" in o) list = list.order(o.then, { ascending: false });
  const [{ data, count, error }, { data: peopleData }] = await Promise.all([
    list.order("id").range(0, show - 1),
    db.from("sales_people").select("*").order("active", { ascending: false }).order("name"),
  ]);
  if (error) throw new Error(`sales leads list failed: ${error.message}`);
  const leads = (data ?? []) as unknown as LeadListRow[];
  const people = (peopleData ?? []) as Person[];
  const total = count ?? 0;

  const withParams = (extra: Record<string, string>) => {
    const p = new URLSearchParams(filters);
    if (sort !== "new") p.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/admin/sales/leads?${p}`;
  };
  const moreFilters = FILTER_KEYS.filter((k) => k !== "q" && k !== "stage" && one(k)).length;
  const exportHref = `/api/admin/sales/export${filters.size ? `?${filters}` : ""}`;

  return (
    <>
      <div className={a.head}>
        <div>
          <h1 className={a.title}>Leads</h1>
          <div className={a.sub}>
            {nf(total)} {filters.size ? "matching" : "in the pipeline"}
            {one("dnc") === "1" ? ", do-not-contact included" : ". Do-not-contact leads are hidden"}.
          </div>
        </div>
        <a href={exportHref} className={`btn btn-ghost ${a.smallBtn}`} style={{ textDecoration: "none" }} download>
          Export CSV
        </a>
      </div>

      <form method="get" className={`panel ${s.filters}`} role="search">
        <div className={s.filterTop}>
          <label className={`${a.field} ${s.grow}`}>
            <span className="label">Search</span>
            <input type="search" name="q" defaultValue={one("q")} placeholder="Name, owner, city, phone, ZIP" maxLength={80} />
          </label>
          <label className={a.field}>
            <span className="label">Stage</span>
            <select name="stage" defaultValue={one("stage")}>
              <option value="">Any stage</option>
              {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
            </select>
          </label>
          <label className={a.field}>
            <span className="label">Sort</span>
            <select name="sort" defaultValue={sort}>
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
        </div>
        <details className={s.more} open={moreFilters > 0}>
          <summary>More filters{moreFilters ? ` · ${moreFilters} on` : ""}</summary>
          <div className={s.filterGrid}>
            <PersonSelect name="assignee" label="Assigned to" value={one("assignee")} people={people} />
            <PersonSelect name="sourced_by" label="Sourced by" value={one("sourced_by")} people={people} />
            <label className={a.field}>
              <span className="label">Source</span>
              <select name="source" defaultValue={one("source")}>
                <option value="">Any source</option>
                {[...SOURCES, ...(one("source") && !SOURCES.includes(one("source")) ? [one("source")] : [])].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className={a.field}>
              <span className="label">Type</span>
              <select name="segment" defaultValue={one("segment")}>
                <option value="">Any type</option>
                {SEGMENTS.map((x) => <option key={x} value={x}>{x === "cafe" ? "Café" : human(x)}</option>)}
              </select>
            </label>
            <label className={a.field}>
              <span className="label">Cluster</span>
              <input name="cluster" defaultValue={one("cluster")} placeholder="Exact name, e.g. 11215" maxLength={80} />
            </label>
            <label className={a.field}>
              <span className="label">Persona</span>
              <select name="persona" defaultValue={one("persona")}>
                <option value="">Any persona</option>
                {PERSONAS.map((x) => <option key={x} value={x}>{PERSONA_LABEL[x]}</option>)}
              </select>
            </label>
            <label className={a.field}>
              <span className="label">City</span>
              <input name="city" defaultValue={one("city")} placeholder="Brooklyn" maxLength={80} />
            </label>
            <label className={a.field}>
              <span className="label">State</span>
              <input name="state" defaultValue={one("state")} placeholder="NY" maxLength={2} pattern="[A-Za-z]{2}" autoCapitalize="characters" />
            </label>
            <div className={s.checks}>
              <label className={a.check}><input type="checkbox" name="has_phone" value="1" defaultChecked={one("has_phone") === "1"} /> Has a phone</label>
              <label className={a.check}><input type="checkbox" name="apollo" value="1" defaultChecked={one("apollo") === "1"} /> Apollo verified</label>
              <label className={a.check}><input type="checkbox" name="franchise" value="1" defaultChecked={one("franchise") === "1"} /> Franchise</label>
              <label className={a.check}><input type="checkbox" name="dnc" value="1" defaultChecked={one("dnc") === "1"} /> Show do-not-contact</label>
            </div>
          </div>
        </details>
        <div className={a.actions}>
          <button type="submit" className={`btn btn-primary ${a.smallBtn}`}>Apply</button>
          {(filters.size > 0 || sort !== "new") && <Link href="/admin/sales/leads" className={s.mini}>Clear all</Link>}
        </div>
      </form>

      <LeadTable
        leads={leads}
        people={people.filter((p) => p.active)}
        total={total}
        moreHref={leads.length < total && show < MAX ? withParams({ show: String(Math.min(show + STEP, MAX)) }) : null}
        capped={leads.length < total && show >= MAX}
        filtered={filters.size > 0}
      />
    </>
  );
}

function PersonSelect({ name, label, value, people }: { name: string; label: string; value: string; people: Person[] }) {
  return (
    <label className={a.field}>
      <span className="label">{label}</span>
      <select name={name} defaultValue={value}>
        <option value="">Anyone</option>
        <option value="none">{name === "assignee" ? "Unassigned (Ayaan)" : "Nobody"}</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactive)"}</option>)}
      </select>
    </label>
  );
}
