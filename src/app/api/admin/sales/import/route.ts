import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { leadFields } from "@/lib/sales/fields";
import {
  MAX_IMPORT_BYTES, dupKey, finishImport, isPreset, prepareImport, type ImportOptions,
} from "@/lib/sales/import";
import { importBatches, suppressedValues } from "@/lib/sales/server";
import type { Lead } from "@/lib/sales/types";

export const runtime = "nodejs";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// GET /api/admin/sales/import → {batches: [{batch, source, rows, imported_at}]}
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json({ batches: await importBatches() });
  } catch (e) {
    console.error((e as Error).message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

// Existing leads that rows of this file could duplicate: by phone, and by
// name key (ZIP compared here). Chunked: in() lists travel in the URL. When
// two leads share a name + ZIP (one with a phone, one without), a
// do-not-contact one wins, so finishImport() sees the opt-out.
async function existingLeads(phones: string[], keys: string[]) {
  const byPhone = new Map<string, Lead>();
  const byNameZip = new Map<string, Lead>();
  const lookups: [string, string[]][] = [["phone", [...new Set(phones)]], ["name_key", [...new Set(keys)]]];
  for (const [col, values] of lookups)
    for (let i = 0; i < values.length; i += 150) {
      const { data, error } = await db.from("sales_leads").select("*").in(col, values.slice(i, i + 150));
      if (error) throw new Error(`import dedupe lookup failed: ${error.message}`);
      for (const l of (data ?? []) as Lead[]) {
        if (l.phone) byPhone.set(l.phone, l);
        const k = dupKey(l.name_key, l.zip);
        if (!byNameZip.get(k)?.do_not_contact) byNameZip.set(k, l);
      }
    }
  return { byPhone, byNameZip };
}

// POST /api/admin/sales/import  multipart: file, preset, dryRun ("true" |
// "false"), options (JSON ImportOptions)
// dryRun → {report, preview (first 20 mapped rows), headers}; commit →
// {report, batch}. Opted-out phones/emails and chains are never imported;
// duplicates only have their empty, non-compliance fields filled.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return unauthorized();
  if (!(await rateLimit("sales-import", 20, 60))) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send multipart form data" }, { status: 400 });
  const file = form.get("file");
  const preset = form.get("preset");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV file" }, { status: 400 });
  if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: "Max 5 MB per file" }, { status: 413 });
  if (!isPreset(preset)) return NextResponse.json({ error: "Unknown preset" }, { status: 400 });
  const dryRun = form.get("dryRun") !== "false";

  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(String(form.get("options") ?? "{}")) ?? {};
  } catch {
    return NextResponse.json({ error: "options must be JSON" }, { status: 400 });
  }
  const checked = leadFields(
    { segment: raw.segment, assignee_id: raw.assignee_id, source_pulled_at: raw.source_pulled_at, source: raw.source },
    false
  );
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const opts: ImportOptions = {
    segment: checked.value.segment,
    assignee_id: checked.value.assignee_id ?? undefined,
    source_pulled_at: checked.value.source_pulled_at ?? undefined,
    source: checked.value.source ?? undefined,
    cluster: typeof raw.cluster === "string" ? raw.cluster : undefined,
    mapping:
      raw.mapping && typeof raw.mapping === "object"
        ? Object.fromEntries(Object.entries(raw.mapping).filter(([, h]) => typeof h === "string" && h))
        : undefined,
  };
  if (preset === "generic" && !opts.mapping?.business_name)
    return NextResponse.json({ error: "Map a column to business_name" }, { status: 400 });
  if (opts.assignee_id) {
    const { data, error } = await db.from("sales_people").select("id").eq("id", opts.assignee_id).maybeSingle();
    if (error) {
      console.error("sales import assignee lookup failed:", error.message);
      return NextResponse.json({ error: "Query failed" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "assignee_id: nobody on the roster has this id" }, { status: 400 });
  }

  const prepared = prepareImport(preset, await file.text(), opts);
  if ("error" in prepared) return NextResponse.json({ error: prepared.error }, { status: 400 });
  const { candidates } = prepared;

  let done: ReturnType<typeof finishImport>;
  try {
    const [existing, suppressed] = await Promise.all([
      existingLeads(candidates.flatMap((c) => (c.lead.phone ? [c.lead.phone] : [])), candidates.map((c) => c.lead.name_key)),
      suppressedValues(candidates.flatMap((c) => [c.lead.phone, c.lead.email])),
    ]);
    done = finishImport(candidates, existing.byPhone, existing.byNameZip, suppressed, prepared);
  } catch (e) {
    console.error((e as Error).message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
  if (dryRun) return NextResponse.json({ report: done.report, preview: done.inserts.slice(0, 20), headers: prepared.headers });

  // Commit. One batch id for undo. Inserts in chunks; a failed chunk stops
  // the import and reports what landed (undo removes it). Rows carry
  // different fields, so a field a row lacks must take the column default
  // (defaultToNull: false), not NULL.
  const batch = randomUUID();
  let inserted = 0;
  for (let i = 0; i < done.inserts.length; i += 500) {
    const chunk = done.inserts.slice(i, i + 500).map((l) => ({ ...l, import_batch: batch }));
    const { error } = await db.from("sales_leads").insert(chunk, { defaultToNull: false });
    if (error) {
      console.error("sales import insert failed:", error.message);
      return NextResponse.json(
        { error: `Import stopped after ${inserted} rows: ${error.code === "23505" ? "a duplicate appeared meanwhile" : "database error"}. Undo the batch and retry.`, batch },
        { status: 500 }
      );
    }
    inserted += chunk.length;
  }
  const now = new Date().toISOString();
  for (let i = 0; i < done.updates.length; i += 10)
    await Promise.all(
      done.updates.slice(i, i + 10).map(async (u) => {
        const { error } = await db.from("sales_leads").update({ ...u.patch, updated_at: now }).eq("id", u.id);
        if (error) console.error("sales import fill failed:", error.message);
      })
    );
  return NextResponse.json({ report: { ...done.report, inserted }, batch });
}
