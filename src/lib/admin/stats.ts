import { db } from "@/lib/supabase";
import { templateKey, type TemplateKey } from "@/lib/config";

// Platform metrics for the creator admin, straight from the ledger
// (transactions) and passes, so every tile reconciles with a direct SQL query.
//
// ponytail: pulls the last 60 days of transactions + new cards as raw rows and
// sums them in JS (aggregate functions are disabled in PostgREST and the brief
// rules out new SQL functions). A handful of queries total, no per-merchant
// queries. Comfortable to ~100k ledger rows per 60 days; past that, move these
// sums into a SQL view/RPC.

const DAY = 86_400_000;
export const WINDOW_DAYS = 60;
// Must equal PostgREST max_rows (supabase/config.toml). A larger page would be
// silently cut to max_rows and the loop below would stop early.
const PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Fetch every row of a query, one page at a time. Throws instead of returning
// a partial list: a wrong number on the dashboard is worse than an error.
async function allRows<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`admin stats query failed: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

async function count(merchantId?: string): Promise<number> {
  let q = db.from("passes").select("serial", { count: "exact", head: true });
  if (merchantId) q = q.eq("merchant_id", merchantId);
  const { count: n, error } = await q;
  if (error) throw new Error(`admin stats query failed: ${error.message}`);
  return n ?? 0;
}

type Txn = {
  merchant_id: string | null;
  serial: string | null;
  delta: number;
  reason: string | null;
  amount: number | null;
  created_at: string;
};
type Enrol = { merchant_id: string | null; created_at: string };

export type Kpis = {
  cards: number; // cards issued, all time
  inWallet: number; // distinct serials with a device registration right now
  active30: number; // distinct cards with an earn:% transaction in 30 days
  txns30: number;
  issued30: number;
  redeemed30: number;
  revenue30: number; // sum(transactions.amount) — bill totals typed at /scan
  newCards30: number;
};
export type Daily = { days: string[]; newCards: number[]; txns: number[] };
export type Health = "new" | "newActive" | "active" | "quiet" | "empty";
export type MerchantSummary = {
  id: string;
  name: string;
  slug: string | null;
  template: TemplateKey;
  earnRate: number;
  cards: number;
  active30: number;
  lastActivity: string | null; // latest txn or new card within the 60-day window
  staff: number;
  createdAt: string | null;
  health: Health;
};

type Acc = {
  active: Set<string>;
  txns30: number;
  issued30: number;
  redeemed30: number;
  revenue30: number;
  newCards30: number;
  last: number; // epoch ms, 0 = nothing in the window
};
const acc = (): Acc => ({ active: new Set(), txns30: 0, issued30: 0, redeemed30: 0, revenue30: 0, newCards30: 0, last: 0 });

// The window's rows, optionally for one merchant.
async function windowRows(merchantId?: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();
  return Promise.all([
    allRows<Txn>((from, to) => {
      let q = db
        .from("transactions")
        .select("merchant_id, serial, delta, reason, amount, created_at")
        .gte("created_at", since);
      if (merchantId) q = q.eq("merchant_id", merchantId);
      return q.order("id").range(from, to).overrideTypes<Txn[], { merge: false }>();
    }),
    allRows<Enrol>((from, to) => {
      let q = db.from("passes").select("merchant_id, created_at").gte("created_at", since);
      if (merchantId) q = q.eq("merchant_id", merchantId);
      return q.order("created_at").order("serial").range(from, to).overrideTypes<Enrol[], { merge: false }>();
    }),
    // A card can sit on several devices, so count distinct serials.
    allRows<{ serial: string }>((from, to) => {
      const q = merchantId
        ? db.from("registrations").select("serial, passes!inner(merchant_id)").eq("passes.merchant_id", merchantId)
        : db.from("registrations").select("serial");
      return q.order("serial").order("device_lib_id").range(from, to).overrideTypes<{ serial: string }[], { merge: false }>();
    }).then((rows) => new Set(rows.map((r) => r.serial)).size),
  ]);
}

// UTC calendar days, oldest first, ending today.
function lastDays(n: number, now: number): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * DAY).toISOString().slice(0, 10));
}

function aggregate(txns: Txn[], enrols: Enrol[]) {
  const now = Date.now();
  const since30 = now - 30 * DAY;
  const total = acc();
  const per = new Map<string, Acc>();
  const forMerchant = (id: string | null): Acc[] => {
    if (!id) return [total];
    let a = per.get(id);
    if (!a) per.set(id, (a = acc()));
    return [total, a];
  };

  const days = lastDays(WINDOW_DAYS, now);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const daily: Daily = { days, newCards: days.map(() => 0), txns: days.map(() => 0) };

  for (const t of txns) {
    const at = Date.parse(t.created_at);
    const i = dayIndex.get(new Date(at).toISOString().slice(0, 10));
    if (i !== undefined) daily.txns[i]++;
    for (const a of forMerchant(t.merchant_id)) {
      a.last = Math.max(a.last, at);
      if (at < since30) continue;
      a.txns30++;
      if (t.delta > 0) a.issued30 += t.delta;
      else a.redeemed30 -= t.delta;
      a.revenue30 += Number(t.amount ?? 0);
      if (t.serial && t.reason?.startsWith("earn:")) a.active.add(t.serial);
    }
  }
  for (const e of enrols) {
    const at = Date.parse(e.created_at);
    const i = dayIndex.get(new Date(at).toISOString().slice(0, 10));
    if (i !== undefined) daily.newCards[i]++;
    for (const a of forMerchant(e.merchant_id)) {
      a.last = Math.max(a.last, at);
      if (at >= since30) a.newCards30++;
    }
  }
  return { total, per, daily };
}

function kpis(a: Acc, cards: number, inWallet: number): Kpis {
  return {
    cards,
    inWallet,
    active30: a.active.size,
    txns30: a.txns30,
    issued30: a.issued30,
    redeemed30: a.redeemed30,
    revenue30: Math.round(a.revenue30 * 100) / 100,
    newCards30: a.newCards30,
  };
}

// Activity (a transaction or a new card) in the last 30 days is "active" at any
// age; a merchant under 7 days old shows "new" until it has some, then
// "newActive" ("New · active"). Both active states count as active on the
// overview, so its headline matches the badges.
export function health(createdAt: string | null, cards: number, last: number, now = Date.now()): Health {
  const active = last > 0 && now - last < 30 * DAY;
  if (createdAt && now - Date.parse(createdAt) < 7 * DAY) return active ? "newActive" : "new";
  if (cards === 0) return "empty";
  return active ? "active" : "quiet";
}

type MerchantRow = {
  id: string;
  name: string;
  slug: string | null;
  redeem_template: string | null;
  earn_rate: number;
  created_at: string | null;
  passes: { count: number }[];
  staff: { count: number }[];
};

export async function platformOverview() {
  const [merchants, cards, [txns, enrols, inWallet]] = await Promise.all([
    allRows<MerchantRow>((from, to) =>
      db
        .from("merchants")
        .select("id, name, slug, redeem_template, earn_rate, created_at, passes(count), staff(count)")
        .order("created_at")
        .order("id")
        .range(from, to)
        .overrideTypes<MerchantRow[], { merge: false }>()
    ),
    count(),
    windowRows(),
  ]);
  const { total, per, daily } = aggregate(txns, enrols);

  const rows: MerchantSummary[] = merchants.map((m) => {
    const a = per.get(m.id) ?? acc();
    const cardCount = m.passes[0]?.count ?? 0;
    return {
      id: m.id,
      name: m.name,
      slug: m.slug,
      template: templateKey(m.redeem_template),
      earnRate: Number(m.earn_rate),
      cards: cardCount,
      active30: a.active.size,
      lastActivity: a.last ? new Date(a.last).toISOString() : null,
      staff: m.staff[0]?.count ?? 0,
      createdAt: m.created_at,
      health: health(m.created_at, cardCount, a.last),
    };
  });

  return { merchantCount: merchants.length, kpis: kpis(total, cards, inWallet), daily, merchants: rows };
}

export async function merchantOverview(merchantId: string) {
  const [cards, [txns, enrols, inWallet]] = await Promise.all([count(merchantId), windowRows(merchantId)]);
  const { total, daily } = aggregate(txns, enrols);
  return {
    kpis: kpis(total, cards, inWallet),
    daily,
    last: total.last,
    lastActivity: total.last ? new Date(total.last).toISOString() : null,
  };
}
