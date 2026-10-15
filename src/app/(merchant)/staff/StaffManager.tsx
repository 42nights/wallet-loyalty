"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MIN_PASSWORD, isSupportUsername } from "@/lib/admin/merchant";
import Icon from "@/components/Icon";
import styles from "./staff.module.css";

type Member = { id: string; username: string; role: string; created_at: string };
// n re-keys the toast, so the same message twice still shows (and fades) again;
// once a success has faded it clears, so its slot leaves no empty space behind.
// at: "add" (the form), a member's id (shown in that row), or "list" (under the
// team, for a removal, whose row is gone).
type Msg = { at: string; kind: "ok" | "bad"; text: string; n: number } | null;
// one inline panel at a time, so opening Reset closes an open Remove
type Open = { id: string; mode: "reset" | "remove" } | null;

const OFFLINE = "Couldn't reach the server — nothing was changed. Try again.";

// Same rule the creator admin uses for staff passwords.
function pwProblem(pw: string): string | null {
  if (!pw) return "Enter a password.";
  if (pw.length < MIN_PASSWORD) return `Passwords need at least ${MIN_PASSWORD} characters.`;
  return null;
}

// first letters of the first and last word ("cashier2" → C2, "bluebird-maria" → BM), else the first two letters
function initials(username: string): string {
  const words = username.match(/[a-z]+|\d+/gi);
  return words && words.length > 1 ? words[0][0] + words[words.length - 1][0] : username.slice(0, 2);
}

// Scrolls a new panel or message into view only as far as needed. Module-level,
// so React calls it once per element, not on every render.
function reveal(el: HTMLElement | null) {
  if (!el) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
}

// A panel opening also focuses its first control (Cancel on a removal, so a
// double Enter never removes anyone).
function onPanel(el: HTMLElement | null) {
  if (!el) return;
  reveal(el);
  el.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
}

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function FieldError({ id, text }: { id: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="field-error" id={id}>
      <Icon name="alert" />
      {text}
    </div>
  );
}

function Status({ msg, at, clear }: { msg: Msg; at: string; clear: (n: number) => void }) {
  const m = msg?.at === at ? msg : null;
  return (
    <div className={`save-status ${styles.status}`} role="status" aria-live="polite">
      {m && (
        <div
          key={m.n}
          ref={reveal}
          className={`toast ${m.kind}`}
          role={m.kind === "bad" ? "alert" : undefined}
          onAnimationEnd={() => clear(m.n)}
        >
          <Icon name={m.kind === "ok" ? "check" : "alert"} />
          {m.text}
        </div>
      )}
    </div>
  );
}

