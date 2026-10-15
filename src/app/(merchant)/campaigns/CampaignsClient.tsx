"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { unitLabel, type LoyaltyMode } from "@/lib/config";
import { SEGMENTS, segmentDefinition, segmentLabel } from "@/lib/segments";
import Icon from "@/components/Icon";
import s from "./campaigns.module.css";

const MAX_BONUS = 100_000; // the campaigns route's own cap (a stamp card: its goal)
const MAX_TARGETS = 2000; // the route sends to at most this many cards per campaign
const RESULT_DAYS = 14; // campaign_lift counts purchases this long after the send
const NEW = "new"; // the form's confirm/message slot; a draft row uses its campaign id
const nf = (n: number) => n.toLocaleString();
const customers = (n: number) => `${nf(n)} customer${n === 1 ? "" : "s"}`;
const day = (d: Date) =>
  d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });

// The table only knows draft and sent; "sending" is a draft whose Finish
// sending is in flight.
const STATUS: Record<string, [label: string, chip: string]> = {
  draft: ["Draft", "chip--warn"],
  sending: ["Sending", ""],
  sent: ["Sent", "chip--ok"],
};

// The route's copy says "segment" and "History"; this page says "group" and
// "Sent campaigns".
const SERVER_ERROR: Record<number, string> = {
  403: "You've been signed out. Sign in again, then check Sent campaigns.",
  409: "A campaign to this group hasn't finished sending. Use Finish sending under Sent campaigns.",
  422: "No customers in this group right now.",
};

type Lift = { targeted: number; earned_after: number; lift_pct: number };
type Campaign = {
  id: string;
  name: string;
  segment: string;
  bonus_points: number;
  offer_text: string | null;
  status: string;
  targeted: number;
  created_at: string;
  sent_at: string | null;
  lift: Lift | null;
};
type Msg = { at: string; kind: "ok" | "bad"; text: string };

