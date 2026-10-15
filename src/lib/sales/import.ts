import { parseCsv } from "./csv";
import { leadFields, nameKey, salesPhone, type LeadInput, type LeadKey } from "./fields";
import type { Lead, Segment } from "./types";

// CSV import: presets, mapping, chain filter and dedupe (admin-sales spec
// §2.4, §3.3). Pure; the route does the database lookups in between
// prepareImport() and finishImport(). Government sources are public domain or
// open use. There is deliberately no preset for Yelp, Google, LinkedIn or Data
// Axle content: we may not store it (strategy §3.1).

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;

const soql = (base: string, params: Record<string, string>) =>
  `${base}?${Object.entries({ ...params, $limit: String(MAX_IMPORT_ROWS) })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`;

const NYC_COLUMNS = "camis,dba,boro,building,street,zipcode,phone,cuisine_description";
export const NYC_CUISINES = ["Coffee/Tea", "Bakery Products/Desserts"];

// The NYC preset's download link for any set of DOHMH cuisine names: one row
// per shop (grouped), not one per inspection.
export function nycDohmhUrl(cuisines: string[] = NYC_CUISINES): string {
  return soql("https://data.cityofnewyork.us/resource/43nn-pn8j.csv", {
    $select: NYC_COLUMNS,
    $where: `cuisine_description in(${cuisines.map((c) => `'${c.replace(/'/g, "''")}'`).join(",")})`,
    $group: NYC_COLUMNS,
  });
}

// One CSV row keyed by normalized header ("CUISINE DESCRIPTION" →
// "cuisine_description"), so both the SoQL export and the portal's "Export"
// button (display names) map.
type Row = Record<string, string>;
export const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// The lead fields a generic import may map a column onto: business, contact
// and address details. Compliance fields, stage, assignee and the paid dates
// are set only through the lead routes, where their rules run (consent text,
// no pilot or paid in bulk, a logged stage change).
export const MAPPABLE = [
  "business_name", "phone", "email", "address", "city", "state", "zip", "segment", "cluster", "owner_name",
  "owner_hours", "website", "instagram", "facebook", "language", "next_action", "source_id",
] as const satisfies readonly LeadKey[];
export type MappableKey = (typeof MAPPABLE)[number];

export type ImportOptions = {
  segment?: Segment; // used when the preset doesn't decide the segment
  cluster?: string; // "zip" = cluster by ZIP
  assignee_id?: string;
  source_pulled_at?: string; // YYYY-MM-DD, default today
  source?: string; // generic preset only, default "manual"
  mapping?: Partial<Record<MappableKey, string>>; // generic preset: lead field → CSV header
};

type Preset = {
  label: string;
  source: string;
  url: string | null;
  note: string;
  // lead field → candidate headers (normalized), first non-empty wins
  columns: Partial<Record<LeadKey, string[]>>;
  derive?: (r: Row, opts: ImportOptions) => Record<string, string | undefined>;
  defaults: Record<string, string>;
};

const pick = (r: Row, ...keys: string[]) => keys.map((k) => r[k]?.trim()).find(Boolean);

