"use client";
import { useEffect, useState, useCallback, useId, type FormEvent } from "react";
import Icon from "@/components/Icon";
import d from "./detail.module.css";

type Tag = { id: string; label: string; color: string | null };
type Note = { id: number; body: string; created_at: string };
type Where = "load" | "tags" | "notes";

const noteDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default function CustomerCRM({ serial }: { serial: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [newTag, setNewTag] = useState("");
  // which control is saving: "create", "note", or the id of a tag being added/removed
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ where: Where; text: string } | null>(null);
  const tagField = useId();
  const noteField = useId();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/merchant/crm?serial=${encodeURIComponent(serial)}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      setNotes(data.notes || []);
      setAssigned(data.assignedTagIds || []);
      setAllTags(data.allTags || []);
      setLoaded(true);
    } catch {
      setError({ where: "load", text: "Couldn't load tags and notes — check the connection and try again." });
    }
  }, [serial]);

  useEffect(() => {
    load();
  }, [load]);

  // true once the server has it; a failure keeps what was typed so it can be retried
  async function act(payload: Record<string, unknown>, key: string): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/merchant/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      await load();
      return true;
    } catch {
      setError({ where: key === "note" ? "notes" : "tags", text: "Couldn't save — try again." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  // Create = make the tag and attach it to this customer. A label that already
  // exists (any case) just attaches that tag instead of making a duplicate.
  async function createTag(e: FormEvent) {
    e.preventDefault();
    const label = newTag.trim();
    if (!label || busy) return;
    const existing = allTags.find((t) => t.label.toLowerCase() === label.toLowerCase());
    const ok = await act(
      existing ? { action: "assignTag", serial, tagId: existing.id } : { action: "createTag", serial, label },
      "create"
    );
    if (ok) setNewTag("");
  }

  async function addNote() {
    if (await act({ action: "addNote", serial, body: note.trim() }, "note")) setNote("");
  }

  const assignedTags = allTags.filter((t) => assigned.includes(t.id));
  const available = allTags.filter((t) => !assigned.includes(t.id));
  const toast = (where: Where) =>
    error?.where === where && (
      <div className="toast bad" role="alert">
        <Icon name="alert" />
        {error.text}
      </div>
    );

  return (
    <section className="panel">
      <h2 className="panel-t">Tags &amp; notes</h2>
      {error?.where === "load" && (
        <div className={d.retry}>
          {toast("load")}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(null); load(); }}>
            Try again
          </button>
        </div>
      )}

      {loaded && (
        <div className={d.tags}>
          {assignedTags.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip ${d.tag}`}
              aria-label={`${t.label} ✕`}
              title={`Remove the ${t.label} tag`}
              disabled={!!busy}
              onClick={() => act({ action: "removeTag", serial, tagId: t.id }, t.id)}
            >
              {t.label}
              <Icon name="x" />
            </button>
          ))}
          {assignedTags.length === 0 && <p className={d.none}>No tags yet.</p>}
        </div>
      )}
      {available.length > 0 && (
        <div className={d.suggest}>
          {available.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={!!busy}
              onClick={() => act({ action: "assignTag", serial, tagId: t.id }, t.id)}
            >
              + {t.label}
            </button>
          ))}
        </div>
      )}
      <form className="field" onSubmit={createTag}>
        <label className="field-label" htmlFor={tagField}>Add a tag</label>
        <div className={d.inline}>
          <input
            id={tagField}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="new tag…"
            maxLength={40}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-ghost" disabled={!!busy || !newTag.trim()}>
            {busy === "create" ? "Saving…" : "Create"}
          </button>
        </div>
      </form>
      {toast("tags")}

      <hr className={d.rule} />

      <div className="field">
        <label className="field-label" htmlFor={noteField}>Add a note</label>
        <textarea
          id={noteField}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Prefers oat milk, comes in on Fridays"
          rows={3}
          maxLength={2000}
        />
      </div>
      <button type="button" className={`btn btn-ghost ${d.start}`} disabled={!!busy || !note.trim()} onClick={addNote}>
        {busy === "note" ? "Saving…" : "Add note"}
      </button>
      {toast("notes")}
      {notes.length > 0 && (
        <ul className={d.notes}>
          {notes.map((n) => (
            <li key={n.id}>
              <p className={d.noteBody}>{n.body}</p>
              <time className={d.noteDate} dateTime={n.created_at}>
                {noteDate.format(new Date(n.created_at)).replace(/AM|PM/, (m) => m.toLowerCase())}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
