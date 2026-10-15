import Link from "next/link";
import type { ReactNode } from "react";
import PageHead from "@/components/PageHead";
import Icon from "@/components/Icon";
import { SEGMENTS } from "@/lib/segments";
import { isSupportUsername } from "@/lib/admin/merchant";
import { unitLabel } from "@/lib/config";
import {
  RANGES, INS_ICON, COMPACT_FROM, nf, kpiNum, sum, pct, utc, plural, Unit, lastText,
  toShopClock, alertLines, computeInsights, type DashboardData,
} from "./insights";
import { FlowChart, BarChart, Sparkline, GroupsDonut, Funnel, Heatmap, Empty } from "./charts";
import Controls, { TrendHover } from "./Controls";
import WinBack from "./WinBack";
import CommandBar from "./CommandBar";
import DigestCard from "./DigestCard";
import s from "./dashboard.module.css";

// ---- small pieces ------------------------------------------------------------
type Dir = "up" | "down" | null;
// A change chip plus its context. `neutral`: the arrow shows the direction,
// the colour stays muted (more rewards claimed is neither good nor bad).
function Delta({ dir, neutral, chip, text }: { dir: Dir; neutral?: boolean; chip: string; text: string }) {
  return (
    <div className={s.deltaRow}>
      <span className={`delta ${dir && !neutral ? dir : "flat"}`}>
        {dir && <Icon name={dir === "up" ? "arrow-up" : "arrow-down"} />}
        {dir && <span className="sr-only">{dir === "up" ? "up" : "down"}</span>}
        {chip}
      </span>
      <span>{text}</span>
    </div>
  );
}
const dirOf = (diff: number): Dir => (diff > 0 ? "up" : diff < 0 ? "down" : null);

function change(cur: number, prev: number, days: string, neutral = false) {
  const vs = `prior ${RANGES[days].label}`;
  if (prev === 0) return <Delta dir={null} chip={cur ? "New" : "Same"} text={cur ? `none in the ${vs}` : `vs ${vs}`} />;
  const p = Math.round(((cur - prev) / prev) * 100);
  return <Delta dir={dirOf(p)} neutral={neutral} chip={`${nf(Math.abs(p))}%`} text={`vs ${vs}`} />;
}

function Tile({ k, n, v, children, spark }: { k: string; n?: number; v?: string; children?: ReactNode; spark?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="k">{k}</div>
      <div className="v" title={n !== undefined && n >= COMPACT_FROM ? nf(n) : undefined}>{v ?? kpiNum(n ?? 0)}</div>
      {children}
      {spark !== undefined && <div className="spark">{spark}</div>}
    </div>
  );
}

function Head({ as: H = "h3", title, meta, id }: { as?: "h2" | "h3"; title: string; meta?: string; id?: string }) {
  return (
    <div className="panel-h">
      <H className="panel-t" id={id}>{title}</H>
      {meta && <span className="panel-meta">{meta}</span>}
    </div>
  );
}

