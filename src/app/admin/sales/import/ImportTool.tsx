"use client";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_TIMEZONE } from "@/lib/config";
import { parseCsv } from "@/lib/sales/csv";
import {
  MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, NYC_CUISINES, PRESETS, headerKey, nycDohmhUrl,
  type ImportOptions, type ImportReport, type MappableKey, type PresetKey,
} from "@/lib/sales/import";
import type { LeadInput } from "@/lib/sales/fields";
import { SEGMENTS, type ImportBatch, type Segment } from "@/lib/sales/types";
import s from "../../admin.module.css";
import t from "../tools.module.css";

type Person = { id: string; name: string };
type PreviewRow = LeadInput & { business_name: string; source: string };
type Preview = { report: ImportReport; preview: PreviewRow[]; headers: string[] };
type Done = { report: ImportReport & { inserted: number }; batch: string; source: string };
type Mapping = Partial<Record<MappableKey, string>>;

const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];
const nf = (n: number) => n.toLocaleString("en-US");
const phoneText = (p: string | null | undefined) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || "—";
};
const sourceLabel = (source: string) =>
  PRESET_KEYS.map((k) => PRESETS[k]).find((p) => p.source === source && p.source !== "manual")?.label ?? `Generic · ${source}`;

// Generic preset: the lead fields offered in the column picker, with the
// header names each one is guessed from (normalized, as headerKey() makes
// them). The rep tracking sheet (live-selling §12) maps without edits.
const MAP_FIELDS: [MappableKey, string, string[]][] = [
  ["business_name", "Business name", ["business_name", "business", "shop", "name", "dba", "company", "company_name"]],
  ["phone", "Phone", ["phone", "phone_number", "telephone", "owner_mobile"]],
  ["email", "Email", ["email", "email_address"]],
  ["address", "Street address", ["address", "street", "street_address"]],
  ["city", "City", ["city"]],
  ["state", "State", ["state"]],
  ["zip", "ZIP", ["zip", "zipcode", "zip_code", "postal_code"]],
  ["segment", "Segment", ["segment", "type"]],
  ["cluster", "Cluster", ["cluster", "area", "neighborhood", "neighbourhood"]],
  ["owner_name", "Owner name", ["owner_name", "owner", "owner_first_name"]],
  ["owner_hours", "Owner's best time", ["owner_hours", "owner_s_best_day_time", "best_time"]],
  ["website", "Website", ["website", "url"]],
  ["instagram", "Instagram", ["instagram"]],
  ["facebook", "Facebook", ["facebook"]],
  ["language", "Language", ["language"]],
  ["next_action", "Next step", ["next_action", "next_step", "next_step_date"]],
  ["source_id", "Source id", ["source_id"]],
];

function guessMapping(headers: string[]): Mapping {
  const used = new Set<string>();
  const out: Mapping = {};
  for (const [field, , aliases] of MAP_FIELDS) {
    const h = headers.find((x) => !used.has(x) && aliases.includes(headerKey(x)));
    if (h) (out[field] = h), used.add(h);
  }
  return out;
}

const firstRow = (text: string) => parseCsv(text.slice(0, 65_536))[0] ?? [];

