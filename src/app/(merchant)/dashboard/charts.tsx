// Dependency-free SVG/HTML charts, themed off the CSS vars in globals.css.
// All server components (pure, no hooks) — they render to static markup and add
// nothing to the client bundle. Animation is CSS-only (see globals.css).

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

// Tiny inline sparkline for KPI cards.
export function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const W = 120;
  const H = 30;
  const max = Math.max(1, ...data);
  const X = (i: number) => (i * W) / (data.length - 1);
  const Y = (v: number) => H - 2 - (v / max) * (H - 4);
  const d = data.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 28, display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Vertical bar chart for a single category series (e.g. new members per period).
export function BarChart({ data, labels, color = "var(--accent)" }: { data: number[]; labels?: string[]; color?: string }) {
  if (!data.length || Math.max(...data) === 0) return <div className="label">No data in this window</div>;
  const max = Math.max(1, ...data);
  // On dense series, label sparsely so the axis stays readable.
  const step = Math.ceil(data.length / 8);
  return (
    <>
      <div className="bars">
        {data.map((v, i) => (
          <div
            key={i}
            className="bar"
            title={`${labels?.[i] ?? i}: ${v}`}
            style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: color }}
          />
        ))}
      </div>
      {labels && (
        <div className="bars-x">
          {labels.map((l, i) => (
            <span key={i}>{i % step === 0 ? l : ""}</span>
          ))}
        </div>
      )}
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
          {total}
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
            <span className="n">{s.value}</span>
          </div>
        ))}
        {total === 0 && <span className="label">No data yet</span>}
      </div>
    </div>
  );
}

// Horizontal funnel bars (each % of the first step).
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const base = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="fun">
      {steps.map((s, i) => {
        const pct = Math.round((100 * s.value) / base);
        return (
          <div className="fun-row" key={i}>
            <div className="fun-meta">
              <span>{s.label}</span>
              <span>
                <b>{s.value}</b> · {pct}%
              </span>
            </div>
            <div className="fun-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Day-of-week × hour activity heatmap. Scrolls horizontally on narrow screens.
export function Heatmap({ cells }: { cells: { dow: number; hour: number; n: number }[] }) {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const max = Math.max(1, ...cells.map((c) => c.n));
  const m: Record<string, number> = {};
  for (const c of cells) m[`${c.dow}-${c.hour}`] = c.n;
  if (cells.length === 0) return <div className="label">No activity yet</div>;
  return (
    <div className="heat">
      {DOW.map((d, row) => (
        <div className="heat-row" key={row}>
          <span className="heat-lab">{d}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const n = m[`${row}-${h}`] || 0;
            const pct = n ? Math.round((0.15 + 0.85 * (n / max)) * 100) : 0;
            return (
              <div
                key={h}
                className="heat-cell"
                title={`${d} ${h}:00 — ${n} txns`}
                style={n ? { background: `color-mix(in srgb, var(--accent) ${pct}%, var(--surface-2))` } : undefined}
              />
            );
          })}
        </div>
      ))}
      <div className="heat-row">
        <span className="heat-lab" />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="heat-lab" style={{ textAlign: "center", fontSize: 8 }}>
            {h % 6 === 0 ? h : ""}
          </span>
        ))}
      </div>
    </div>
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