export const PRESETS = {
  nyc_dohmh: {
    label: "NYC restaurant inspections (DOHMH 43nn-pn8j)",
    source: "nyc_dohmh_43nn-pn8j",
    url: nycDohmhUrl(),
    note: "Coffee/Tea and Bakery Products/Desserts, one row per shop. The shop's listed phone is included.",
    columns: { source_id: ["camis"], business_name: ["dba"], zip: ["zipcode"], phone: ["phone"], city: ["boro"] },
    derive: (r) => {
      const cuisine = (r.cuisine_description ?? "").toLowerCase();
      return {
        address: [r.building, r.street].map((s) => s?.trim()).filter(Boolean).join(" "),
        segment: !cuisine ? undefined : /coffee|tea|bakery|dessert/.test(cuisine) ? "cafe" : "restaurant",
      };
    },
    defaults: { phone_type: "business_listed", phone_source: "open_data", state: "NY", recipient_tz: "America/New_York" },
  },
  sf_business: {
    label: "San Francisco registered businesses (g8m3-pdis)",
    source: "sf_g8m3-pdis",
    url: soql("https://data.sfgov.org/resource/g8m3-pdis.csv", {
      $select: "ttxid,ownership_name,dba_name,full_business_address,city,business_zip,location_start_date,self_reported_naics_code",
      $where: "starts_with(self_reported_naics_code,'722') AND location_end_date IS NULL AND city='San Francisco'",
    }),
    note: "NAICS 722 (food service), still open. Owner entity and opening date; no phone.",
    columns: {
      source_id: ["ttxid", "location_id"], owner_entity: ["ownership_name"], business_name: ["dba_name"],
      address: ["full_business_address", "street_address"], city: ["city"], zip: ["business_zip", "source_zipcode"],
      opened_on: ["location_start_date"],
    },
    defaults: { state: "CA" },
  },
  tx_permits: {
    label: "Texas sales tax permits (jrea-zgmq)",
    source: "tx_jrea-zgmq",
    url: soql("https://data.texas.gov/resource/jrea-zgmq.csv", {
      $select: "taxpayer_number,outlet_number,taxpayer_name,outlet_name,outlet_address,outlet_city,outlet_zip_code,outlet_naics_code,outlet_permit_issue_date",
      $where: "outlet_naics_code in('722511','722513','722515') AND outlet_city='AUSTIN'",
    }),
    note: "NAICS 722511/722513/722515. Change outlet_city in the link to your city. No phone.",
    columns: {
      owner_entity: ["taxpayer_name"], business_name: ["outlet_name"], address: ["outlet_address"],
      city: ["outlet_city"], zip: ["outlet_zip_code"], opened_on: ["outlet_permit_issue_date"],
    },
    derive: (r) => ({
      source_id: r.taxpayer_number && r.outlet_number ? `${r.taxpayer_number.trim()}-${r.outlet_number.trim()}` : undefined,
    }),
    defaults: { state: "TX" },
  },
  la_business: {
    label: "Los Angeles active businesses (6rrh-rzua)",
    source: "la_6rrh-rzua",
    url: soql("https://data.lacity.org/resource/6rrh-rzua.csv", {
      $select: "location_account,business_name,dba_name,street_address,city,zip_code,naics,location_start_date",
      $where: "starts_with(naics,'722') AND location_end_date IS NULL",
    }),
    note: "NAICS 722*, still open. Filter by ZIP in the link to stay under 10,000 rows. No phone.",
    columns: {
      source_id: ["location_account"], owner_entity: ["business_name"], address: ["street_address"],
      city: ["city"], zip: ["zip_code"], opened_on: ["location_start_date"],
    },
    // Many LA rows have no DBA: the legal name is then the shop's name.
    derive: (r) => ({ business_name: pick(r, "dba_name", "business_name") }),
    defaults: { state: "CA" },
  },
  chi_licenses: {
    label: "Chicago business licenses (r5kz-chrr)",
    source: "chi_r5kz-chrr",
    url: soql("https://data.cityofchicago.org/resource/r5kz-chrr.csv", {
      $select: "license_number,legal_name,doing_business_as_name,address,city,zip_code,date_issued,expiration_date",
      $where: `license_description='Retail Food Establishment' AND expiration_date > '${new Date().toISOString().slice(0, 10)}'`,
    }),
    note: "Retail Food Establishment, unexpired. Filter by ZIP in the link to stay under 10,000 rows. No phone.",
    columns: {
      source_id: ["license_number"], owner_entity: ["legal_name"], business_name: ["doing_business_as_name"],
      address: ["address"], city: ["city"], zip: ["zip_code"], opened_on: ["date_issued"],
    },
    defaults: { state: "IL" },
  },
  ca_abc_new: {
    label: "California ABC new applications (types 41/47)",
    source: "ca_abc_new_apps",
    url: "https://www.abc.ca.gov/licensing/licensing-reports/new-applications/",
    note: "Save the report as CSV and split owner and premises address into their own columns. The report date becomes the opening date.",
    columns: {
      source_id: ["license_number"], owner_name: ["primary_owner"], business_name: ["dba", "dba_name", "business_name", "primary_owner"],
      address: ["premises_address", "premises_addr", "address"], city: ["city"], zip: ["zip", "zip_code"],
    },
    derive: (_r, opts) => ({ opened_on: opts.source_pulled_at }),
    defaults: { state: "CA", segment: "restaurant" },
  },
  fdd_item20: {
    label: "FDD Item 20 franchisee list (typed by hand)",
    source: "fdd_item20",
    url: null,
    note: "Columns: franchise_brand, franchisee, address, city, state, zip, phone, fdd_loyalty_vendor. Stays franchisor_only until fdd_loyalty_vendor = no.",
    columns: {
      franchise_brand: ["franchise_brand", "brand"], owner_name: ["franchisee", "owner_name"], address: ["address"],
      city: ["city"], state: ["state"], zip: ["zip", "zip_code"], phone: ["phone"],
      fdd_loyalty_vendor: ["fdd_loyalty_vendor"], source_id: ["source_id"],
    },
    derive: (r) => ({
      business_name: pick(r, "business_name", "outlet_name") ?? [pick(r, "franchise_brand", "brand"), pick(r, "city")].filter(Boolean).join(" "),
    }),
    defaults: { phone_type: "business_listed", persona: "P5" },
  },
  apollo: {
    label: "Apollo CSV export",
    source: "apollo",
    url: null,
    note: "Internal use is allowed by Apollo's terms. Only the company line is imported as the phone, never a personal mobile.",
    columns: {
      business_name: ["company", "company_name"], email: ["email"], phone: ["corporate_phone", "company_phone"],
      website: ["website"], facebook: ["facebook_url"], address: ["company_address"], city: ["company_city", "city"],
      state: ["company_state", "state"],
    },
    derive: (r) => ({ owner_name: [pick(r, "first_name"), pick(r, "last_name")].filter(Boolean).join(" ") || undefined }),
    defaults: { email_source: "verified_vendor", phone_type: "unknown" },
  },
  generic: {
    label: "Generic (pick the columns)",
    source: "manual",
    url: null,
    note: "Any sheet, including the rep tracking sheet. Map each column to a lead field.",
    columns: {},
    defaults: { phone_type: "unknown" },
  },
} satisfies Record<string, Preset>;