// `mode`: a stamp card gives bonus stamps, at most one full card (`stampGoal`),
// and has no result (campaign_lift counts bills, earn:purchase, which a stamp
// card never records), so the Result column shows a dash.
export default function CampaignsClient({
  counts,
  initialSegment,
  mode,
  stampGoal,
}: {
  counts: Record<string, number>;
  initialSegment: string;
  mode: LoyaltyMode;
  stampGoal: number;
}) {
  const stamps = mode === "stamps";
  const maxBonus = stamps ? stampGoal : MAX_BONUS;
  const units = unitLabel(mode, 2);
  const u = (n: number) => unitLabel(mode, n, true);
  const count = (k: string) => counts[k] ?? 0;
  const who = (k: string) => `${nf(count(k))} ${segmentLabel(k)} customer${count(k) === 1 ? "" : "s"}`;

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [segment, setSegment] = useState(initialSegment);
  const [bonus, setBonus] = useState(stamps ? "1" : "100");
  const [offer, setOffer] = useState("");
  const [errors, setErrors] = useState<{ name?: string; bonus?: string }>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const sendId = useMemo(() => crypto.randomUUID(), [name, segment, bonus, offer]);
  const confirmBox = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const targetCount = count(segment);
  // Whole points only; "abc", "-5" or "1.5" must not quietly become a number.
  const bonusPts = /^\d+$/.test(bonus.trim()) ? Number(bonus.trim()) : NaN;

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/merchant/campaigns");
      if (!r.ok) throw new Error(String(r.status));
      const d: { campaigns?: Campaign[] } = await r.json();
      setCampaigns(d.campaigns ?? []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // An opened confirm scrolls into view and takes focus (spec §4); closing it
  // hands focus back to whatever opened it.
  useEffect(() => {
    const box = confirmBox.current;
    if (!confirm || !box) {
      opener.current?.focus();
      opener.current = null;
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    box.querySelector("button")?.focus({ preventScroll: true });
  }, [confirm]);

  // A success note fades at 2.5s (.save-status), then leaves.
  useEffect(() => {
    if (msg?.kind !== "ok") return;
    const t = setTimeout(() => setMsg(null), 2800);
    return () => clearTimeout(t);
  }, [msg]);

  function open(slot: string) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirm(slot);
  }

  // Any edit invalidates what the confirm box said.
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setErrors({});
    opener.current = null;
    setConfirm(null);
  };

  async function post(at: string, body: object): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/merchant/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d: { error?: string; targeted?: number } = await r.json().catch(() => ({}));
      if (!r.ok) {
        const text =
          SERVER_ERROR[r.status] ??
          d.error?.replace(" in History", " under Sent campaigns") ??
          "Couldn't send the campaign. Check Sent campaigns before trying again.";
        setMsg({ at, kind: "bad", text });
        return false;
      }
      setMsg({ at, kind: "ok", text: `Sent to ${customers(d.targeted ?? 0)}.` });
      return true;
    } catch {
      setMsg({ at, kind: "bad", text: "Couldn't reach the server. Check Sent campaigns before sending again." });
      return false;
    } finally {
      setBusy(false);
      setConfirm(null);
      await load();
    }
  }

  // Step 1: check the form and show what will happen. Nothing is sent yet.
  function review() {
    setMsg(null);
    const e: typeof errors = {};
    if (!name.trim()) e.name = "Give the campaign a name.";
    if (!(bonusPts >= 0) || bonusPts > maxBonus) e.bonus = `Enter a whole number from 0 to ${nf(maxBonus)}.`;
    else if (bonusPts === 0 && !offer.trim()) e.bonus = `Add bonus ${units}, a message on the card, or both.`;
    setErrors(e);
    const bad = e.name ? "c-name" : e.bonus ? "c-bonus" : null;
    if (bad) document.getElementById(bad)?.focus();
    else open(NEW);
  }

  // Step 2: the owner saw the total and said yes.
  async function send() {
    if (busy) return;
    const sent = await post(NEW, {
      id: sendId,
      name: name.trim(),
      segment,
      bonusPoints: bonusPts,
      offerText: offer.trim() || undefined,
    });
    if (sent) {
      setName("");
      setOffer("");
    }
  }

  // What a send will do, in numbers. It must match what the route can send: it
  // caps a campaign at MAX_TARGETS cards and re-reads the group at send time.
  function consequence(k: string, pts: number, offerText: string): ReactNode {
    const n = Math.min(count(k), MAX_TARGETS);
    if (pts === 0) return <>Show “{offerText}” on the Wallet cards of {who(k)}. No {units} are given.</>;
    return (
      <>
        Give <b>{nf(pts)} {u(pts)}</b> to {who(k)} — about <b>{nf(pts * n)} {u(pts * n)} total</b>
        {count(k) > MAX_TARGETS && <> (sent to the first {nf(MAX_TARGETS)})</>}. The group is re-checked when
        you send, so the final count can differ slightly.
        {offerText && <> Their Wallet card also shows “{offerText}”.</>} This can&apos;t be undone.
      </>
    );
  }

  const confirmFor = (slot: string, body: ReactNode, yes: string, onYes: () => void) =>
    confirm === slot && (
      <div ref={confirmBox} className="confirm">
        {body}
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onYes}>
            {busy ? "Sending…" : yes}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      </div>
    );

  const toastAt = (at: string) =>
    msg?.at === at &&
    (msg.kind === "ok" ? (
      <div className="save-status" role="status">
        <div className="toast ok">
          <Icon name="check" />
          {msg.text}
        </div>
      </div>
    ) : (
      <div className="toast bad" role="alert">
        <Icon name="alert" />
        {msg.text}
      </div>
    ));

  return (
    <div className={s.cols}>
      <section className="panel" aria-labelledby="new-campaign">
        <div className={s.head}>
          <h2 className="panel-t" id="new-campaign">New campaign</h2>
          <p className="help">Their Wallet cards update the moment you send.</p>
        </div>
        <form
          className={s.form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            review();
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="c-name">Campaign name</label>
            <input
              id="c-name"
              value={name}
              onChange={edit(setName)}
              placeholder="Win back lapsed"
              maxLength={80}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "c-name-error" : undefined}
            />
            {errors.name && (
              <div className="field-error" id="c-name-error">
                <Icon name="alert" />
                {errors.name}
              </div>
            )}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-who">Who gets it</label>
            <select id="c-who" value={segment} onChange={edit(setSegment)} aria-describedby="c-who-help">
              {SEGMENTS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label} · {customers(count(g.key))}
                </option>
              ))}
            </select>
            <div className="field-help" id="c-who-help">{segmentDefinition(segment)}.</div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-bonus">Bonus {units} each</label>
            <label className="affix">
              <input
                id="c-bonus"
                value={bonus}
                onChange={edit(setBonus)}
                inputMode="numeric"
                aria-label={`Bonus ${units} per customer`}
                aria-invalid={errors.bonus ? true : undefined}
                aria-describedby={[stamps && "c-bonus-help", errors.bonus && "c-bonus-error"].filter(Boolean).join(" ") || undefined}
              />
              <span aria-hidden="true">{u(bonusPts)}</span>
            </label>
            {stamps && (
              <div className="field-help" id="c-bonus-help">
                0 to {nf(stampGoal)}: at most one full card.
              </div>
            )}
            {errors.bonus && (
              <div className="field-error" id="c-bonus-error">
                <Icon name="alert" />
                {errors.bonus}
              </div>
            )}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="c-offer">Message on the card (optional)</label>
            <input
              id="c-offer"
              value={offer}
              onChange={edit(setOffer)}
              placeholder="Free pastry with any coffee this week"
              maxLength={120}
              aria-describedby="c-offer-help"
            />
            <div className="field-help" id="c-offer-help">
              Shown on the back of their Wallet card. Up to 120 characters.
            </div>
          </div>

          <div className={s.foot}>
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={busy || confirm === NEW || targetCount === 0}
              aria-describedby={targetCount === 0 ? "c-empty" : undefined}
            >
              {`Reward ${who(segment)}`}
            </button>
            {targetCount === 0 && (
              <p className="field-help" id="c-empty">No customers in this group yet.</p>
            )}
            {confirmFor(NEW, consequence(segment, bonusPts, offer.trim()), "Yes, send it", send)}
            {toastAt(NEW)}
          </div>
        </form>
      </section>

      <section className={`panel ${s.history}`} aria-labelledby="sent-campaigns" aria-busy={campaigns === null && !loadFailed}>
        <h2 className="panel-t" id="sent-campaigns">Sent campaigns</h2>
        {loadFailed && (
          <div className={`toast bad ${s.loadError}`} role="alert">
            <Icon name="alert" />
            <span>Couldn&apos;t load your campaigns. Check the connection and try again.</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {campaigns === null ? (
          !loadFailed && (
            <div className={s.skel} aria-hidden="true">
              <span className="skel-block" />
              <span className="skel-block" />
              <span className="skel-block" />
            </div>
          )
        ) : campaigns.length === 0 ? (
          <div className="empty">
            <Icon name="megaphone" size={20} />
            <p className="empty-t">No campaigns yet</p>
            <p className="empty-p">
              Your first campaign shows up here{stamps ? "." : ", with how many customers came back."}
            </p>
          </div>
        ) : (
          <div className="tbl" role="table" aria-labelledby="sent-campaigns">
            <div className="tbl-head" role="row">
              <div className="th" role="columnheader">Campaign</div>
              <div className="th" role="columnheader">Audience</div>
              <div className="th num" role="columnheader">Bonus</div>
              <div className="th" role="columnheader">Status</div>
              <div className="th" role="columnheader">
                Result
                {!stamps && (
                  <span className={s.tip}>
                    <button
                      type="button"
                      className={s.tipButton}
                      aria-describedby="came-back"
                      onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
                    >
                      <Icon name="info" size={14} />
                      <span className="sr-only">What counts as coming back</span>
                    </button>
                    <span className={s.tipBody} role="tooltip" id="came-back">
                      Came back = made a purchase within {RESULT_DAYS} days of the campaign.
                    </span>
                  </span>
                )}
              </div>
            </div>
            {campaigns.map((c) => {
              // One count everywhere: the cards the send reached, else the planned count.
              const n = c.lift?.targeted || c.targeted;
              const draft = c.status === "draft";
              const [statusLabel, statusChip] = STATUS[busy && confirm === c.id ? "sending" : c.status] ?? ["Unknown", ""];
              const sent = c.sent_at ? new Date(c.sent_at) : null;
              const resultsOn = sent && new Date(sent.getTime() + RESULT_DAYS * 86_400_000);
              const bonusText = c.bonus_points > 0 ? `+${nf(c.bonus_points)} ${u(c.bonus_points)}` : "Offer only";
              const withOffer = Boolean(c.offer_text) && c.bonus_points > 0;
              // the phone line wraps only after a " · ", never inside "31 customers" or a date
              const meta = [segmentLabel(c.segment), customers(n), sent && day(sent), withOffer && "with offer"]
                .filter((x): x is string => Boolean(x))
                .map((x) => x.replaceAll(" ", "\u00a0"))
                .join("\u00a0· ");
              const note = "Not sent yet — it was interrupted.";
              const result = draft ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy || confirm === c.id}
                  onClick={() => open(c.id)}
                >
                  Finish sending
                </button>
              ) : stamps || !resultsOn ? (
                <span className={s.quiet}>—</span>
              ) : resultsOn.getTime() > Date.now() ? (
                <span className={s.quiet}>Results on {day(resultsOn)}</span>
              ) : c.lift?.targeted ? (
                `${nf(c.lift.earned_after)} of ${nf(c.lift.targeted)} came back`
              ) : (
                <span className={s.quiet}>No result recorded</span>
              );
              return (
                <div key={c.id} className="tbl-row" role="row">
                  <div className="td" role="cell">
                    <div className={s.name} title={c.name}>{c.name}</div>
                    {draft ? <div className={`${s.note} ${s.wrap}`}>{note}</div> : <div className={s.sub}>{sent && day(sent)}</div>}
                  </div>
                  <div className="td" role="cell">
                    <span className="chip" data-seg={c.segment}>{segmentLabel(c.segment)}</span>
                    <div className={s.sub}>{customers(n)}</div>
                  </div>
                  <div className="td num" role="cell">
                    {bonusText}
                    {withOffer && (
                      <div className={s.sub} title={c.offer_text ?? undefined}>with offer</div>
                    )}
                  </div>
                  <div className="td" role="cell">
                    <span className={`chip ${statusChip}`}>{statusLabel}</span>
                  </div>
                  <div className={`td ${s.result}`} role="cell">{result}</div>
                  <div className="td td-name phone-only" role="cell">{c.name}</div>
                  <div className="td td-value phone-only" role="cell">{bonusText}</div>
                  <div className={`td td-meta phone-only ${s.wrap}`} role="cell">
                    {draft ? (
                      note
                    ) : (
                      <>
                        {c.status !== "sent" && <><span className={`chip ${statusChip} ${s.metaChip}`}>{statusLabel}</span>{" "}</>}
                        {meta}
                      </>
                    )}
                  </div>
                  <div className={`td td-date phone-only ${s.result}`} role="cell">{result}</div>
                  {(confirm === c.id || msg?.at === c.id) && (
                    <div className={s.extra} role="cell">
                      {confirmFor(
                        c.id,
                        consequence(c.segment, c.bonus_points, c.offer_text ?? ""),
                        "Yes, finish sending",
                        () => post(c.id, { id: c.id })
                      )}
                      {toastAt(c.id)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
