"use client";
import { useRouter } from "next/navigation";

// Date-range + bucket controls. Current values come from the server (which parsed
// the URL) so this needs no useSearchParams/Suspense — it only pushes new URLs,
// and the server component re-queries the windowed RPCs.
export default function Controls({ days, bucket }: { days: string; bucket: string }) {
  const router = useRouter();
  const go = (d: string, b: string) => router.push(`/dashboard?days=${d}&bucket=${b}`, { scroll: false });

  return (
    <div className="dash-controls">
      <label className="ctrl">
        <span>Range</span>
        <select value={days} onChange={(e) => go(e.target.value, bucket)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
        </select>
      </label>
      <label className="ctrl">
        <span>Granularity</span>
        <select value={bucket} onChange={(e) => go(days, e.target.value)}>
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>
      </label>
    </div>
  );
}
