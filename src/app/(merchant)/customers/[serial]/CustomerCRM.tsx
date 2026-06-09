"use client";
import { useEffect, useState, useCallback } from "react";

type Tag = { id: string; label: string; color: string | null };
type Note = { id: number; body: string; created_at: string };

export default function CustomerCRM({ serial }: { serial: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [note, setNote] = useState("");
  const [newTag, setNewTag] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/merchant/crm?serial=${encodeURIComponent(serial)}`);
    if (!r.ok) return;
    const d = await r.json();
    setNotes(d.notes || []);
    setAssigned(d.assignedTagIds || []);
    setAllTags(d.allTags || []);
  }, [serial]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(payload: object) {
    setBusy(true);
    await fetch("/api/merchant/crm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    await load();
  }

  const assignedTags = allTags.filter((t) => assigned.includes(t.id));
  const available = allTags.filter((t) => !assigned.includes(t.id));

  return (
    <div className="card stack">
      <div className="label">Tags</div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {assignedTags.map((t) => (
          <button
            key={t.id}
            className="label"
            disabled={busy}
            onClick={() => act({ action: "removeTag", serial, tagId: t.id })}
            style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "3px 8px", cursor: "pointer" }}
          >
            {t.label} ✕
          </button>
        ))}
        {assignedTags.length === 0 && <span className="label">none</span>}
      </div>
      {available.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {available.map((t) => (
            <button key={t.id} className="btn btn-ghost" style={{ width: "auto", padding: "0 10px" }} disabled={busy}
              onClick={() => act({ action: "assignTag", serial, tagId: t.id })}>
              + {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="new tag…" />
        <button className="btn btn-ghost" style={{ width: "auto", padding: "0 14px" }} disabled={busy || !newTag.trim()}
          onClick={async () => { await act({ action: "createTag", label: newTag.trim() }); setNewTag(""); }}>
          Create
        </button>
      </div>

      <div className="label" style={{ marginTop: 8 }}>Notes</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="add a note…" rows={2}
        style={{ width: "100%", resize: "vertical" }} />
      <button className="btn btn-ghost" disabled={busy || !note.trim()}
        onClick={async () => { await act({ action: "addNote", serial, body: note.trim() }); setNote(""); }}>
        Add note
      </button>
      {notes.map((n) => (
        <div key={n.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>{n.body}</div>
          <span className="label" style={{ whiteSpace: "nowrap" }}>
            {new Date(n.created_at).toLocaleDateString("en-GB")}
          </span>
        </div>
      ))}
    </div>
  );
}
