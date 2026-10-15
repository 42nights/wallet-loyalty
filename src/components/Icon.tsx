import type { ReactNode } from "react";

// The owner app's only icon set (design spec §4): 24-unit line icons drawn in
// currentColor, so an icon always matches the text beside it. No emoji or
// unicode glyphs as icons anywhere in the app.
const PATHS = {
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20" /></>,
  scan: <><path d="M3.5 8V6a2.5 2.5 0 0 1 2.5-2.5h2" /><path d="M16 3.5h2A2.5 2.5 0 0 1 20.5 6v2" /><path d="M20.5 16v2a2.5 2.5 0 0 1-2.5 2.5h-2" /><path d="M8 20.5H6A2.5 2.5 0 0 1 3.5 18v-2" /><path d="M7.5 12h9" /></>,
  megaphone: <><path d="M3.5 10v4a1 1 0 0 0 1 1H7l9 4.5v-15L7 9H4.5a1 1 0 0 0-1 1Z" /><path d="M7 15v3.5a2 2 0 0 0 4 0V17" /><path d="M19.5 9.5a3.5 3.5 0 0 1 0 5" /></>,
  more: <><circle cx="5.5" cy="12" r="1.25" fill="currentColor" /><circle cx="12" cy="12" r="1.25" fill="currentColor" /><circle cx="18.5" cy="12" r="1.25" fill="currentColor" /></>,
  settings: <><path d="M4 7h9" /><path d="M17 7h3" /><circle cx="15" cy="7" r="2" /><path d="M4 17h3" /><path d="M11 17h9" /><circle cx="9" cy="17" r="2" /></>,
  staff: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10.5" r="2" /><path d="M5.8 16a3.4 3.4 0 0 1 6.4 0" /><path d="M14.5 9.5h3" /><path d="M14.5 13h3" /></>,
  "chevron-down": <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  "chevron-right": <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  "arrow-up": <><path d="M12 19.5v-15" /><path d="m6 10.5 6-6 6 6" /></>,
  "arrow-down": <><path d="M12 4.5v15" /><path d="m18 13.5-6 6-6-6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5" /><path d="M12 16.25v.01" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><path d="M12 7.75v.01" /></>,
  x: <><path d="M6.5 6.5l11 11" /><path d="M17.5 6.5l-11 11" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></>,
  download: <><path d="M12 3.5v11" /><path d="m7.5 10 4.5 4.5 4.5-4.5" /><path d="M4.5 20.5h15" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  gift: <><rect x="3.5" y="8" width="17" height="4" rx="1" /><path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7" /><path d="M12 8v12.5" /><path d="M12 8S10.5 3.5 8 3.5a2.25 2.25 0 0 0 0 4.5" /><path d="M12 8s1.5-4.5 4-4.5a2.25 2.25 0 0 1 0 4.5" /></>,
  sun: <><circle cx="12" cy="12" r="3.75" /><path d="M12 2.75v2" /><path d="M12 19.25v2" /><path d="m5.46 5.46 1.41 1.41" /><path d="m17.13 17.13 1.41 1.41" /><path d="M2.75 12h2" /><path d="M19.25 12h2" /><path d="m5.46 18.54 1.41-1.41" /><path d="m17.13 6.87 1.41-1.41" /></>,
  moon: <path d="M19.5 14.2A7.5 7.5 0 0 1 9.8 4.5a7.5 7.5 0 1 0 9.7 9.7Z" />,
  shield: <><path d="M12 20.5s7-3 7-9V6l-7-2.5L5 6v5.5c0 6 7 9 7 9Z" /><path d="m9 12 2 2 4-4" /></>,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18h3" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