export type PresetKey = keyof typeof PRESETS;
export const isPreset = (v: unknown): v is PresetKey => typeof v === "string" && Object.hasOwn(PRESETS, v);

// National chains are filtered out of every import. A name matches on whole
// words (STARBUCKS COFFEE #123, DUNKIN' DONUTS), or when its leading words
// run together spell the chain (MC DONALDS); CRUMBLY CAFE is not CRUMBL.
// ponytail: a hand-kept starter list; add names as imports show them.
const CHAINS = [
  "starbucks", "dunkin", "mcdonalds", "subway", "chipotle", "panera", "peets coffee", "tim hortons", "dutch bros",
  "caribou coffee", "krispy kreme", "burger king", "wendys", "taco bell", "dominos", "pizza hut", "papa johns", "kfc",
  "kentucky fried chicken", "chick fil a", "popeyes", "panda express", "jersey mikes", "jimmy johns", "five guys",
  "shake shack", "sweetgreen", "cava", "wingstop", "little caesars", "arbys", "sonic drive in", "dairy queen",
  "baskin robbins", "jamba", "smoothie king", "tropical smoothie", "einstein bros", "coffee bean and tea leaf",
  "pret a manger", "7 eleven", "auntie annes", "cinnabon", "crumbl", "nothing bundt cakes", "insomnia cookies",
  "le pain quotidien", "au bon pain", "potbelly", "qdoba", "white castle", "carls jr", "jack in the box", "in n out",
  "whataburger", "culvers", "raising canes", "del taco", "el pollo loco", "dennys", "ihop", "applebees", "wawa",
  "joe and the juice", "blank street", "gregorys coffee", "pressed juicery",
];
// Smaller franchise brands: imported, but flagged P5 / franchisor_only until
// the FDD is checked (strategy §2.3).
const FRANCHISE_BRANDS = [
  "paris baguette", "tous les jours", "85c bakery", "kung fu tea", "gong cha", "chatime", "sharetea", "coco fresh tea",
  "biggby", "scooters coffee", "ziggis coffee", "pjs coffee", "aroma joes", "human bean", "black rock coffee",
  "brueggers", "great american cookies", "marble slab", "wetzels pretzels", "robeks", "playa bowls", "nekter",
  "menchies", "yogurtland", "16 handles", "pinkberry", "sweetfrog", "duck donuts", "shipley do nuts", "ritas",
  "cold stone", "ben and jerrys", "kolache factory", "bubbakoos", "mr pickles", "philly pretzel factory",
];

