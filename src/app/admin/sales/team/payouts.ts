import type { Lead, Person } from "@/lib/sales/types";

// Payout terms and the "payouts due this month" lines (admin-sales spec §2.5).
// Pure: the team page builds the lines on the server, the roster form reads
// terms live in the browser. Amounts come from payout_terms as typed, and the
// page prints the arithmetic so Ayaan checks it before paying anyone.

export type Terms = {
  first: number; // rep: $ at the first paid invoice
  month4: number; // rep: $ when month 4 is paid
  pct: number | null; // partner: % of the plan price
  months: number; // partner: how many paid months the share runs
  hourly: boolean;
  defaulted: boolean; // rep terms had no $ amount: the spec's $100 + $50
  reads: string;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// "hourly+$50/shop" → $50 at first paid. "$100 first paid + $50 month 4" →
// $100 and $50. "$19/h + $50/shop" → the hourly rate is not a bounty.
// "20%/24mo" → 20% for 24 months.
export function readTerms(kind: Person["kind"], raw: string | null): Terms {
  const t = raw ?? "";
  const months = Number(/(\d+)\s*(?:mo|month)/i.exec(t)?.[1]) || 24;
  const hourly = /hour|\/\s*hr?\b/i.test(t);
  if (kind === "partner") {
    const pct = Number(/(\d+(?:\.\d+)?)\s*%/.exec(t)?.[1]);
    const ok = pct > 0 && pct <= 100;
    return {
      first: 0, month4: 0, pct: ok ? pct : null, months, hourly, defaulted: false,
      reads: ok ? `${pct}% of the plan price for ${months} months` : "No share yet: type terms like 20%/24mo",
    };
  }
  const bounties = [...t.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)(\s*(?:\/|per|an?)\s*h(?:ou)?r?\b)?/gi)]
    .filter((m) => !m[2])
    .map((m) => Number(m[1]));
  const defaulted = bounties.length === 0;
  const first = defaulted ? 100 : bounties[0];
  const month4 = defaulted ? 50 : (bounties[1] ?? 0);
  const parts = [`${money(first)} at the first paid invoice`];
  if (month4) parts.push(`${money(month4)} when month 4 is paid`);
  return { first, month4, pct: null, months, hourly, defaulted, reads: parts.join(" + ") + (defaulted ? " (spec default: no $ in the terms)" : "") };
}

export type PayoutLead = Pick<Lead, "id" | "business_name" | "stage" | "sourced_by_id" | "first_paid_at" | "month4_paid_at">;

export type PayoutLine = {
  personId: string;
  person: string;
  leadId: string;
  shop: string;
  what: string;
  date: string; // YYYY-MM-DD, Ayaan's calendar
  amount: number | null; // rep bounty; null for a partner share (price × pct in the browser)
  pct: number | null;
  terms: string;
};

const monthNo = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));

// `day(iso)` is the calendar day in Ayaan's zone; `thisMonth` is "YYYY-MM".
// Reps: a bounty for each lead they sourced whose first paid invoice or
// month-4 payment landed this month. Partners: a share for each lead they
// sourced that is still paid and inside the share's months.
export function payoutLines(
  people: Pick<Person, "id" | "name" | "kind" | "payout_terms">[],
  leads: PayoutLead[],
  thisMonth: string,
  day: (iso: string) => string
): PayoutLine[] {
  const lines: PayoutLine[] = [];
  for (const p of people) {
    const terms = readTerms(p.kind, p.payout_terms);
    const base = { personId: p.id, person: p.name, terms: p.payout_terms ?? "" };
    for (const l of leads) {
      if (l.sourced_by_id !== p.id) continue;
      const shop = { leadId: l.id, shop: l.business_name };
      if (p.kind === "rep") {
        for (const [at, what, amount] of [
          [l.first_paid_at, "First paid invoice", terms.first],
          [l.month4_paid_at, "Month 4 paid", terms.month4],
        ] as const) {
          if (at && amount > 0 && day(at).startsWith(thisMonth))
            lines.push({ ...base, ...shop, what, date: day(at), amount, pct: null });
        }
      } else if (l.stage === "paid" && l.first_paid_at) {
        const month = monthNo(thisMonth) - monthNo(day(l.first_paid_at)) + 1;
        if (month >= 1 && month <= terms.months)
          lines.push({ ...base, ...shop, what: `Share · month ${month} of ${terms.months}`, date: day(l.first_paid_at), amount: null, pct: terms.pct });
      }
    }
  }
  return lines;
}
