import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { SCRIPTS, mergeFields, renderScript, salesEnv } from "@/lib/sales/scripts";
import { getLead, leadRecent, suppressedValues } from "@/lib/sales/server";
import { ACTIVITY_KINDS, isOneOf, type Activity, type Draft, type Person } from "@/lib/sales/types";
import LeadView, { type ShownScript } from "./LeadView";

export const runtime = "nodejs";

// One lead (admin-sales spec §2.3). Everything checkContact() needs is loaded
// here so the page can disable blocked channels as the admin types; the
// activities API runs the same check again and has the final word.
export default async function LeadPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ log?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const lead = await getLead((await params).id);
  if (!lead) notFound();

  const [acts, drafts, hit, recent, people] = await Promise.all([
    db.from("sales_activities").select("*").eq("lead_id", lead.id).order("occurred_at", { ascending: false }).limit(50),
    db.from("sales_ai_drafts").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(5),
    suppressedValues([lead.phone, lead.email]),
    leadRecent(lead),
    db.from("sales_people").select("*").order("active", { ascending: false }).order("name"),
  ]);
  if (acts.error || drafts.error || people.error) throw new Error("sales lead page query failed");

  const env = salesEnv();
  const roster = (people.data ?? []) as Person[];
  const fields = mergeFields(lead, roster.find((p) => p.id === lead.assignee_id)?.name ?? null, env);
  const scripts: ShownScript[] = SCRIPTS.map((sc) => ({
    id: sc.id, tab: sc.tab, channel: sc.channel, title: sc.title, source: sc.source, ...renderScript(sc, fields),
  }));
  const log = (await searchParams).log;

  return (
    <LeadView
      lead={lead}
      activities={(acts.data ?? []) as Activity[]}
      drafts={(drafts.data ?? []) as Draft[]}
      suppressed={hit.size > 0}
      recent={recent}
      people={roster}
      postalAddressSet={!!env.postalAddress}
      aiEnabled={!!process.env.ANTHROPIC_API_KEY}
      scripts={scripts}
      initialKind={isOneOf(ACTIVITY_KINDS, log) && log !== "stage_change" ? log : null}
      serverNow={new Date().toISOString()}
    />
  );
}
