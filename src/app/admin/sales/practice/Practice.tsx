"use client";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { PersonaKey, Scorecard, Turn } from "./coach";
import s from "../../admin.module.css";
import t from "../tools.module.css";

type PublicPersona = { key: PersonaKey; label: string; who: string; name: string; scene: string };
type Limits = { min: number; max: number; chars: number };

// *action* in a reply ("*rings up a customer*") reads as stage direction.
function Said({ text }: { text: string }) {
  return <>{text.split(/(\*[^*\n]{1,120}\*)/g).map((part, i) => (i % 2 ? <em key={i}>{part.slice(1, -1)}</em> : part))}</>;
}

export default function Practice({ personas, off, limits }: { personas: PublicPersona[]; off: string | null; limits: Limits }) {
  const router = useRouter();
  const [key, setKey] = useState<PersonaKey>(personas[0].key);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"" | "reply" | "score">("");
  const [err, setErr] = useState("");
  const [card, setCard] = useState<Scorecard | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const persona = personas.find((p) => p.key === key)!;
  const yours = turns.filter((x) => x.role === "user").length;
  const full = yours >= limits.max && turns.at(-1)?.role === "assistant";

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, busy]);
  useEffect(() => {
    if (card) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [card]);

  function restart(next: PersonaKey = key) {
    setKey(next);
    setTurns([]);
    setCard(null);
    setErr("");
    setInput("");
    inputRef.current?.focus();
  }

  function pick(next: PersonaKey) {
    if (next === key) return;
    if (turns.length && !card && !confirm("Start over with a different owner? This conversation is not saved.")) return;
    restart(next);
  }

  async function post(body: object): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch("/api/admin/sales/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: key, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/admin/login");
        return null;
      }
      if (!res.ok) {
        setErr(data.error || "Something went wrong. Try again.");
        return null;
      }
      return data;
    } catch {
      setErr("Network error. Check the connection and try again.");
      return null;
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy || off || full || card) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    setErr("");
    setBusy("reply");
    const data = await post({ messages: next });
    setBusy("");
    if (typeof data?.reply === "string") setTurns([...next, { role: "assistant", content: data.reply }]);
    else {
      // Roll back so the turn can be sent again and the turns still alternate.
      setTurns(turns);
      setInput(text);
    }
  }

  async function score() {
    if (busy || yours < limits.min) return;
    setErr("");
    setBusy("score");
    const data = await post({ messages: turns, score: true });
    setBusy("");
    if (data?.scorecard) setCard(data.scorecard as Scorecard);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className={t.flow}>
      {off && (
        <div className={`panel ${t.offPanel}`} role="status">
          <span className={t.offTitle}>{off}</span>
          <span className={s.hint}>
            Add the key to the server environment and reload. The owner is played by Claude Haiku and the scorecard comes from Claude Sonnet. Nothing is stored and nothing is sent to anyone.
          </span>
        </div>
      )}

      <div className={t.practiceGrid}>
        <div className={t.personas} role="radiogroup" aria-label="Who you're pitching">
          {personas.map((p) => (
            <button type="button" key={p.key} role="radio" aria-checked={key === p.key} aria-pressed={key === p.key}
              className={`${s.tpl} ${t.persona}`} onClick={() => pick(p.key)}>
              <span className={t.personaName}>{p.label}</span>
              <span className={t.personaWho}>{p.who}</span>
            </button>
          ))}
          <ul className={t.tips}>
            <li>Give a reason and a local detail in the first ten seconds.</li>
            <li>Ask who decides, then ask before you pitch.</li>
            <li>Offer to show it on their own phone.</li>
            <li>Close on a dated next step.</li>
          </ul>
        </div>

        <section className={`panel ${t.chat}`} aria-label="Practice conversation">
          <div className={t.chatHead}>
            <div className={t.chatWho}>
              <span className={t.rowName}>{persona.name}</span>
              <span className={s.hint}>{persona.label}</span>
            </div>
            <div className={t.turnMeter} aria-label={`${yours} of ${limits.max} turns`}>
              {Array.from({ length: limits.max }, (_, i) => (
                <span key={i} data-on={i < yours || undefined} data-min={i === limits.min - 1 || undefined} />
              ))}
            </div>
            {turns.length > 0 && <button type="button" className={t.linkBtn} onClick={() => restart()}>Start over</button>}
          </div>

          <div ref={logRef} className={t.log} aria-live="polite">
            <p className={t.scene}>{persona.scene}</p>
            {turns.length === 0 && !off && <p className={t.sceneHint}>You walk up to the counter. What do you say?</p>}
            {turns.map((m, i) => (
              <div key={i} className={t.msg} data-who={m.role === "user" ? "you" : "them"}>
                <span className={t.msgWho}>{m.role === "user" ? "You" : persona.name}</span>
                <p><Said text={m.content} /></p>
              </div>
            ))}
            {busy === "reply" && (
              <div className={t.msg} data-who="them" aria-label={`${persona.name} is answering`}>
                <span className={t.msgWho}>{persona.name}</span>
                <p className={t.typing}><span /><span /><span /></p>
              </div>
            )}
          </div>

          <form className={t.composer} onSubmit={send}>
            <textarea ref={inputRef} rows={2} value={input} maxLength={limits.chars} disabled={!!off || full || !!card}
              placeholder={off ? "Set ANTHROPIC_API_KEY to practise" : card ? "Scored. Start over to practise again." : full ? `That's ${limits.max} turns: get your scorecard.` : "What you'd say at the counter…"}
              aria-label="What you say" onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
            <button type="submit" className={`btn btn-primary ${t.sendBtn}`} disabled={!input.trim() || !!busy || !!off || full || !!card}>
              Send
            </button>
          </form>
          <div className={t.chatFoot}>
            <span className={s.hint}>
              {yours < limits.min ? `Scorecard after ${limits.min - yours} more turn${limits.min - yours === 1 ? "" : "s"}` : `Turn ${yours} of ${limits.max}`} <span className={t.kbd}>· Enter sends, Shift+Enter for a new line</span>
            </span>
            <button type="button" className={`btn btn-ghost ${s.smallBtn}`} disabled={yours < limits.min || !!busy || !!card} onClick={() => void score()}>
              {busy === "score" ? "Scoring…" : "Get my scorecard"}
            </button>
          </div>
          {err && <div className="toast bad" role="alert" style={{ marginTop: 0 }}>{err}</div>}
        </section>
      </div>

      {card && (
        <section ref={cardRef} className={`panel ${t.card}`} aria-label="Scorecard">
          <div className={t.cardHead}>
            <div className={t.score}>
              <span className={t.scoreN}>{card.score}<small>/5</small></span>
              <span className={t.pips} aria-hidden>
                {[1, 2, 3, 4, 5].map((n) => <span key={n} data-on={n <= card.score || undefined} />)}
              </span>
            </div>
            <p className={t.outcome}>{card.outcome}</p>
          </div>
          <div className={t.cardGrid}>
            <div className={t.cardCol}>
              <span className="panel-t">What worked</span>
              {card.worked.length ? (
                <ul className={t.worked}>{card.worked.map((w, i) => <li key={i}>{w}</li>)}</ul>
              ) : <span className={s.hint}>Nothing stood out yet.</span>}
              {card.slips.length > 0 && (
                <>
                  <span className="panel-t">Slips</span>
                  <ul className={t.slips}>{card.slips.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </>
              )}
            </div>
            <div className={t.cardCol}>
              <span className="panel-t">Say this instead</span>
              {card.fixes.length ? card.fixes.map((f, i) => (
                <div key={i} className={t.fix}>
                  {f.said && <p className={t.fixSaid}>&ldquo;{f.said}&rdquo;</p>}
                  <p className={t.fixInstead}>&ldquo;{f.instead}&rdquo;</p>
                  {f.why && <p className={s.hint}>{f.why}</p>}
                </div>
              )) : <span className={s.hint}>No changes suggested.</span>}
            </div>
          </div>
          {card.drill && <p className={t.drill}><b>Next time:</b> {card.drill}</p>}
          <div className={s.actions}>
            <button type="button" className="btn btn-primary" onClick={() => restart()}>Practise again</button>
            <span className={s.hint}>Coaching from the sales kit. Practice only: nothing is saved.</span>
          </div>
        </section>
      )}
    </div>
  );
}
