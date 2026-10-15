import type { Metadata } from "next";

// The page is a client component, so its title lives here.
export const metadata: Metadata = { title: "Scan" };

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return children;
}