export default function DashboardView({ data }: { data: DashboardData }) {
  const { stats: st, seg, staffRows, funnel, ts, prev, today, days, bucket, mode, aiEnabled, topRewards } = data;
  const U = Unit(mode);
  const last = lastText(days);
  const per = `Per ${bucket}`;

  const issued = ts.points.map((p) => p.issued);
  const redeemed = ts.points.map((p) => p.redeemed);
  const joined = ts.members.map((p) => p.n);
  const ticks = ts.points.map((p) => utc(p.t, bucket === "month" ? { month: "short" } : { month: "short", day: "numeric" }));
  const tips = ts.points.map((p) =>
    bucket === "month" ? utc(p.t, { month: "long", year: "numeric" })
      : bucket === "week" ? `Week of ${utc(p.t, { month: "short", day: "numeric" })}`
      : utc(p.t, { weekday: "short", month: "short", day: "numeric" }));
  const peak = issued.indexOf(Math.max(...issued));
  const busiestJoin = joined.indexOf(Math.max(...joined));

  const alerts = alertLines(data);
  const insights = computeInsights(data);
  const total = sum(SEGMENTS.map((g) => seg.counts[g.key] ?? 0));
  const winBack = (key: string) =>
    seg.customers
      .filter((c) => c.segment === key)
      .sort((a, b) => b.visits - a.visits || (a.recency_days ?? 0) - (b.recency_days ?? 0))
      .map(({ serial, customer_name, visits, recency_days }) => ({ serial, customer_name, visits, recency_days }));

  return (
    <div className={`page ${s.dash}${aiEnabled ? ` ${s.withCmd}` : ""}`}>
      <PageHead
        title="Dashboard"
        sub={`${data.shop} · ${data.date}`}
        actions={
          <>
            <Link className="btn btn-ghost" href="/campaigns">Send a campaign</Link>
            <Link className="btn btn-ghost" href="/settings/poster">Print sign-up poster</Link>
          </>
        }
      />

      {alerts.length > 0 && (
        <div className={`panel ${s.alert}`}>
          <Icon name="alert" size={20} />
          <ul>{alerts.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

      <section className="panel" aria-labelledby="today-h"
        title="Counted on your shop's clock since midnight. A visit that was undone still counts.">
        <Head as="h2" id="today-h" title="Today" meta={`So far · ${data.time}`} />
        {today ? (
          <div className={s.tiles}>
            {([
              ["Visits", today.now.visits, today.last.visits, false],
              [`${U} given`, today.now.given, today.last.given, false],
              [mode === "stamps" ? "Rewards claimed" : "Rewards redeemed", today.now.rewards, today.last.rewards, true],
              ["New sign-ups", today.now.signups, today.last.signups, false],
            ] as const).map(([k, cur, was, neutral]) => (
              <Tile key={k} k={k} n={cur}>
                <Delta dir={dirOf(cur - was)} neutral={neutral} chip={cur === was ? "Same" : nf(Math.abs(cur - was))}
                  text={`vs ${nf(was)} last ${data.weekday} by now`} />
              </Tile>
            ))}
          </div>
        ) : (
          <div className="toast bad" role="alert"><Icon name="alert" />Couldn&apos;t load today&apos;s numbers. Refresh the page to try again.</div>
        )}
      </section>

      <Controls
        days={days}
        bucket={bucket}
        ranges={Object.entries(RANGES).map(([value, r]) => ({ value, ...r }))}
      >
        <div className={`${s.kpis} pending-dim`}>
          <Tile k="Customers" n={st.members} spark={<Sparkline data={joined} color="var(--c-members)" />}>
            <Delta dir={prev.members ? dirOf(sum(joined) - prev.members) : null} chip={`${nf(sum(joined))} new`}
              text={prev.members ? `vs ${nf(prev.members)} in the prior ${RANGES[days].label}` : `none in the prior ${RANGES[days].label}`} />
          </Tile>
          <Tile k={mode === "stamps" ? "Stamps given" : "Points issued"} n={sum(issued)} spark={<Sparkline data={issued} color="var(--c-issued)" />}>
            {change(sum(issued), prev.issued, days)}
          </Tile>
          <Tile k={`${U} redeemed`} n={sum(redeemed)} spark={<Sparkline data={redeemed} color="var(--c-redeemed)" dashed />}>
            {change(sum(redeemed), prev.redeemed, days, true)}
          </Tile>
          <Tile k="Visited in last 30 days" n={st.active_members} spark={null}>
            <div className={s.deltaRow}>
              <span className="chip">Always 30 days</span>
              <span>{pct(st.active_members, st.members)}% of everyone</span>
            </div>
          </Tile>
        </div>

        <div className={`${s.band} pending-dim`}>
          <section className={`panel ${s.c8}`}>
            <Head title={`${U} given and redeemed`} meta={per} />
            <FlowChart
              given={issued}
              redeemed={redeemed}
              ticks={ticks}
              summary={`${U} given ${nf(sum(issued))} and redeemed ${nf(sum(redeemed))} in the ${last}${sum(issued) ? `; most given ${tips[peak]}` : ""}.`}
            >
              <TrendHover given={issued} redeemed={redeemed} tips={tips} />
            </FlowChart>
          </section>
          <section className={`panel ${s.c4}`}>
            <Head title="New customers" meta={per} />
            <BarChart
              data={joined}
              ticks={ticks}
              tips={tips}
              summary={`${plural(sum(joined), "new customer", "new customers")} in the ${last}${sum(joined) ? `; most ${tips[busiestJoin]} (${nf(joined[busiestJoin])})` : ""}.`}
              empty={`No one signed up in the ${last}.`}
            />
          </section>
        </div>

        <div className={`${s.band} pending-dim`}>
          <section className={`panel ${s.c8}`}>
            <Head title="Busy times" meta="Your shop's clock" />
            <Heatmap cells={toShopClock(data.heat, data.utcOffset)} />
          </section>
          <section className={`panel ${s.c4}`}>
            <Head title="Insights" meta={last} />
            <ul className={s.ins}>
              {insights.map((it) => (
                <li key={it.text} className={s[it.dir]}>
                  <span className={s.insIco}><Icon name={INS_ICON[it.dir]} /></span>
                  {it.text}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className={s.sectionHead}>
          <h2>Your customers</h2>
          <span className="panel-meta">As of today</span>
        </div>
        <div className={s.band}>
          <section className={`panel ${s.c4}`}>
            <Head title="Customer groups" />
            <GroupsDonut total={total} segments={SEGMENTS.map((g) => ({ key: g.key, label: g.label, definition: g.definition, value: seg.counts[g.key] ?? 0 }))} />
          </section>
          <WinBack className={s.c4} atRisk={winBack("at_risk")} lapsed={winBack("lapsed")} />
          <section className={`panel ${s.c4}`}>
            <Head title="From sign-up to reward" meta="All time" />
            <Tile k="Repeat rate" v={`${Math.round((st.repeat_rate ?? 0) * 100)}%`}>
              <div className="sub">came back 2+ times, all time</div>
            </Tile>
            <Funnel steps={[
              { label: "Signed up", value: funnel.enrolled },
              { label: "Visited once", value: funnel.earned_once },
              { label: "Visited 3+ times", value: funnel.earned_3plus },
              { label: "Claimed a reward", value: funnel.redeemed },
            ]} />
          </section>
        </div>

        <div className={s.band}>
          <section className={`panel ${s.c6}`}>
            <Head as="h2" title={topRewards.length === 1 ? "Your reward" : "Top rewards"} meta="All time" />
            {topRewards.length === 0 ? (
              <Empty title="No rewards yet" text="Claimed rewards show up here." />
            ) : topRewards.length === 1 ? (
              <div className={s.fillTile}>
                <Tile k={topRewards[0].label} n={topRewards[0].count}>
                  <div className="sub">
                    {topRewards[0].count ? `times claimed · ${nf(topRewards[0].points)} ${unitLabel(mode, topRewards[0].points)}` : "Not claimed yet"}
                  </div>
                </Tile>
              </div>
            ) : (
              <ul className={s.rows}>
                {topRewards.map((r) => (
                  <li key={r.label}>
                    <span className={s.rowIco}><Icon name="gift" /></span>
                    <div>
                      <div className={s.rowName}>{r.label}</div>
                      <div className={s.rowMeta}>
                        {r.count ? `Claimed ${plural(r.count, "time", "times")} · ${nf(r.points)} ${unitLabel(mode, r.points)}` : "Not claimed yet"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={`panel ${s.c6} pending-dim`}>
            <Head as="h2" title="Staff" meta={last} />
            {staffRows.length === 0 ? (
              <Empty title="No staff yet" text="Add a cashier on the Staff page." />
            ) : (
              <ul className={s.rows}>
                {staffRows.map((r) => (
                  <li key={r.username} title="Visits counts every earn, reward and undo they rang up.">
                    <span className="avatar" aria-hidden="true">{r.username.slice(0, 2)}</span>
                    <div>
                      <div className={s.rowName}>
                        {r.username}{" "}
                        {isSupportUsername(r.username) ? <span className="chip chip--warn">42nights support</span>
                          : r.role === "owner" ? <span className="chip chip--accent">Owner</span>
                          : <span className="chip">Cashier</span>}
                      </div>
                      <div className={s.rowMeta}>
                        {plural(r.txns, "visit", "visits")} · gave {nf(r.points_issued)} {unitLabel(mode, r.points_issued, true)} · redeemed {nf(r.points_redeemed)} {unitLabel(mode, r.points_redeemed, true)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {aiEnabled && <div className={s.band}><DigestCard className={s.c12} /></div>}
      </Controls>

      {aiEnabled && <CommandBar />}
    </div>
  );
}
