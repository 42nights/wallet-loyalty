// Dependency-free SVG/HTML charts. Server components: they render to static
// markup. TrendChart, Donut and SEGMENT_COLORS are the landing page's, /admin's
// and /demo's (outside the owner app, on the old tokens) and stay as they were.
// The rest is the owner dashboard's, themed off the .app tokens, with no
// entrance animation: the owner opens it dozens of times a day.
import type { CSSProperties, ReactNode } from "react";
import Icon from "@/components/Icon";
import s from "./dashboard.module.css";

type Series = { label: string; color: string; data: number[] };

// Multi-series area + line trend. Responsive: scales to container width.
export function TrendChart({ series, caption }: { series: Series[]; caption?: string }) {
  const W = 640;
  const H = 200;
  const pad = 10;
  const n = Math.max(1, ...series.map((s) => s.data.length));
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  if (!series.some((s) => s.data.length)) return <div className="label">No activity in this window</div>;

  const X = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, n - 1);
  const Y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = (d: number[]) => d.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const area = (d: number[]) => `${line(d)} L${X(d.length - 1).toFixed(1)},${H - pad} L${X(0).toFixed(1)},${H - pad} Z`;
  const guides = [0.25, 0.5, 0.75].map((f) => H - pad - f * (H - 2 * pad));

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 168, display: "block" }}>
        {guides.map((gy, i) => (
          <line key={i} x1={pad} y1={gy} x2={W - pad} y2={gy} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, i) => (s.data.length > 1 ? <path key={`a${i}`} d={area(s.data)} fill={s.color} fillOpacity={0.1} /> : null))}
        {series.map((s, i) => (
          <path
            key={`l${i}`}
            className="draw"
            pathLength={1}
            d={line(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s, i) =>
          s.data.length ? <circle key={`c${i}`} cx={X(s.data.length - 1)} cy={Y(s.data[s.data.length - 1])} r="3.5" fill={s.color} /> : null
        )}
      </svg>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        <div className="row" style={{ gap: 14 }}>
          {series.map((s, i) => (
            <span key={i} className="leg-row" style={{ fontSize: 12 }}>
              <span className="leg-dot" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        {caption && <span className="label" style={{ margin: 0 }}>{caption}</span>}
      </div>
    </>
  );
}

type Seg = { label: string; color: string; value: number };

// Donut with center total + legend.
export function Donut({ segments, label, size = 168, thickness = 24 }: { segments: Seg[]; label: string; size?: number; thickness?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: "none" }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((s, i) => {
            if (s.value <= 0) return null;
            const frac = s.value / total;
            const dash = frac * circ;
            const el = (
              <circle
                key={i}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-acc * circ}
                transform={`rotate(-90 ${c} ${c})`}
              />
            );
            acc += frac;
            return el;
          })}
        <text x={c} y={c - 2} textAnchor="middle" fontFamily="var(--display)" fontWeight="800" fontSize="32" fill="var(--ink)">
          {total.toLocaleString()}
        </text>
        <text x={c} y={c + 16} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--muted)" letterSpacing="2">
          {label.toUpperCase()}
        </text>
      </svg>
      <div className="leg" style={{ flex: 1, minWidth: 130 }}>
        {segments.filter((s) => s.value > 0).map((s, i) => (
          <div className="leg-row" key={i}>
            <span className="leg-dot" style={{ background: s.color }} />
            {s.label}
            <span className="n">{s.value.toLocaleString()}</span>
          </div>
        ))}
        {total === 0 && <span className="label">No data yet</span>}
      </div>
    </div>
  );
}

// ---- owner dashboard ---------------------------------------------------------

const nf = new Intl.NumberFormat("en-US").format;
const axis = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format;
const axisNum = (n: number) => (n >= 10_000 ? axis(n) : nf(n));

// 0 → mid → top: a top that halves into a whole, round number.
function niceTop(max: number): number {
  const m = Math.max(2, max);
  const p = 10 ** Math.floor(Math.log10(m));
  return ([1, 2, 4, 6, 8, 10].find((f) => f * p >= m) ?? 10) * p;
}

// 4-5 evenly spaced tick indexes, stepped back from the latest bucket.
function tickIndexes(n: number): number[] {
  const step = Math.max(1, Math.ceil((n - 1) / 4));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className={`empty ${s.fill}`}>
      <Icon name="info" />
      <p className="empty-t">{title}</p>
      {text && <p className="empty-p">{text}</p>}
    </div>
  );
}

function XAxis({ labels, at }: { labels: string[]; at: (i: number) => number }) {
  const idx = tickIndexes(labels.length);
  return (
    <div className={s.xAxis} aria-hidden="true">
      {idx.map((i) => (
        <span key={i} className={i === 0 ? s.first : i === labels.length - 1 ? s.last : undefined} style={{ left: `${at(i)}%` }}>
          {labels[i]}
        </span>
      ))}
    </div>
  );
}