function matcher(names: string[]) {
  const list = names.map((n) => ({ name: n, key: nameKey(n), compact: nameKey(n).replace(/ /g, "") }));
  return (key: string) => {
    const spaced = ` ${key} `;
    const lead = key.split(" ").map((_, i, w) => w.slice(0, i + 1).join(""));
    return list.find((c) => spaced.includes(` ${c.key} `) || lead.includes(c.compact))?.name ?? null;
  };
}
export const chainMatch = matcher(CHAINS);
export const franchiseMatch = matcher(FRANCHISE_BRANDS);

// The same business across store numbers: digits out ("starbucks coffee 123"
// → "starbucks coffee").
const chainKey = (key: string) => key.replace(/\d+/g, " ").replace(/\s+/g, " ").trim();

export type Candidate = {
  line: number; // 1-based data row (header excluded), for messages
  lead: LeadInput & { business_name: string; name_key: string; source: string };
  chain: boolean;
  franchise: boolean;
  badPhone: boolean;
};

export type ImportReport = {
  rows: number;
  wouldInsert: number;
  dupPhone: number;
  dupNameZip: number;
  dupUpdated: number; // duplicates whose empty fields this import fills
  suppressed: number;
  chain: number;
  invalidPhone: number;
  franchise: number;
  invalid: number; // rows without a business name
  chainNames: string[]; // first 20, so the preview shows what was dropped
};

export function prepareImport(
  preset: PresetKey,
  text: string,
  opts: ImportOptions,
  today = new Date().toISOString().slice(0, 10)
): { headers: string[]; candidates: Candidate[]; invalid: number; rows: number } | { error: string } {
  const all = parseCsv(text);
  if (!all.length) return { error: "The file is empty" };
  const [head, ...data] = all;
  if (data.length > MAX_IMPORT_ROWS) return { error: `Max ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows per import` };
  const keys = head.map(headerKey);
  const p: Preset = PRESETS[preset];
  const unmappable = Object.keys(opts.mapping ?? {}).find((f) => !(MAPPABLE as readonly string[]).includes(f));
  if (preset === "generic" && unmappable) return { error: `${unmappable} can't be imported: set it on the lead page` };
  const columns: Partial<Record<LeadKey, string[]>> =
    preset === "generic"
      ? Object.fromEntries(Object.entries(opts.mapping ?? {}).map(([f, h]) => [f, [headerKey(String(h))]]))
      : p.columns;
  const source = preset === "generic" ? opts.source?.trim() || "manual" : p.source;
  const pulled = opts.source_pulled_at ?? today;

  const candidates: Candidate[] = [];
  let invalid = 0;
  data.forEach((cells, i) => {
    const row: Row = Object.fromEntries(keys.map((k, j) => [k, cells[j] ?? ""]));
    const raw: Record<string, unknown> = { ...p.defaults };
    for (const [field, heads] of Object.entries(columns)) {
      const v = pick(row, ...(heads as string[]));
      if (v) raw[field] = v;
    }
    for (const [field, v] of Object.entries(p.derive?.(row, { ...opts, source_pulled_at: pulled }) ?? {}))
      if (v) raw[field] = v;
    raw.segment ??= opts.segment;
    raw.assignee_id ??= opts.assignee_id;
    raw.source = source;
    raw.source_pulled_at = pulled;

    const rawPhone = typeof raw.phone === "string" ? raw.phone : "";
    const checked = leadFields(raw, true);
    const lead = checked.ok ? checked.value : {};
    if (!lead.business_name) return void invalid++;
    const key = nameKey(lead.business_name);
    if (!key) return void invalid++;
    if (opts.cluster === "zip") lead.cluster = lead.zip ?? null;
    else if (opts.cluster?.trim()) lead.cluster ??= opts.cluster.trim().slice(0, 500);

    const brand = lead.franchise_brand ?? franchiseMatch(key);
    if (brand) {
      lead.franchise_brand = brand;
      lead.persona ??= "P5";
      if (lead.fdd_loyalty_vendor !== "no") lead.stage = "franchisor_only";
    }
    candidates.push({
      line: i + 1,
      lead: { ...lead, business_name: lead.business_name, name_key: key, source },
      chain: !!chainMatch(key),
      franchise: !!brand,
      badPhone: !!rawPhone && !salesPhone(rawPhone),
    });
  });

  // A name at 5+ shops of one file is a chain even if no list knows it; 2-4 is
  // a small chain (P4), kept and sized. Shops are told apart by address, then
  // phone, then source id, so repeated rows of one shop (the DOHMH portal
  // export has one per inspection) count once.
  const shops = new Map<string, Set<string>>();
  for (const { lead: l } of candidates) {
    const shop = l.address ? `${nameKey(l.address)}|${l.zip ?? ""}` : (l.phone ?? l.source_id ?? `|${l.zip ?? ""}`);
    const k = chainKey(l.name_key);
    shops.set(k, (shops.get(k) ?? new Set()).add(shop));
  }
  for (const c of candidates) {
    const n = shops.get(chainKey(c.lead.name_key))?.size ?? 1;
    if (n >= 5) c.chain = true;
    else if (n >= 2) c.lead.chain_size ??= n;
  }
  return { headers: head, candidates, invalid, rows: data.length };
}