export default function ImportTool({ people, batches, today }: { people: Person[]; batches: ImportBatch[]; today: string }) {
  const router = useRouter();
  const [preset, setPreset] = useState<PresetKey>("nyc_dohmh");
  const [cuisines, setCuisines] = useState(NYC_CUISINES.join(", "));
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [o, setO] = useState({ segment: "", cluster: "", byZip: false, assignee: "", pulled: today, source: "" });
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [dragging, setDragging] = useState(false);
  const [undoing, setUndoing] = useState("");
  const [undone, setUndone] = useState<{ batch: string; deleted: number; kept: number } | null>(null);

  const p = PRESETS[preset];
  const headers = useMemo(() => (mode === "paste" ? firstRow(pasted) : fileHeaders), [mode, pasted, fileHeaders]);
  const headerSig = headers.join("\u0001");
  useEffect(() => setMapping(guessMapping(headerSig ? headerSig.split("\u0001") : [])), [headerSig]);

  // Anything that changes what would be imported drops the old preview, so
  // the Import button always commits exactly what was previewed.
  const touch = () => {
    setPreview(null);
    setErr("");
  };

  async function pickFile(f: File | null) {
    touch();
    setDone(null);
    setFile(f);
    setFileHeaders(f ? firstRow(await f.slice(0, 65_536).text()) : []);
    if (f && f.size > MAX_IMPORT_BYTES) setErr(`${f.name} is ${(f.size / 1048576).toFixed(1)} MB. Max 5 MB per file.`);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void pickFile(f);
  }

  const csvFile = (): File | null =>
    mode === "file" ? file : pasted.trim() ? new File([pasted], "pasted.csv", { type: "text/csv" }) : null;

  async function send(dryRun: boolean) {
    const f = csvFile();
    if (!f) return setErr(mode === "file" ? "Choose a CSV file first." : "Paste the CSV first.");
    if (f.size > MAX_IMPORT_BYTES) return setErr("Max 5 MB per file.");
    if (preset === "generic" && !mapping.business_name) return setErr("Pick the column that holds the business name.");
    const opts: ImportOptions = { source_pulled_at: o.pulled || undefined };
    if (o.segment) opts.segment = o.segment as Segment;
    if (o.byZip) opts.cluster = "zip";
    else if (o.cluster.trim()) opts.cluster = o.cluster.trim();
    if (o.assignee) opts.assignee_id = o.assignee;
    if (preset === "generic") {
      opts.mapping = mapping;
      if (o.source.trim()) opts.source = o.source.trim();
    }
    const body = new FormData();
    body.set("file", f);
    body.set("preset", preset);
    body.set("dryRun", String(dryRun));
    body.set("options", JSON.stringify(opts));
    setBusy(dryRun ? "preview" : "commit");
    setErr("");
    try {
      const res = await fetch("/api/admin/sales/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return router.push("/admin/login");
      if (!res.ok) {
        setErr(data.error || "Import failed.");
        if (data.batch) router.refresh(); // a partial commit: its batch can be undone below
        return;
      }
      if (dryRun) setPreview(data as Preview);
      else {
        setDone({ ...(data as Omit<Done, "source">), source: preset === "generic" ? o.source.trim() || "manual" : p.source });
        setPreview(null);
        setUndone(null);
        router.refresh();
      }
    } catch {
      setErr("Network error. Check the connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function undo(batch: string, label: string, rows: number) {
    if (!confirm(`Undo the ${label} import (${nf(rows)} leads)?\n\nLeads nobody has worked are deleted. Leads with activities or marked do-not-contact stay. Opt-outs are always kept.`)) return;
    setUndoing(batch);
    setErr("");
    try {
      const res = await fetch(`/api/admin/sales/import/${batch}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return router.push("/admin/login");
      if (!res.ok) return setErr(data.error || "Undo failed.");
      setUndone({ batch, deleted: data.deleted, kept: data.kept });
      router.refresh();
    } catch {
      setErr("Network error. Check the connection and try again.");
    } finally {
      setUndoing("");
    }
  }

  const url = preset === "nyc_dohmh"
    ? nycDohmhUrl(cuisines.split(",").map((c) => c.trim()).filter(Boolean))
    : p.url;
  const r = preview?.report;
  const ready = mode === "file" ? !!file : !!pasted.trim();

  return (
    <div className={t.flow}>
      <section className="panel">
        <div className={s.sectionT}><span className={s.step}>1</span> Pick a source</div>
        <div className={t.presetGrid} role="radiogroup" aria-label="Import preset">
          {PRESET_KEYS.map((k) => (
            <button type="button" key={k} role="radio" aria-checked={preset === k} aria-pressed={preset === k}
              className={`${s.tpl} ${t.preset}`} onClick={() => { setPreset(k); touch(); }}>
              <span className={t.presetName}>{PRESETS[k].label}</span>
              <span className={t.presetSrc}>{PRESETS[k].source}</span>
            </button>
          ))}
        </div>
        <div className={t.srcBox}>
          <p>{p.note}</p>
          {preset === "nyc_dohmh" && (
            <label className={s.field}>
              <span className="label">DOHMH cuisines (exact names, comma-separated)</span>
              <input value={cuisines} onChange={(e) => setCuisines(e.target.value)} spellCheck={false} />
            </label>
          )}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className={t.srcLink}>
              {url.includes(".csv?") ? `Download the pre-filtered CSV (max ${nf(MAX_IMPORT_ROWS)} rows) ↗` : "Open the source page ↗"}
            </a>
          )}
          {url && <code className={t.url}>{url}</code>}
        </div>
      </section>

      <section className="panel">
        <div className={s.sectionT}><span className={s.step}>2</span> Add the CSV</div>
        <div className={t.seg} role="tablist" aria-label="CSV input">
          {(["file", "paste"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); touch(); }}>
              {m === "file" ? "Upload a file" : "Paste text"}
            </button>
          ))}
        </div>
        {mode === "file" ? (
          <label className={t.drop} data-drag={dragging || undefined} data-has={!!file || undefined}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <input type="file" accept=".csv,text/csv" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <>
                <span className={t.dropName}>{file.name}</span>
                <span className={s.hint}>{(file.size / 1024).toFixed(0)} KB · {headers.length} columns · click or drop to replace</span>
              </>
            ) : (
              <>
                <span className={t.dropName}>Drop a CSV here, or click to choose</span>
                <span className={s.hint}>Max 5 MB and {nf(MAX_IMPORT_ROWS)} rows. Parsed on the server.</span>
              </>
            )}
          </label>
        ) : (
          <label className={s.field}>
            <span className="label">CSV with a header row</span>
            <textarea rows={7} value={pasted} spellCheck={false} className={t.mono}
              placeholder={"shop,street,zip,phone\nMaple & Rye Cafe,214 Elm St,11201,(718) 555-0142"}
              onChange={(e) => { setPasted(e.target.value); touch(); setDone(null); }} />
          </label>
        )}

        {preset === "generic" && (
          <div className={t.mapBox}>
            <div className="label" style={{ margin: 0 }}>Columns → lead fields</div>
            {headers.length === 0 ? (
              <span className={s.hint}>Add a CSV to pick its columns.</span>
            ) : (
              <div className={t.mapGrid}>
                {MAP_FIELDS.map(([field, name]) => (
                  <label key={field} className={s.field}>
                    <span className={t.mapLabel}>{name}{field === "business_name" && " *"}</span>
                    <select value={mapping[field] ?? ""} onChange={(e) => { setMapping((m) => ({ ...m, [field]: e.target.value || undefined })); touch(); }}>
                      <option value="">—</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={t.optGrid}>
          <label className={s.field}>
            <span className="label">Segment</span>
            <select value={o.segment} onChange={(e) => { setO({ ...o, segment: e.target.value }); touch(); }}>
              <option value="">From the file</option>
              {SEGMENTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <div className={s.field}>
            <label className="label" htmlFor="import-cluster">Cluster</label>
            <input id="import-cluster" value={o.byZip ? "" : o.cluster} disabled={o.byZip} placeholder={o.byZip ? "Each lead's ZIP" : "e.g. Elm St"}
              onChange={(e) => { setO({ ...o, cluster: e.target.value }); touch(); }} />
            <label className={s.check}>
              <input type="checkbox" checked={o.byZip} onChange={(e) => { setO({ ...o, byZip: e.target.checked }); touch(); }} />
              <span className={s.hint}>Cluster by ZIP</span>
            </label>
          </div>
          <label className={s.field}>
            <span className="label">Assign to</span>
            <select value={o.assignee} onChange={(e) => { setO({ ...o, assignee: e.target.value }); touch(); }}>
              <option value="">Nobody (you)</option>
              {people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className={s.field}>
            <span className="label">Pulled on</span>
            <input type="date" value={o.pulled} onChange={(e) => { setO({ ...o, pulled: e.target.value }); touch(); }} />
          </label>
          {preset === "generic" && (
            <label className={s.field}>
              <span className="label">Source label</span>
              <input value={o.source} placeholder="manual" maxLength={60} onChange={(e) => { setO({ ...o, source: e.target.value }); touch(); }} />
            </label>
          )}
        </div>
        <span className={s.hint}>
          Duplicates only get their empty fields filled. Stage, assignee and every compliance field of an existing lead stay as they are.
        </span>
        <div className={s.actions}>
          <button type="button" className="btn btn-primary" disabled={!ready || busy !== ""} onClick={() => void send(true)}>
            {busy === "preview" ? "Checking…" : "Preview"}
          </button>
        </div>
        {err && <div className="toast bad" role="alert">{err}</div>}
      </section>

      {r && preview && (
        <section className="panel" aria-live="polite">
          <div className={s.sectionT}><span className={s.step}>3</span> Check, then import</div>
          <div className={t.stats}>
            <Stat k="Would insert" v={r.wouldInsert} tone="ok" sub={`of ${nf(r.rows)} rows`} />
            <Stat k="Duplicate · phone" v={r.dupPhone} sub="already a lead" />
            <Stat k="Duplicate · name+ZIP" v={r.dupNameZip} sub="already a lead" />
            <Stat k="Existing to fill" v={r.dupUpdated} sub="empty fields only" />
            <Stat k="Suppressed" v={r.suppressed} tone={r.suppressed ? "bad" : undefined} sub="opted out: never imported" />
            <Stat k="Chain-filtered" v={r.chain} tone={r.chain ? "warn" : undefined} sub="national chains, 5+ shops" />
            <Stat k="Bad phones" v={r.invalidPhone} tone={r.invalidPhone ? "warn" : undefined} sub="imported without the phone" />
            <Stat k="Franchise" v={r.franchise} tone={r.franchise ? "warn" : undefined} sub="P5 · franchisor only" />
            <Stat k="No name" v={r.invalid} sub="skipped" />
          </div>
          {r.chainNames.length > 0 && (
            <details className={t.details}>
              <summary>Chain names dropped: {r.chainNames.length}{r.chainNames.length === 20 ? "+" : ""} name{r.chainNames.length === 1 ? "" : "s"} across {nf(r.chain)} row{r.chain === 1 ? "" : "s"}</summary>
              <p>{r.chainNames.join(" · ")}</p>
            </details>
          )}
          {preview.preview.length === 0 ? (
            <div className={s.emptyState}><p>Nothing new to import from this file.</p></div>
          ) : (
            <>
              <div className="label" style={{ margin: 0 }}>First {preview.preview.length} of {nf(r.wouldInsert)} new leads, as they will be saved</div>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr><th>Business</th><th>Address</th><th>ZIP</th><th>Phone</th><th>Segment</th><th>Cluster</th><th>Flags</th></tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((l, i) => (
                      <tr key={i}>
                        <td>
                          <span className={t.rowName}>{l.business_name}</span>
                          {(l.owner_entity || l.owner_name) && <span className={s.slug}>{l.owner_name || l.owner_entity}</span>}
                        </td>
                        <td data-label="Address">{[l.address, l.city].filter(Boolean).join(", ") || "—"}</td>
                        <td data-label="ZIP">{l.zip || "—"}</td>
                        <td data-label="Phone">{phoneText(l.phone)}</td>
                        <td data-label="Segment">{l.segment ?? "cafe"}</td>
                        <td data-label="Cluster">{l.cluster || "—"}</td>
                        <td data-label="Flags">
                          <span className={t.flags}>
                            {l.franchise_brand && <span className={t.flagWarn}>franchise · {l.franchise_brand}</span>}
                            {l.chain_size && <span className={t.flag}>{l.chain_size} in file</span>}
                            {l.opened_on && <span className={t.flag}>opened {l.opened_on}</span>}
                            {!l.franchise_brand && !l.chain_size && !l.opened_on && "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className={s.actions}>
            <button type="button" className="btn btn-primary" disabled={busy !== "" || (!r.wouldInsert && !r.dupUpdated)} onClick={() => void send(false)}>
              {busy === "commit" ? "Importing…" : r.wouldInsert ? `Import ${nf(r.wouldInsert)} lead${r.wouldInsert === 1 ? "" : "s"}` : `Fill ${nf(r.dupUpdated)} existing`}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy !== ""} onClick={touch}>Cancel</button>
          </div>
        </section>
      )}

      {done && (
        <section className={`panel ${t.summary}`} aria-live="polite">
          <div className={t.summaryHead}>
            <span className={t.check} aria-hidden>✓</span>
            <div>
              <div className={t.summaryT}>Imported {nf(done.report.inserted)} new lead{done.report.inserted === 1 ? "" : "s"}</div>
              <div className={s.hint}>
                {sourceLabel(done.source)} · batch {done.batch.slice(0, 8)}
              </div>
            </div>
          </div>
          <ul className={t.summaryList}>
            <li>Filled empty fields on {nf(done.report.dupUpdated)} existing lead{done.report.dupUpdated === 1 ? "" : "s"}</li>
            <li>Skipped {nf(done.report.dupPhone + done.report.dupNameZip)} duplicates, {nf(done.report.chain)} chain rows, {nf(done.report.suppressed)} opted out, {nf(done.report.invalid)} without a name</li>
            {done.report.franchise > 0 && <li>{nf(done.report.franchise)} franchise leads set to franchisor only until the FDD is checked</li>}
          </ul>
          <div className={s.actions}>
            <Link href={`/admin/sales/leads?source=${encodeURIComponent(done.source)}`} className="btn btn-primary" style={{ textDecoration: "none" }}>
              Open these leads
            </Link>
            {undone?.batch !== done.batch && (
              <button type="button" className="btn btn-ghost" disabled={undoing !== ""}
                onClick={() => void undo(done.batch, sourceLabel(done.source), done.report.inserted)}>
                {undoing === done.batch ? "Undoing…" : "Undo this import"}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-h">
          <span className="panel-t">Import history</span>
          <span className="label" style={{ margin: 0 }}>{batches.length} batch{batches.length === 1 ? "" : "es"}</span>
        </div>
        {undone && (
          <div className="toast ok" style={{ marginTop: 0 }}>
            Undo done: removed {nf(undone.deleted)} lead{undone.deleted === 1 ? "" : "s"}
            {undone.kept ? `, kept ${nf(undone.kept)} (worked or do-not-contact)` : ""}.
          </div>
        )}
        {batches.length === 0 ? (
          <div className={s.emptyState}><p>No imports yet.</p></div>
        ) : (
          <div className={t.history}>
            {batches.map((b) => (
              <div key={b.batch} className={t.historyRow}>
                <div className={t.historyMain}>
                  <span className={t.rowName}>{sourceLabel(b.source)}</span>
                  <span className={s.hint}>
                    {new Date(b.imported_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: DEFAULT_TIMEZONE })} · batch {b.batch.slice(0, 8)}
                  </span>
                </div>
                <span className={t.historyRows}>{nf(b.rows)} <small>leads</small></span>
                <button type="button" className={`btn btn-ghost ${s.smallBtn}`} disabled={undoing !== ""}
                  onClick={() => void undo(b.batch, sourceLabel(b.source), b.rows)}>
                  {undoing === b.batch ? "Undoing…" : "Undo batch"}
                </button>
              </div>
            ))}
          </div>
        )}
        <span className={s.hint}>Undo deletes only the batch&apos;s leads that have no activities and are not do-not-contact.</span>
      </section>
    </div>
  );
}

function Stat({ k, v, sub, tone }: { k: string; v: number; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={t.stat} data-tone={tone}>
      <span className={t.statK}>{k}</span>
      <span className={t.statV}>{nf(v)}</span>
      {sub && <span className={t.statSub}>{sub}</span>}
    </div>
  );
}
