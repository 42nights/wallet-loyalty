import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { DEFAULT_TIMEZONE, localTime } from "@/lib/config";
import { callWindowHint } from "@/lib/sales/compliance";
import { CHANNELS, STAGES, type Activity, type Lead, type Outcome, type Stage } from "@/lib/sales/types";
import { nf } from "../ui";
import { QuickAddLead, SnoozeButton } from "./leads/LeadActions";
import { KIND_LABEL, OUTCOME_LABEL, STAGE_LABEL, when } from "./leads/labels";
import a from "../admin.module.css";
import s from "./sales.module.css";

export const runtime = "nodejs";

// Today (admin-sales spec §2.1): follow-ups due, the week's numbers (strategy
// §8), the pipeline by stage, new openings and the latest activity. Days and
// weeks are on Ayaan's clock (DEFAULT_TIMEZONE); weeks start Monday.

const TZ = DEFAULT_TIMEZONE;
const PAGE = 1000; // PostgREST max_rows
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Midnight of a calendar day on Ayaan's clock, as an instant. Date.UTC rolls
// overflow (day 0, day 32, month 13) into the neighbouring month.
function midnight(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  const l = localTime(TZ, new Date(guess));
  return new Date(2 * guess - (Date.UTC(l.year, l.month - 1, l.day) + l.minutes * 60_000));
}

// Every row of a query, a page at a time (rows typed by the caller).
type Q = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
async function every<T>(page: (from: number) => Q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from);
    if (error) throw new Error(`sales today query failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}
const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
  const { count: n, error } = await q;
  if (error) throw new Error(`sales today count failed: ${error.message}`);
  return n ?? 0;
};
const leadCount = () => db.from("sales_leads").select("id", { count: "exact", head: true });

type FollowUp = Pick<Lead, "id" | "business_name" | "cluster" | "segment" | "state" | "recipient_tz" | "next_action" | "next_action_at" | "stage"> & {
  assignee: { name: string } | null;
};
type WeekAct = Pick<Activity, "kind" | "outcome" | "person_id">;
type RecentAct = Pick<Activity, "id" | "kind" | "outcome" | "notes" | "occurred_at" | "person_id"> & { lead: { id: string; business_name: string } | null };
type Opening = Pick<Lead, "id" | "business_name" | "opened_on" | "cluster" | "city" | "stage">;

// Outcomes that mean the decision-maker was reached (strategy §8 "owner reached").
const REACHED = new Set<Outcome>(["owner_spoke", "booked", "demo", "pilot", "paid"]);
type Tally = { doors: number; calls: number; emails: number; reached: number; demos: number; pilots: number; paying: number };
const blank = (): Tally => ({ doors: 0, calls: 0, emails: 0, reached: 0, demos: 0, pilots: 0, paying: 0 });
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");

function Tile({ k, v, sub, warn }: { k: string; v: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`panel kpi ${warn ? s.tileWarn : ""}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className={a.kpiSub}>{sub}</div>}
    </div>
  );
}

