"use client";
import { useState, useTransition, type PointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import s from "./dashboard.module.css";

type Range = { value: string; label: string; buckets: string[]; def: string };
const BUCKET_LABEL: Record<string, string> = { day: "Day", week: "Week", month: "Month" };

// The range bar and everything it filters. Current values come from the
// server (which parsed and coerced the URL), so this needs no useSearchParams.
// While the server re-renders, the pressed range shows the new choice and the
// ranged bands (.pending-dim) dim.
export default function Controls({ days, bucket, ranges, children }: {
  days: string; bucket: string; ranges: Range[]; children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [want, setWant] = useState({ days, bucket });
  const cur = pending ? want : { days, bucket };
  const range = ranges.find((r) => r.value === cur.days) ?? ranges[0];

  // A new range takes its default bucket (page.tsx), so only Show by sets one.
  function go(d: string, b?: string) {
    setWant({ days: d, bucket: b ?? ranges.find((r) => r.value === d)?.def ?? "" });
    start(() => router.push(`/dashboard?days=${d}${b ? `&bucket=${b}` : ""}`, { scroll: false }));
  }

  return (
    <div className={s.ranged} data-pending={pending || undefined} aria-busy={pending || undefined}>
      <div className={s.rangeBar}>
        <h2>Last {range.label}</h2>
        <div className={s.rangeCtrls}>
          <div className="segmented" role="group" aria-label="Period">
            {ranges.map((r) => (
              <button key={r.value} type="button" aria-pressed={r.value === cur.days} onClick={() => r.value !== cur.days && go(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
          {range.buckets.length > 1 && (
            <label className={s.showBy}>
              <span>Show by</span>
              <select value={cur.bucket} onChange={(e) => go(cur.days, e.target.value)}>
                {range.buckets.map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

const nf = new Intl.NumberFormat("en-US").format;

// FlowChart's hover layer: a crosshair, a dot on each line and the values for
// the bucket under the pointer. A tap keeps it shown (touch has no hover).
export function TrendHover({ given, redeemed, tips }: { given: number[]; redeemed: number[]; tips: string[] }) {
  const [i, setI] = useState<number | null>(null);
  const n = given.length;
  const x = i === null ? 0 : (i / (n - 1)) * 100;
  function track(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setI(Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  }
  const rows = [
    { label: "Given", v: i === null ? 0 : given[i], color: "var(--c-issued)", sw: s.sw },
    { label: "Redeemed", v: i === null ? 0 : redeemed[i], color: "var(--c-redeemed)", sw: s.swDash },
  ];
  return (
    <div className={s.hover} data-active={i !== null || undefined} onPointerMove={track} onPointerDown={track}
      onPointerLeave={(e) => e.pointerType !== "touch" && setI(null)}>
      {i !== null && (
        <>
          <div className={s.cross} style={{ left: `${x}%` }} />
          {rows.map((r) => (
            <span key={r.label} className={s.dot} style={{ left: `${x}%`, top: `calc(100% - ${r.v} * 100% / var(--top))`, background: r.color }} />
          ))}
          <div className={`${s.tip} ${x > 50 ? s.tipLeft : ""}`} style={{ left: `${x}%` }}>
            <div className={s.tipT}>{tips[i]}</div>
            {rows.map((r) => (
              <div key={r.label} className={s.tipRow}>
                <span className={r.sw} style={{ color: r.color }} />
                {r.label}
                <b>{nf(r.v)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
