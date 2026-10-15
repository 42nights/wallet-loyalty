import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { DEFAULT_TIMEZONE, localTime } from "@/lib/config";
import { db } from "@/lib/supabase";
import { STAGES, type Activity, type Person, type Stage } from "@/lib/sales/types";
import { payoutLines, type PayoutLead } from "./payouts";
import { readProfile } from "./profile";
import { Payouts, Roster, type RosterRow } from "./TeamTools";
import s from "../../admin.module.css";

export const runtime = "nodejs";

type TeamLead = PayoutLead & { cluster: string | null; assignee_id: string | null };

// Every lead that has an assignee or a sourcer: the roster's counts and the
// payouts are both computed from these. Paged through PostgREST's 1,000-row
// cap (aggregates are off).
async function teamLeads(): Promise<TeamLead[]> {
  const out: TeamLead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("sales_leads")
      .select("id, business_name, stage, cluster, assignee_id, sourced_by_id, first_paid_at, month4_paid_at")
      .or("assignee_id.not.is.null,sourced_by_id.not.is.null")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`team leads read failed: ${error.message}`);
    out.push(...((data ?? []) as TeamLead[]));
    if ((data?.length ?? 0) < 1000) return out;
  }
}

// Roster (admin-sales spec §2.5): reps and partners are names, never logins.
// "This week" starts Monday and "this month" on the 1st, both on Ayaan's
// calendar (DEFAULT_TIMEZONE).
export default async function SalesTeamPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const now = new Date();
  const day = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: DEFAULT_TIMEZONE });
  const lt = localTime(DEFAULT_TIMEZONE, now);
  const monday = new Date(Date.UTC(lt.year, lt.month - 1, lt.day - ((lt.weekday + 6) % 7))).toISOString().slice(0, 10);
  const thisMonth = day(now).slice(0, 7);

  const [{ data: peopleData, error }, leads, { data: actData }] = await Promise.all([
    db.from("sales_people").select("*").order("active", { ascending: false }).order("name"),
    teamLeads(),
    db
      .from("sales_activities")
      .select("person_id, kind, outcome, occurred_at")
      .not("person_id", "is", null)
      .gte("occurred_at", new Date(now.getTime() - 8 * 86_400_000).toISOString())
      .limit(10_000),
  ]);
  if (error) throw new Error(`sales people read failed: ${error.message}`);
  const people = (peopleData ?? []) as Person[];
  const week = ((actData ?? []) as Pick<Activity, "person_id" | "kind" | "outcome" | "occurred_at">[]).filter(
    (a) => day(a.occurred_at) >= monday
  );

  const rows: RosterRow[] = people.map((p) => {
    const assigned = leads.filter((l) => l.assignee_id === p.id);
    const sourced = leads.filter((l) => l.sourced_by_id === p.id);
    const stages: Partial<Record<Stage, number>> = {};
    const clusters = new Map<string, number>();
    for (const l of assigned) {
      stages[l.stage] = (stages[l.stage] ?? 0) + 1;
      if (l.cluster) clusters.set(l.cluster, (clusters.get(l.cluster) ?? 0) + 1);
    }
    const mine = week.filter((a) => a.person_id === p.id);
    const paying = sourced.filter((l) => l.stage === "paid" && l.first_paid_at);
    return {
      person: p,
      stats: {
        assigned: assigned.length,
        stages: STAGES.filter((st) => stages[st]).map((st) => [st, stages[st]!] as [Stage, number]),
        territory: [...clusters].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c),
        doors: mine.filter((a) => a.kind === "walk_in").length,
        demos: mine.filter((a) => a.outcome === "demo").length,
        pilots: new Set([...assigned, ...sourced].filter((l) => l.stage === "pilot").map((l) => l.id)).size,
        paying: paying.length,
        payingWeek: paying.filter((l) => day(l.first_paid_at!) >= monday).length,
      },
    };
  });

  const lines = payoutLines(people, leads, thisMonth, day);
  const monthName = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: DEFAULT_TIMEZONE });

  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className={s.title}>Team</h1>
          <div className={s.sub}>
            Reps and partners are names on a roster, never logins: only you use /admin. Week from Monday {monday}.
          </div>
        </div>
      </div>
      <Roster rows={rows} />
      <Payouts lines={lines} month={monthName} captains={people.filter((p) => p.active && p.kind === "rep" && readProfile(p.notes).captain).map((p) => p.name)} />
    </>
  );
}