// Points given (solid line + area) and redeemed (dashed) per bucket.
// Paths stretch with the box (preserveAspectRatio none, strokes stay 2px);
// the end dots are HTML so they stay round. `children` is the hover layer
// (Controls.tsx); --top lets it place its dots on the same scale.
export function FlowChart({ given, redeemed, ticks, summary, children }: {
  given: number[]; redeemed: number[]; ticks: string[]; summary: string; children?: ReactNode;
}) {
  const n = given.length;
  if (n < 2 || Math.max(...given, ...redeemed) === 0)
    return <Empty title="Nothing given or redeemed in this period" text="Try a longer period." />;

  const top = niceTop(Math.max(...given, ...redeemed));
  const X = (i: number) => (i / (n - 1)) * 100;
  const Y = (v: number) => 100 - (v / top) * 100;
  const line = (d: number[]) => d.map((v, i) => `${i ? "L" : "M"}${i},${Y(v).toFixed(2)}`).join("");
  const id = `fill-${n}-${top}`;

  return (
    <div className={s.trend}>
      <div className={s.yAxis} aria-hidden="true">
        {[top, top / 2, 0].map((v) => <span key={v}>{axisNum(v)}</span>)}
      </div>
      <div className={s.plot} style={{ "--top": top } as CSSProperties}>
        <svg viewBox={`0 0 ${n - 1} 100`} preserveAspectRatio="none" role="img" aria-label={summary}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--c-issued)", stopOpacity: 0.18 }} />
              <stop offset="1" style={{ stopColor: "var(--c-issued)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((y) => <line key={y} className={s.grid} x1="0" x2={n - 1} y1={y} y2={y} />)}
          <path d={`${line(given)}L${n - 1},100L0,100Z`} fill={`url(#${id})`} />
          <path className={s.line} d={line(given)} style={{ stroke: "var(--c-issued)" }} />
          <path className={s.line} d={line(redeemed)} style={{ stroke: "var(--c-redeemed)" }} strokeDasharray="4 3" />
        </svg>
        <span className={s.dot} style={{ left: "100%", top: `${Y(given[n - 1])}%`, background: "var(--c-issued)" }} />
        <span className={s.dot} style={{ left: "100%", top: `${Y(redeemed[n - 1])}%`, background: "var(--c-redeemed)" }} />
        {children}
      </div>
      <XAxis labels={ticks} at={X} />
      <div className={s.legend} aria-hidden="true">
        <span><span className={s.sw} style={{ color: "var(--c-issued)" }} />Given</span>
        <span><span className={s.swDash} style={{ color: "var(--c-redeemed)" }} />Redeemed</span>
      </div>
    </div>
  );
}

// KPI sparkline: the tile's .spark slot is 28px whether or not this draws.
export function Sparkline({ data, color, dashed }: { data: number[]; color: string; dashed?: boolean }) {
  if (data.length < 2 || Math.max(...data) === 0) return null;
  const max = Math.max(...data);
  const d = data.map((v, i) => `${i ? "L" : "M"}${i},${(29 - (v / max) * 26).toFixed(2)}`).join("");
  return (
    <svg className={s.spark} viewBox={`0 0 ${data.length - 1} 30`} preserveAspectRatio="none" aria-hidden="true">
      <path className={s.line} d={d} style={{ stroke: color, strokeWidth: 1.5 }} strokeDasharray={dashed ? "4 3" : undefined} />
    </svg>
  );
}

// One SVG of bars in % units, so rx stays a true 2px. Over 30 buckets the bars
// touch (no hairlines); otherwise a 1px surface-coloured stroke parts them.
export function BarChart({ data, ticks, tips, summary, empty }: {
  data: number[]; ticks: string[]; tips: string[]; summary: string; empty: string;
}) {
  const n = data.length;
  if (n < 2) return <Empty title="Not enough data for this view" text="Try a shorter period or Show by: Day." />;
  const max = Math.max(...data);
  if (max === 0) return <Empty title={empty} />;
  const w = 100 / n;
  return (
    <div className={s.barChart}>
      <div className={s.plot}>
        <svg role="img" aria-label={summary}>
          {data.map((v, i) =>
            v ? (
              <rect key={i} className={n > 30 ? undefined : s.parted} x={`${i * w}%`} width={`${w + (n > 30 ? 0.05 : 0)}%`}
                y={`${100 - Math.max(2, (v / max) * 100)}%`} height={`${Math.max(2, (v / max) * 100)}%`} rx="2">
                <title>{`${tips[i]}: ${nf(v)}`}</title>
              </rect>
            ) : null
          )}
        </svg>
      </div>
      <XAxis labels={ticks} at={(i) => (i + 0.5) * w} />
    </div>
  );
}

type Group = { key: string; label: string; definition: string; value: number };

// Donut of customer groups; the legend carries counts, shares and definitions.
export function GroupsDonut({ segments, total }: { segments: Group[]; total: number }) {
  if (total === 0) return <Empty title="No customers yet" text="Groups appear once people sign up." />;
  const size = 148, thick = 18, r = (size - thick) / 2, c = size / 2, circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className={s.donut}>
      <div className={s.ring}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thick} />
          {segments.map((g) => {
            if (!g.value) return null;
            const dash = (g.value / total) * circ;
            const el = (
              <circle key={g.key} cx={c} cy={c} r={r} fill="none" strokeWidth={thick}
                style={{ stroke: `var(--seg-${g.key})` }}
                strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc} transform={`rotate(-90 ${c} ${c})`} />
            );
            acc += dash;
            return el;
          })}
        </svg>
        <div className={s.ringLabel}>
          <b>{nf(total)}</b>
          <span>customers</span>
        </div>
      </div>
      <ul className={s.leg}>
        {segments.filter((g) => g.value > 0).map((g) => (
          <li key={g.key} title={g.definition} data-seg={g.key}>
            <span className={s.legDot} />
            <span className={s.legName}>{g.label}</span>
            <span className={s.legN}>{nf(g.value)}</span>
            <span className={s.legPct}>{Math.round((100 * g.value) / total)}%</span>
            <button type="button" className={s.q} data-tip={g.definition} aria-label={`${g.label}: ${g.definition}`}>
              <Icon name="info" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Funnel steps, each as a share of the first. No animation.
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const base = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className={s.fun}>
      {steps.map((st) => {
        const p = Math.round((100 * st.value) / base);
        return (
          <li key={st.label}>
            <div className={s.funMeta}>
              <span>{st.label}</span>
              <span><b>{nf(st.value)}</b> · {p}%</span>
            </div>
            <div className={s.funBar}><span style={{ width: `${p}%` }} /></div>
          </li>
        );
      })}
    </ol>
  );
}

const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hourLabel = (h: number) => (h === 0 ? "12am" : h === 12 ? "noon" : `${h % 12}${h < 12 ? "am" : "pm"}`);

// Day × hour activity on the shop's clock, trimmed to the hours it is open.
export function Heatmap({ cells }: { cells: { dow: number; hour: number; n: number }[] }) {
  const live = cells.filter((c) => c.n > 0);
  if (!live.length) return <Empty title="No visits in this period" text="Busy times appear after a few visits." />;
  const max = Math.max(...live.map((c) => c.n));
  const m = new Map(live.map((c) => [`${c.dow}-${c.hour}`, c.n]));
  let a = Math.max(0, Math.min(...live.map((c) => c.hour)) - 1);
  let b = Math.min(23, Math.max(...live.map((c) => c.hour)) + 1);
  while (b - a < 7) { if (a > 0) a--; if (b - a < 7 && b < 23) b++; }
  const hours = Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const top5 = [...live].sort((x, y) => y.n - x.n).slice(0, 5);

  return (
    <>
      <div className={s.heat} style={{ gridTemplateColumns: `auto repeat(${hours.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {ROW_ORDER.map((d) => [
          <span key={`l${d}`} className={s.heatDay}>{DAY_SHORT[d]}</span>,
          ...hours.map((h) => {
            const n = m.get(`${d}-${h}`) ?? 0;
            return (
              <span key={`${d}-${h}`} className={s.cell} title={`${DAY_SHORT[d]} ${hourLabel(h)}: ${nf(n)} visits and rewards`}
                style={n ? { background: `color-mix(in srgb, var(--accent) ${Math.round(15 + (85 * n) / max)}%, var(--surface-2))` } : undefined} />
            );
          }),
        ])}
        <span />
        {hours.map((h) => <span key={`h${h}`} className={s.heatHour}>{h % 3 === 0 ? hourLabel(h) : ""}</span>)}
      </div>
      <ul className="sr-only">
        {top5.map((c) => <li key={`${c.dow}-${c.hour}`}>{`${DAY_LONG[c.dow]} ${hourLabel(c.hour)}: ${nf(c.n)} visits and rewards`}</li>)}
      </ul>
    </>
  );
}

// Shared categorical palette for RFM segments (warm-leaning, distinguishable).
export const SEGMENT_COLORS: Record<string, string> = {
  vip: "#f36c2e",
  regular: "#d9a441",
  new: "#5ccb8e",
  active: "#5aa9e6",
  at_risk: "#ff9f43",
  lapsed: "#c98a6b",
  dormant: "#6b6560",
};
