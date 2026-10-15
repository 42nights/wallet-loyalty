"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeadListRow } from "@/lib/sales/types";
import s from "../../admin.module.css";
import t from "../tools.module.css";

// Pick the lead whose fields fill the scripts: newest leads until you type,
// then a search on name, owner, phone or ZIP (GET /api/admin/sales/leads).
export function LeadPicker({ current }: { current: { id: string | null; name: string } }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadListRow[] | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const query = q.trim();
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/sales/leads?limit=6${query.length >= 2 ? `&q=${encodeURIComponent(query)}` : ""}`, { signal: ctl.signal });
        if (res.status === 401) return router.push("/admin/login");
        const data = await res.json().catch(() => ({}));
        setHits(res.ok ? ((data.leads ?? []) as LeadListRow[]) : []);
      } catch {
        // aborted by the next keystroke
      }
    }, query ? 200 : 0);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q, router]);

  return (
    <div className={t.picker}>
      <div className={t.pickerNow}>
        <span className={t.rowName}>{current.name}</span>
        {current.id ? <Link href="/admin/sales/scripts" className={t.linkBtn}>Use the sample</Link> : <span className={t.flag}>sample</span>}
      </div>
      <input type="search" value={q} placeholder="Name, owner, phone or ZIP" aria-label="Search leads"
        onChange={(e) => setQ(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      {hits && (focused || q.trim()) && (
        <div className={t.hits}>
          {hits.length === 0 ? (
            <span className={s.hint}>{q.trim().length >= 2 ? "No lead matches." : "No leads yet."}</span>
          ) : (
            hits.map((l) => (
              <button type="button" key={l.id} className={t.hit} aria-current={current.id === l.id || undefined}
                onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(""); router.push(`/admin/sales/scripts?lead=${l.id}`); }}>
                <span>{l.business_name}</span>
                <small>{[l.cluster ?? l.zip, l.segment, l.stage].filter(Boolean).join(" · ")}</small>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(""), 1600);
  }

  return (
    <button type="button" className={`btn btn-ghost ${s.smallBtn} ${t.copy} ${t.press}`} disabled={disabled} onClick={() => void copy()} data-state={state || undefined}>
      <span aria-live="polite">{state === "copied" ? "Copied ✓" : state === "failed" ? "Select and copy" : "Copy"}</span>
    </button>
  );
}