export default function StaffManager() {
  const router = useRouter();
  const [list, setList] = useState<Member[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selfId, setSelfId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [addErr, setAddErr] = useState<{ username?: string; password?: string }>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<"add" | "row" | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetErr, setResetErr] = useState<string | null>(null);
  const clearMsg = (n: number) => setMsg((x) => (x?.n === n ? null : x));

  async function load() {
    try {
      const res = await fetch("/api/merchant/staff");
      if (res.status === 401) return router.push("/login");
      if (res.status === 403) return router.push("/scan?denied=1");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setList(data.staff ?? []);
      setSelfId(data.selfId ?? "");
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string, mode: "reset" | "remove") {
    setOpen((o) => (o?.id === id && o.mode === mode ? null : { id, mode }));
    setResetPw("");
    setResetErr(null);
  }

  async function addCashier(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const name = username.trim().toLowerCase();
    const errs = { username: name ? undefined : "Enter a username.", password: pwProblem(password) ?? undefined };
    setAddErr(errs);
    if (errs.username || errs.password) {
      document.getElementById(errs.username ? "new-username" : "new-password")?.focus();
      return;
    }
    setBusy("add");
    setMsg(null);
    const res = await fetch("/api/merchant/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name, password }),
    }).catch(() => null);
    setBusy(null);
    if (!res) return setMsg({ at: "add", kind: "bad", text: OFFLINE, n: Date.now() });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setAddErr({ username: `${name} is taken — try another username.` });
      document.getElementById("new-username")?.focus();
      return;
    }
    if (!res.ok)
      return setMsg({ at: "add", kind: "bad", text: data.error || "Couldn't add the cashier. Try again.", n: Date.now() });
    setMsg({ at: "add", kind: "ok", text: `Cashier ${name} added — they can sign in now.`, n: Date.now() });
    setUsername("");
    setPassword("");
    load();
  }

  async function remove(m: Member) {
    if (busy) return;
    setBusy("row");
    setMsg(null);
    const res = await fetch(`/api/merchant/staff/${m.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res) return setMsg({ at: m.id, kind: "bad", text: OFFLINE, n: Date.now() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      return setMsg({ at: m.id, kind: "bad", text: data.error || "Couldn't remove them. Try again.", n: Date.now() });
    setOpen(null);
    setMsg({ at: "list", kind: "ok", text: `Removed ${m.username}.`, n: Date.now() });
    load();
  }

  async function saveReset(e: FormEvent, m: Member) {
    e.preventDefault();
    if (busy) return;
    const problem = pwProblem(resetPw);
    if (problem) return setResetErr(problem);
    setBusy("row");
    setMsg(null);
    const res = await fetch(`/api/merchant/staff/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPw }),
    }).catch(() => null);
    setBusy(null);
    if (!res) return setResetErr(OFFLINE);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setResetErr(data.error || "Couldn't reset the password. Try again.");
    setOpen(null);
    setResetPw("");
    setMsg({ at: m.id, kind: "ok", text: `New password set for ${m.username}.`, n: Date.now() });
  }

  return (
    <div className={styles.cols}>
      <div className={styles.col}>
        <section className={`card stack ${styles.team}`} aria-labelledby="team-h" aria-busy={list === null && !loadFailed}>
          <header className={`panel-h ${styles.head}`}>
            <h2 className="panel-t" id="team-h">Team</h2>
            {list && <span className="panel-meta">{list.length === 1 ? "1 person" : `${list.length} people`}</span>}
          </header>
          {loadFailed && (
            <div className={styles.member}>
              <div className="toast bad" role="alert">
                <Icon name="alert" />
                Couldn&apos;t load your team — check the connection and try again.
              </div>
              <button className={`btn btn-ghost btn-sm ${styles.retry}`} type="button" onClick={load}>
                Try again
              </button>
            </div>
          )}
          {list === null &&
            !loadFailed &&
            [0, 1, 2].map((i) => (
              <div key={i} className={styles.member} aria-hidden="true">
                <div className={styles.row}>
                  <span className="avatar skel" />
                  <span className={`skel-line ${styles.skelName}`} />
                </div>
              </div>
            ))}
          {list?.map((m) => {
            const support = isSupportUsername(m.username);
            const self = m.id === selfId;
            const canRemove = (m.role === "cashier" || support) && !self;
            const isOpen = (mode: "reset" | "remove") => open?.id === m.id && open.mode === mode;
            return (
              <div key={m.id} className={styles.member}>
                <div className={styles.row}>
                  <span className="avatar" aria-hidden="true">{initials(m.username)}</span>
                  <div className={styles.who}>
                    <div className={styles.nameLine}>
                      <span className={styles.name}>{m.username}</span>
                      {self && <span className="chip">You</span>}
                    </div>
                    <div className={styles.meta}>
                      {/* the creator's "Manage as owner" login: no password, removable */}
                      {support ? (
                        <span className="chip chip--warn">42nights support</span>
                      ) : m.role === "owner" ? (
                        <span className="chip chip--accent">Owner</span>
                      ) : (
                        <span className="chip">Cashier</span>
                      )}
                      <span>Added {joined(m.created_at)}</span>
                    </div>
                  </div>
                  {(!support || canRemove) && (
                    <div className={styles.actions}>
                      {!support && (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          aria-expanded={isOpen("reset")}
                          onClick={() => toggle(m.id, "reset")}
                        >
                          Reset password
                        </button>
                      )}
                      {canRemove && (
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          aria-expanded={isOpen("remove")}
                          onClick={() => toggle(m.id, "remove")}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isOpen("remove") && (
                  <div className={`confirm confirm--danger ${styles.panel}`} ref={onPanel}>
                    <p className={styles.confirmText}>
                      Remove <b>{m.username}</b>? They will be signed out and can no longer use the Scan screen.
                    </p>
                    <div className="row">
                      <button className="btn btn-danger-solid" type="button" disabled={busy !== null} onClick={() => remove(m)}>
                        {busy === "row" ? "Removing…" : "Remove"}
                      </button>
                      <button className="btn btn-ghost" type="button" data-autofocus disabled={busy !== null} onClick={() => setOpen(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {isOpen("reset") && (
                  <form className={`confirm ${styles.panel}`} ref={onPanel} onSubmit={(e) => saveReset(e, m)} noValidate>
                    <div className="field">
                      <label className="field-label" htmlFor={`pw-${m.id}`}>
                        New password for {m.username}
                      </label>
                      <input
                        id={`pw-${m.id}`}
                        type="password"
                        value={resetPw}
                        onChange={(e) => {
                          setResetPw(e.target.value);
                          setResetErr(null);
                        }}
                        autoComplete="new-password"
                        data-autofocus
                        aria-invalid={resetErr ? true : undefined}
                        aria-describedby={resetErr ? `pwe-${m.id} pwh-${m.id}` : `pwh-${m.id}`}
                      />
                      <FieldError id={`pwe-${m.id}`} text={resetErr} />
                      <div className="field-help" id={`pwh-${m.id}`}>
                        At least {MIN_PASSWORD} characters. They&apos;ll use it the next time they sign in.
                      </div>
                    </div>
                    <div className="row">
                      <button className="btn btn-primary" type="submit" disabled={busy !== null}>
                        {busy === "row" ? "Saving…" : "Set new password"}
                      </button>
                      <button className="btn btn-ghost" type="button" disabled={busy !== null} onClick={() => setOpen(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                <Status msg={msg} at={m.id} clear={clearMsg} />
              </div>
            );
          })}
        </section>
        <Status msg={msg} at="list" clear={clearMsg} />
      </div>

      <section className="panel" aria-labelledby="add-h">
        <div className="panel-h">
          <h2 className="panel-t" id="add-h">Add a cashier</h2>
        </div>
        <form className={styles.form} onSubmit={addCashier} noValidate>
          <div className="field">
            <label className="field-label" htmlFor="new-username">Username</label>
            <input
              id="new-username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setAddErr((x) => ({ ...x, username: undefined }));
              }}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={addErr.username ? true : undefined}
              aria-describedby={addErr.username ? "new-username-err new-username-help" : "new-username-help"}
            />
            <FieldError id="new-username-err" text={addErr.username} />
            <div className="field-help" id="new-username-help">
              Lowercase letters and numbers. They type it exactly like this to sign in.
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="new-password">Password</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setAddErr((x) => ({ ...x, password: undefined }));
              }}
              autoComplete="new-password"
              aria-invalid={addErr.password ? true : undefined}
              aria-describedby={addErr.password ? "new-password-err new-password-help" : "new-password-help"}
            />
            <FieldError id="new-password-err" text={addErr.password} />
            <div className="field-help" id="new-password-help">At least {MIN_PASSWORD} characters.</div>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy !== null}>
            {busy === "add" ? "Adding…" : "Add cashier"}
          </button>
          <Status msg={msg} at="add" clear={clearMsg} />
        </form>
      </section>
    </div>
  );
}
