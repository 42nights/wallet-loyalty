// Customer groups (the `segment` from merchant_segments, supabase/schema.sql
// "segmented" CTE), in display order. Visible copy says "group", never
// "segment". The definitions are the SQL rules in plain words; keep them in step.
export const SEGMENTS = [
  { key: "vip", label: "VIP", definition: "Top 10% by rewards earned, and visited in the last 30 days" },
  { key: "regular", label: "Regular", definition: "3+ visits, and visited in the last 30 days" },
  { key: "new", label: "New", definition: "Joined recently, 0–1 visits" },
  { key: "active", label: "Occasional", definition: "Visits now and then, not yet a regular" },
  { key: "at_risk", label: "At risk", definition: "3+ visits, but none in the last 31–90 days" },
  { key: "lapsed", label: "Lapsed", definition: "No visit in over 90 days" },
  { key: "dormant", label: "Never visited", definition: "Signed up over 30 days ago, no visits yet" },
] as const;

export type SegmentKey = (typeof SEGMENTS)[number]["key"];

const find = (key: string) => SEGMENTS.find((s) => s.key === key);
export const segmentLabel = (key: string): string => find(key)?.label ?? key;
export const segmentDefinition = (key: string): string => find(key)?.definition ?? "";