export default async function SalesToday({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const now = new Date();
  const t = localTime(TZ, now);
  const startToday = midnight(t.year, t.month, t.day);
  const endToday = midnight(t.year, t.month, t.day + 1);

  // ?week=YYYY-MM-DD (any day in it) → that Monday; default this week.
  const w = /^(\d{4})-(\d{2})-(\d{2})$/.exec((await searchParams).week ?? "");
  const [wy, wm, wd] = w ? [Number(w[1]), Number(w[2]), Number(w[3])] : [t.year, t.month, t.day];
  const monday = wd - ((new Date(Date.UTC(wy, wm - 1, wd)).getUTCDay() + 6) % 7);
  const weekStart = midnight(wy, wm, monday);
  const weekEnd = midnight(wy, wm, monday + 7);
  const [wFrom, wTo] = [weekStart.toISOString(), weekEnd.toISOString()];
  const monthStart = midnight(t.year, t.month, 1).toISOString();
  const monthEnd = midnight(t.year, t.month + 1, 1).toISOString();
  const dncCutoff = ymd(new Date(Date.UTC(t.year, t.month - 1, t.day - 31)));
  const openedSince = ymd(new Date(Date.UTC(t.year, t.month - 1, t.day - 14)));

  const [
    followUps, people, weekActs, weekPilots, weekPaid, optOuts, dncExpired, bounties1, bounties4,
    walkIns, paidIds, pilotsAll, pilotsPaid, openings, recent, ...stageCounts
  ] = await Promise.all([
    every<FollowUp>((f) =>
      db.from("sales_leads")
        .select("id, business_name, cluster, segment, state, recipient_tz, next_action, next_action_at, stage, assignee:sales_people!assignee_id(name)")
        .eq("do_not_contact", false)
        .not("stage", "in", "(paid,lost,closed_business)")
        .lte("next_action_at", endToday.toISOString())
        .order("next_action_at")
        .range(f, f + PAGE - 1)
    ),
    every<{ id: string; name: string; active: boolean }>((f) => db.from("sales_people").select("id, name, active").order("name").range(f, f + PAGE - 1)),
    every<WeekAct>((f) => db.from("sales_activities").select("kind, outcome, person_id").gte("occurred_at", wFrom).lt("occurred_at", wTo).order("id").range(f, f + PAGE - 1)),
    every<{ assignee_id: string | null }>((f) => db.from("sales_leads").select("assignee_id").gte("pilot_started_at", wFrom).lt("pilot_started_at", wTo).order("id").range(f, f + PAGE - 1)),
    every<{ assignee_id: string | null }>((f) => db.from("sales_leads").select("assignee_id").gte("first_paid_at", wFrom).lt("first_paid_at", wTo).order("id").range(f, f + PAGE - 1)),
    count(leadCount().gte("dnc_at", wFrom).lt("dnc_at", wTo)),
    count(leadCount().eq("do_not_contact", false).neq("national_dnc_status", "not_checked").lt("national_dnc_checked_at", dncCutoff)),
    count(leadCount().not("sourced_by_id", "is", null).gte("first_paid_at", monthStart).lt("first_paid_at", monthEnd)),
    count(leadCount().not("sourced_by_id", "is", null).gte("month4_paid_at", monthStart).lt("month4_paid_at", monthEnd)),
    every<{ lead_id: string }>((f) => db.from("sales_activities").select("lead_id").eq("kind", "walk_in").order("id").range(f, f + PAGE - 1)),
    every<{ id: string }>((f) => db.from("sales_leads").select("id").not("first_paid_at", "is", null).order("id").range(f, f + PAGE - 1)),
    count(leadCount().not("pilot_started_at", "is", null)),
    count(leadCount().not("pilot_started_at", "is", null).not("first_paid_at", "is", null)),
    db.from("sales_leads").select("id, business_name, opened_on, cluster, city, stage")
      .eq("do_not_contact", false).gte("opened_on", openedSince).order("opened_on", { ascending: false }).limit(12)
      .then((r) => { if (r.error) throw new Error(`sales today query failed: ${r.error.message}`); return (r.data ?? []) as Opening[]; }),
    db.from("sales_activities").select("id, kind, outcome, notes, occurred_at, person_id, lead:sales_leads(id, business_name)")
      .order("occurred_at", { ascending: false }).limit(12)
      .then((r) => { if (r.error) throw new Error(`sales today query failed: ${r.error.message}`); return (r.data ?? []) as unknown as RecentAct[]; }),
    ...STAGES.map((st) => count(leadCount().eq("do_not_contact", false).eq("stage", st))),
  ]);

  // Overdue first, then by cluster so the afternoon's route is obvious.
  const due = followUps
    .map((l) => ({ ...l, overdue: !!l.next_action_at && l.next_action_at < startToday.toISOString() }))
    .sort((x, y) => Number(y.overdue) - Number(x.overdue) || (x.cluster ?? "￿").localeCompare(y.cluster ?? "￿") || (x.next_action_at ?? "").localeCompare(y.next_action_at ?? ""));

  // The week, per person (null = Ayaan) and per channel.
  const total = blank();
  const byPerson = new Map<string | null, Tally>();
  const byKind = new Map<string, { n: number; reached: number; demos: number; optOuts: number }>();
  const tally = (id: string | null) => byPerson.get(id) ?? byPerson.set(id, blank()).get(id)!;
  for (const act of weekActs) {
    const rows = [total, tally(act.person_id)];
    for (const r of rows) {
      if (act.kind === "walk_in") r.doors++;
      if (act.kind === "call" || act.kind === "voicemail") r.calls++;
      if (act.kind === "email") r.emails++;
      if (act.outcome && REACHED.has(act.outcome)) r.reached++;
      if (act.outcome === "demo") r.demos++;
    }
    if (act.kind === "note" || act.kind === "stage_change") continue;
    const k = byKind.get(act.kind) ?? { n: 0, reached: 0, demos: 0, optOuts: 0 };
    k.n++;
    if (act.outcome && REACHED.has(act.outcome)) k.reached++;
    if (act.outcome === "demo") k.demos++;
    if (act.outcome === "opt_out") k.optOuts++;
    byKind.set(act.kind, k);
  }
  for (const l of weekPilots) { total.pilots++; tally(l.assignee_id).pilots++; }
  for (const l of weekPaid) { total.paying++; tally(l.assignee_id).paying++; }
  const personRows = [
    { id: null, name: "Ayaan" },
    ...people.filter((p) => p.active || byPerson.has(p.id)),
  ].map((p) => ({ ...p, t: byPerson.get(p.id) ?? blank() }));

  const walked = new Set(walkIns.map((x) => x.lead_id));
  const paid = new Set(paidIds.map((x) => x.id));
  const walkedPaid = [...walked].filter((id) => paid.has(id)).length;
  const stages = STAGES.map((st, i) => ({ st, n: stageCounts[i] }));
  const maxStage = Math.max(1, ...stages.map((x) => x.n));
  const names = new Map(people.map((p) => [p.id, p.name]));

  const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
  const lastDay = new Date(weekEnd.getTime() - 1);
  const weekParam = (offsetDays: number) => {
    const d = new Date(Date.UTC(wy, wm - 1, monday + offsetDays));
    return `/admin/sales?week=${ymd(d)}`;
  };
  const thisWeek = weekStart.getTime() <= now.getTime() && now.getTime() < weekEnd.getTime();
  const todayLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });

  return (
    <>
      <div className={a.head}>
        <div>
          <h1 className={a.title}>Today</h1>
          <div className={a.sub}>{todayLabel} · Pacific time. Follow-ups first, then the week&apos;s numbers.</div>
        </div>
      </div>

      <div className={s.split}>
        <section className="panel" aria-labelledby="fu-h">
          <div className="panel-h">
            <h2 className="panel-t" id="fu-h">Follow-ups due</h2>
            <span className={s.meta}>
              {nf(due.length)} due{due.some((d) => d.overdue) ? ` · ${due.filter((d) => d.overdue).length} overdue` : ""}
            </span>
          </div>
          {due.length === 0 ? (
            <div className={a.emptyState}>
              <p>Nothing due today. Set a next action on a lead and it shows up here on the day.</p>
              <Link href="/admin/sales/leads" className="btn btn-ghost" style={{ width: "auto", textDecoration: "none" }}>Open leads</Link>
            </div>
          ) : (
            <ul className={s.list}>
              {due.map((l) => (
                <li key={l.id} className={s.fu}>
                  <div className={s.fuMain}>
                    <Link href={`/admin/sales/leads/${l.id}`} className={a.mname}>{l.business_name}</Link>
                    <div className={s.meta}>
                      {[l.cluster, l.assignee?.name ?? "Ayaan", STAGE_LABEL[l.stage]].filter(Boolean).join(" · ")}
                    </div>
                    <div className={s.fuNext}>
                      <span className={l.overdue ? s.overdue : s.dueToday}>{l.overdue ? `Overdue · ${when(l.next_action_at)}` : `Today · ${when(l.next_action_at)}`}</span>
                      {l.next_action && <span> {l.next_action}</span>}
                    </div>
                    <div className={s.fuHint}>{callWindowHint(l, now)}</div>
                  </div>
                  <div className={s.fuActions}>
                    <Link href={`/admin/sales/leads/${l.id}?log=walk_in#log`} className={s.mini}>Log visit</Link>
                    <Link href={`/admin/sales/leads/${l.id}?log=call#log`} className={s.mini}>Log call</Link>
                    <SnoozeButton id={l.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className={s.col}>
          <section className="panel" aria-labelledby="qa-h">
            <div className="panel-h">
              <h2 className="panel-t" id="qa-h">Quick add</h2>
              <span className={s.meta}>a shop you just walked past</span>
            </div>
            <QuickAddLead />
          </section>
          <section className="panel" aria-labelledby="op-h">
            <div className="panel-h">
              <h2 className="panel-t" id="op-h">New openings</h2>
              <span className={s.meta}>last 14 days</span>
            </div>
            {openings.length === 0 ? (
              <p className={s.empty}>No leads opened in the last 14 days. Opening dates come from the open-data imports.</p>
            ) : (
              <ul className={s.list}>
                {openings.map((o) => (
                  <li key={o.id} className="lrow">
                    <Link href={`/admin/sales/leads/${o.id}`}>{o.business_name}</Link>
                    <span className={s.meta}>{[o.cluster ?? o.city, o.opened_on].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className={s.weekHead}>
        <h2 className={s.h2}>{thisWeek ? "This week" : "Week of"} · {fmtDay(weekStart)} – {fmtDay(lastDay)}</h2>
        <nav className={s.weekNav} aria-label="Week">
          <Link href={weekParam(-7)} className={s.mini}>← Previous</Link>
          {!thisWeek && <Link href="/admin/sales" className={s.mini}>This week</Link>}
          <Link href={weekParam(7)} className={s.mini}>Next →</Link>
        </nav>
      </div>

      <div className={`kpi-row ${s.tiles}`}>
        <Tile k="Doors" v={nf(total.doors)} sub="visits" />
        <Tile k="Calls" v={nf(total.calls)} sub="incl. voicemails" />
        <Tile k="Emails" v={nf(total.emails)} />
        <Tile k="Owner reached" v={nf(total.reached)} sub={`${pct(total.reached, total.doors)} of doors`} />
        <Tile k="Demos" v={nf(total.demos)} sub={`${pct(total.demos, total.reached)} of owners reached`} />
        <Tile k="Pilots started" v={nf(total.pilots)} />
        <Tile k="New paying" v={nf(total.paying)} />
      </div>
      <div className={`kpi-row ${s.tiles}`}>
        <Tile k="Visit → paying" v={pct(walkedPaid, walked.size)} sub={`all time · ${walkedPaid} of ${walked.size} visited · goal 8%`} />
        <Tile k="Pilot → paying" v={pct(pilotsPaid, pilotsAll)} sub={`all time · ${pilotsPaid} of ${pilotsAll} pilots · goal 50%`} />
        <Tile k="Opt-outs" v={nf(optOuts)} sub="this week" warn={optOuts > 0} />
        <Tile k="DNC checks expired" v={nf(dncExpired)} sub="older than 31 days" warn={dncExpired > 0} />
        <Tile k="Bounties due" v={nf(bounties1 + bounties4)} sub="this month · amounts on Team" />
      </div>

      <div className={s.split}>
        <section className="panel" aria-labelledby="pp-h">
          <div className="panel-h">
            <h2 className="panel-t" id="pp-h">By person</h2>
            <span className={s.meta}>pilots and paying count the assignee</span>
          </div>
          <div className={a.tableWrap}>
            <table className={`${a.table} ${s.fit}`}>
              <thead>
                <tr>
                  <th>Person</th>
                  {["Doors", "Calls", "Emails", "Owner reached", "Demos", "Pilots", "Paying"].map((h) => <th key={h} className={a.num}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {personRows.map((p) => (
                  <tr key={p.id ?? "ayaan"}>
                    <td>{p.name}</td>
                    <td data-label="Doors" className={a.num}>{p.t.doors}</td>
                    <td data-label="Calls" className={a.num}>{p.t.calls}</td>
                    <td data-label="Emails" className={a.num}>{p.t.emails}</td>
                    <td data-label="Owner reached" className={a.num}>{p.t.reached}</td>
                    <td data-label="Demos" className={a.num}>{p.t.demos}</td>
                    <td data-label="Pilots" className={a.num}>{p.t.pilots}</td>
                    <td data-label="Paying" className={a.num}>{p.t.paying}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel-h" style={{ marginTop: 8 }}>
            <h2 className="panel-t">By channel</h2>
          </div>
          <div className={a.tableWrap}>
            <table className={`${a.table} ${s.fit}`}>
              <thead>
                <tr>
                  <th>Channel</th>
                  {["Touches", "Owner reached", "Demos", "Opt-outs"].map((h) => <th key={h} className={a.num}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...CHANNELS, "partner_intro" as const].map((k) => {
                  const r = byKind.get(k) ?? { n: 0, reached: 0, demos: 0, optOuts: 0 };
                  return (
                    <tr key={k} className={r.n ? undefined : s.dim}>
                      <td>{KIND_LABEL[k]}</td>
                      <td data-label="Touches" className={a.num}>{r.n}</td>
                      <td data-label="Owner reached" className={a.num}>{r.reached}</td>
                      <td data-label="Demos" className={a.num}>{r.demos}</td>
                      <td data-label="Opt-outs" className={a.num}>{r.optOuts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className={s.col}>
          <section className="panel" aria-labelledby="st-h">
            <div className="panel-h">
              <h2 className="panel-t" id="st-h">Pipeline</h2>
              <span className={s.meta}>{nf(stages.reduce((n, x) => n + x.n, 0))} leads, do-not-contact not counted</span>
            </div>
            <div className={s.stages}>
              {stages.map(({ st, n }) => (
                <Link key={st} href={`/admin/sales/leads?stage=${st}`} className={`${s.stageRow} ${n ? "" : s.dim}`}>
                  <span className={s.stageName}>{STAGE_LABEL[st as Stage]}</span>
                  <span className={s.stageBar} aria-hidden><span style={{ width: `${(100 * n) / maxStage}%` }} /></span>
                  <span className={s.stageN}>{nf(n)}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="ra-h">
            <div className="panel-h">
              <h2 className="panel-t" id="ra-h">Recent activity</h2>
            </div>
            {recent.length === 0 ? (
              <p className={s.empty}>Nothing logged yet.</p>
            ) : (
              <ul className={s.list}>
                {recent.map((r) => (
                  <li key={r.id} className={s.actRow}>
                    <div>
                      {r.lead ? <Link href={`/admin/sales/leads/${r.lead.id}`} className={s.inlineLink}>{r.lead.business_name}</Link> : "Deleted lead"}
                      <span className={s.meta}> · {KIND_LABEL[r.kind]}{r.outcome ? ` · ${OUTCOME_LABEL[r.outcome]}` : ""}</span>
                    </div>
                    <div className={s.meta}>{when(r.occurred_at)} · {r.person_id ? names.get(r.person_id) ?? "Removed person" : "Ayaan"}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