// Fields a duplicate may have filled in by a later import: only empty ones,
// never compliance fields, stage, owner/assignee decisions or the source.
const FILLABLE = [
  "address", "city", "state", "zip", "cluster", "website", "instagram", "facebook", "owner_name", "owner_entity",
  "owner_hours", "language", "franchise_brand", "chain_size", "opened_on", "source_id", "source_pulled_at", "place_id",
  "recipient_tz",
] as const;

export const dupKey = (nameKeyValue: string, zip: string | null | undefined) => `${nameKeyValue}|${zip ?? ""}`;

// The fields `incoming` would fill on `target` (only where target is empty).
function fill(target: Partial<Lead>, incoming: Candidate["lead"]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of FILLABLE) if (target[f] == null && incoming[f] != null) patch[f] = incoming[f];
  if (target.email == null && incoming.email != null) Object.assign(patch, { email: incoming.email, email_source: incoming.email_source ?? null });
  return patch;
}

export function finishImport(
  candidates: Candidate[],
  existingByPhone: Map<string, Lead>,
  existingByNameZip: Map<string, Lead>,
  suppressed: Set<string>,
  base: { rows: number; invalid: number }
): { inserts: Candidate["lead"][]; updates: { id: string; patch: LeadInput }[]; report: ImportReport } {
  const report: ImportReport = {
    rows: base.rows, wouldInsert: 0, dupPhone: 0, dupNameZip: 0, dupUpdated: 0, suppressed: 0, chain: 0,
    invalidPhone: 0, franchise: 0, invalid: base.invalid, chainNames: [],
  };
  const inserts: Candidate["lead"][] = [];
  const updates: { id: string; patch: LeadInput }[] = [];
  // Rows already queued from this file, so a later duplicate row can fill
  // their gaps before insert (and a re-import then finds nothing to fill).
  const seenPhone = new Map<string, Candidate["lead"]>();
  const seenNameZip = new Map<string, Candidate["lead"]>();

  for (const c of candidates) {
    const { lead } = c;
    if (c.badPhone) report.invalidPhone++;
    const nz = dupKey(lead.name_key, lead.zip);
    const byPhone = lead.phone ? existingByPhone.get(lead.phone) : undefined;
    const byNameZip = existingByNameZip.get(nz);
    // Opted out = never imported again, whatever else the row says. A
    // do-not-contact lead stored without this row's phone or email has no
    // suppression row to match, so its name + ZIP counts too.
    if (
      (lead.phone && suppressed.has(lead.phone)) || (lead.email && suppressed.has(lead.email)) ||
      byPhone?.do_not_contact || byNameZip?.do_not_contact
    ) {
      report.suppressed++;
      continue;
    }
    if (c.chain) {
      report.chain++;
      if (report.chainNames.length < 20 && !report.chainNames.includes(lead.business_name)) report.chainNames.push(lead.business_name);
      continue;
    }
    const existing = lead.phone ? byPhone : byNameZip;
    const queued = lead.phone ? seenPhone.get(lead.phone) : seenNameZip.get(nz);
    if (existing || queued) {
      if (lead.phone) report.dupPhone++;
      else report.dupNameZip++;
      if (existing) {
        const patch = fill(existing, lead);
        if (Object.keys(patch).length) {
          report.dupUpdated++;
          updates.push({ id: existing.id, patch: patch as LeadInput });
        }
      } else if (queued) Object.assign(queued, fill(queued, lead));
      continue;
    }
    if (lead.phone) seenPhone.set(lead.phone, lead);
    else seenNameZip.set(nz, lead);
    if (c.franchise) report.franchise++;
    report.wouldInsert++;
    inserts.push(lead);
  }
  return { inserts, updates, report };
}
