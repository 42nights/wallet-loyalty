"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EARN_RATE, REDEEM_TEMPLATES, STAMP_REWARD_MAX, describeHappyHour, parseHappyHour, timezoneLabel, unitLabel,
  type HappyHour, type LoyaltyMode, type TemplateKey,
} from "@/lib/config";
import { parseLocation, parseReviewUrl } from "@/lib/admin/merchant";
import Icon from "@/components/Icon";
import styles from "./settings.module.css";

type Settings = {
  merchantName: string;
  template: TemplateKey;
  earnRate: number;
  maxBill: number;
  enrollUrl: string | null;
  mode: LoyaltyMode;
  stampGoal: number;
  stampReward: string;
  timezone: string;
  birthdayReward: boolean;
  birthdayBonus: number;
  birthdayTreat: string; // the reward the birthday bonus pays for
  happyHour: HappyHour | null;
  reviewUrl: string; // "" = none
  location: string; // "lat, lng", "" = none
};
type Patch = Partial<
  Pick<Settings, "template" | "earnRate" | "maxBill" | "stampReward" | "birthdayReward" | "happyHour" | "reviewUrl" | "location">
>;
// One status slot per .fsec row; the rows with a text field show errors under that field instead.
type Sec = "link" | "reward" | "template" | "rate" | "limit" | "hh" | "bday" | "review" | "place";
type FieldSec = "reward" | "rate" | "limit" | "review" | "place";
const FIELD_SECS: readonly Sec[] = ["reward", "rate", "limit", "review", "place"];
// n re-keys the toast, so a second save of the same row shows (and fades) again;
// once a success has faded it clears, so its slot leaves no empty space behind
type Msg = { sec: Sec; kind: "ok" | "bad"; text: string; n: number } | null;
// the happy-hour editor's draft; multiplier 0 = off
type Window = { multiplier: 0 | 2 | 3; days: number[]; start: string; end: string };

const SECTIONS = [
  { id: "signup", label: "Sign-up" },
  { id: "rewards", label: "Rewards" },
  { id: "earning", label: "Earning" },
  { id: "extras", label: "Card extras" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const EXAMPLE_BILL = 20;
const BILL_MIN = 10;
const BILL_MAX = 100_000;
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, like the card's "Mon–Fri"
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OFFLINE = "Couldn't reach the server — nothing was changed. Try again.";
const draftOf = (h: HappyHour | null): Window =>
  h ? { ...h } : { multiplier: 0, days: [1, 2, 3, 4, 5], start: "15:00", end: "17:00" };
const windowOf = (w: Window) =>
  w.multiplier ? { days: [...w.days].sort((a, b) => a - b), start: w.start, end: w.end, multiplier: w.multiplier } : null;
const num = (n: number) => n.toLocaleString("en-US");
// whole dollars unless the amount has cents: $500, $7.50
const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const describedBy = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

function FieldError({ id, text }: { id: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="field-error" id={id}>
      <Icon name="alert" />
      {text}
    </div>
  );
}

function Status({ msg, sec, clear }: { msg: Msg; sec: Sec; clear: (n: number) => void }) {
  const m = msg?.sec === sec ? msg : null;
  return (
    <div className="save-status" role="status" aria-live="polite">
      {m && (
        <div
          key={m.n}
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

function Skeleton() {
  return (
    <>
      {[2, 3, 1].map((rows, i) => (
        <div key={i} className={`panel ${styles.group}`} aria-hidden="true">
          <div className="panel-h">
            <span className={`skel-line ${styles.skelTitle}`} />
          </div>
          {Array.from({ length: rows }, (_, j) => (
            <div key={j} className="fsec">
              <div className={`fsec-intro ${styles.skelIntro}`}>
                <span className="skel-line" />
                <span className="skel-line" />
              </div>
              <div className="fsec-body">
                <span className={`skel-block ${styles.skelField}`} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export default function SettingsForm() {
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rate, setRate] = useState("");
  const [limit, setLimit] = useState("");
  const [reward, setReward] = useState("");
  const [hh, setHh] = useState<Window>(draftOf(null));
  const [review, setReview] = useState("");
  const [place, setPlace] = useState("");
  const [locating, setLocating] = useState(false);
  // one save at a time; the row saving shows "Saving…"
  const [busy, setBusy] = useState<Sec | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [errs, setErrs] = useState<Partial<Record<FieldSec, string>>>({});
  const [current, setCurrent] = useState<SectionId>("signup");
  const endRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoadFailed(false);
    try {
      const res = await fetch("/api/merchant/settings");
      if (res.status === 401) return router.push("/login");
      if (res.status === 403) return router.push("/scan");
      if (!res.ok) throw new Error(String(res.status));
      const data: Settings = await res.json();
      setS(data);
      setRate(String(data.earnRate));
      setLimit(String(data.maxBill));
      setReward(data.stampReward);
      setHh(draftOf(data.happyHour));
      setReview(data.reviewUrl);
      setPlace(data.location);
    } catch {
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The side index marks the first section crossing the top 45% of the
  // viewport; at the very bottom the last section can't get there, so a
  // sentinel after it marks it instead.
  const loaded = s !== null;
  useEffect(() => {
    if (!loaded) return;
    const inBand = new Set<string>();
    let atEnd = false;
    const pick = () => {
      const id = atEnd ? "extras" : SECTIONS.find((x) => inBand.has(x.id))?.id;
      if (id) setCurrent(id);
    };
    const band = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id);
          else inBand.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: "-80px 0px -55% 0px" }
    );
    const end = new IntersectionObserver(([e]) => {
      atEnd = e.isIntersecting && window.scrollY > 0;
      pick();
    });
    for (const x of SECTIONS) {
      const el = document.getElementById(x.id);
      if (el) band.observe(el);
    }
    if (endRef.current) end.observe(endRef.current);
    return () => {
      band.disconnect();
      end.disconnect();
    };
  }, [loaded]);

  const clearMsg = (n: number) => setMsg((x) => (x?.n === n ? null : x));
  const status = (sec: Sec) => <Status msg={msg} sec={sec} clear={clearMsg} />;
  const clearErr = (sec: FieldSec) => setErrs((e) => ({ ...e, [sec]: undefined }));
  function fieldError(sec: FieldSec, text: string) {
    setErrs((e) => ({ ...e, [sec]: text }));
    document.getElementById(`f-${sec}`)?.focus();
  }

  // Saves one row. Returns the saved settings, or null when nothing changed
  // (the row then shows why: under its field, or in its status slot).
  async function save(sec: Sec, patch: Patch, okText: string): Promise<Settings | null> {
    if (busy) return null;
    setBusy(sec);
    setMsg(null);
    try {
      const res = await fetch("/api/merchant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) {
        router.push("/login");
        return null;
      }
      if (res.status === 403) {
        router.push("/scan");
        return null;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const text: string = data.error || "Couldn't save — nothing was changed. Try again.";
        if (FIELD_SECS.includes(sec)) fieldError(sec as FieldSec, text);
        else setMsg({ sec, kind: "bad", text, n: Date.now() });
        return null;
      }
      setS(data);
      setMsg({ sec, kind: "ok", text: okText, n: Date.now() });
      return data;
    } catch {
      setMsg({ sec, kind: "bad", text: OFFLINE, n: Date.now() });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveRate(e: FormEvent) {
    e.preventDefault();
    const d = await save("rate", { earnRate: rateNum }, `Earn rate saved: ${num(rateNum)} pts per $1`);
    if (d) setRate(String(d.earnRate));
  }

  async function saveLimit(e: FormEvent) {
    e.preventDefault();
    const d = await save("limit", { maxBill: limitNum }, `Bill limit saved: ${dollars(limitNum)}`);
    if (d) setLimit(String(d.maxBill));
  }

  async function saveReward(e: FormEvent) {
    e.preventDefault();
    const name = reward.trim();
    const d = await save("reward", { stampReward: name }, `Reward renamed to ${name}. Cards are updating.`);
    if (d) setReward(d.stampReward);
  }

  async function saveHappyHour(e: FormEvent) {
    e.preventDefault();
    const w = windowOf(hh);
    const d = await save(
      "hh",
      { happyHour: w },
      w ? `Happy hour saved: ${describeHappyHour(w)}. Cards are updating.` : "Happy hour is off. Cards are updating."
    );
    if (d) setHh(draftOf(d.happyHour));
  }

  async function saveReview(e: FormEvent) {
    e.preventDefault();
    const r = parseReviewUrl(review);
    if (!r.ok) return fieldError("review", r.error);
    const d = await save(
      "review",
      { reviewUrl: review.trim() },
      r.value ? "Review link saved. Cards update in a few seconds." : "Review link removed"
    );
    if (d) setReview(d.reviewUrl);
  }

  async function savePlace(e: FormEvent) {
    e.preventDefault();
    const r = parseLocation(place);
    if (!r.ok) return fieldError("place", r.error);
    const d = await save("place", { location: place.trim() }, r.value ? "Shop location saved" : "Shop location removed");
    if (d) setPlace(d.location);
  }

  // Fills the field only; the owner checks it and presses Save.
  function locate() {
    clearErr("place");
    if (!navigator.geolocation)
      return fieldError("place", "This browser can't share its location. Paste the numbers from Google Maps instead.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setPlace(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`);
      },
      () => {
        setLocating(false);
        fieldError("place", "Couldn't get this device's location — allow location access, or paste the numbers from Google Maps.");
      },
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  }

  async function copyLink() {
    if (!s?.enrollUrl) return;
    try {
      await navigator.clipboard.writeText(s.enrollUrl);
      setMsg({ sec: "link", kind: "ok", text: "Link copied", n: Date.now() });
    } catch {
      setMsg({ sec: "link", kind: "bad", text: "Couldn't copy — select the link and copy it.", n: Date.now() });
    }
  }

  const rateNum = Number(rate);
  const rateValid = rate.trim() !== "" && rateNum >= EARN_RATE.min && rateNum <= EARN_RATE.max;
  const rateErr = errs.rate ?? (rateValid ? null : `Enter a rate from ${EARN_RATE.min} to ${EARN_RATE.max}.`);
  const limitNum = Number(limit);
  const limitValid = limit.trim() !== "" && limitNum >= BILL_MIN && limitNum <= BILL_MAX;
  const limitErr = errs.limit ?? (limitValid ? null : `Enter a limit from ${dollars(BILL_MIN)} to ${dollars(BILL_MAX)}.`);
  // A stamp card has no bill rules or reward template: those rows are hidden.
  const stamps = s?.mode === "stamps";
  // the route's own check, run here for the inline message; it stays the authority
  const hhCheck = parseHappyHour(windowOf(hh));
  const hhChanged = s !== null && JSON.stringify(windowOf(hh)) !== JSON.stringify(s.happyHour);
  const saveLabel = (sec: Sec, label = "Save") => (busy === sec ? "Saving…" : label);
  // an unchanged row's Save stays quiet; it turns primary once there is something to save
  const saveClass = (changed: boolean) => `btn ${changed ? "btn-primary" : "btn-ghost"}`;

  const index = (
    <nav className={styles.index} aria-label="Settings sections">
      {SECTIONS.map((x) => (
        <a key={x.id} href={`#${x.id}`} aria-current={current === x.id ? "true" : undefined} onClick={() => setCurrent(x.id)}>
          {x.label}
        </a>
      ))}
    </nav>
  );

  if (!s)
    return (
      <div className={styles.layout}>
        {index}
        <div className={styles.content} aria-busy={!loadFailed}>
          {loadFailed ? (
            <div className="panel">
              <div className="toast bad" role="alert">
                <Icon name="alert" />
                Couldn&apos;t load settings — check the connection and try again.
              </div>
              <button className="btn btn-ghost" type="button" onClick={load}>
                Try again
              </button>
            </div>
          ) : (
            <>
              <p className="sr-only">Loading settings…</p>
              <Skeleton />
            </>
          )}
        </div>
      </div>
    );

  return (
    <div className={styles.layout}>
      {index}
      <div className={styles.content}>
        <section id="signup" className={`panel ${styles.group}`} aria-labelledby="signup-h">
          <div className="panel-h">
            <h2 className="panel-t" id="signup-h">Sign-up</h2>
          </div>
          <div className="fsec">
            <div className="fsec-intro">
              <h3>Sign-up link</h3>
              <p className="help">Customers open it to add your card to Apple Wallet. Print it as a QR poster for the counter.</p>
            </div>
            <div className="fsec-body">
              {s.enrollUrl ? (
                <>
                  <a className={`code ${styles.link}`} href={s.enrollUrl} target="_blank" rel="noreferrer">
                    {s.enrollUrl}
                  </a>
                  <div className="fsec-foot">
                    <button className="btn btn-ghost" type="button" onClick={copyLink}>
                      Copy link
                    </button>
                    <Link className="btn btn-primary" href="/settings/poster">
                      Print sign-up poster
                    </Link>
                    {status("link")}
                  </div>
                </>
              ) : (
                <p className={styles.summary}>No public link yet — ask 42nights to set up your sign-up link.</p>
              )}
            </div>
          </div>
        </section>

        <section id="rewards" className={`panel ${styles.group}`} aria-labelledby="rewards-h">
          <div className="panel-h">
            <h2 className="panel-t" id="rewards-h">Rewards</h2>
          </div>
          <div className="fsec">
            <div className="fsec-intro">
              <h3>Your loyalty card</h3>
              <p className="help">
                The card type is set when your shop is created.{" "}
                {stamps
                  ? "The number of stamps stays fixed once customers have stamps."
                  : "Change what a dollar earns under Earning."}
              </p>
            </div>
            {stamps ? (
              <form className="fsec-body" onSubmit={saveReward} noValidate>
                <p className={styles.summary}>
                  Stamp card: <b>{num(s.stampGoal)} stamps</b> earn <b>{s.stampReward}</b>.
                </p>
                <div className="field">
                  <label className="field-label" htmlFor="f-reward">Reward name</label>
                  <input
                    id="f-reward"
                    value={reward}
                    maxLength={STAMP_REWARD_MAX}
                    onChange={(e) => {
                      setReward(e.target.value);
                      clearErr("reward");
                    }}
                    aria-invalid={errs.reward ? true : undefined}
                    aria-describedby={describedBy("h-reward", errs.reward && "e-reward")}
                  />
                  <FieldError id="e-reward" text={errs.reward} />
                  <div className="field-help" id="h-reward">
                    What cashiers tap and customers see on their card. Up to {STAMP_REWARD_MAX} characters.
                  </div>
                </div>
                <div className="fsec-foot">
                  <button
                    className={saveClass(reward.trim() !== s.stampReward)}
                    type="submit"
                    disabled={busy !== null || !reward.trim() || reward.trim() === s.stampReward}
                  >
                    {saveLabel("reward")}
                  </button>
                  {status("reward")}
                </div>
              </form>
            ) : (
              <div className="fsec-body">
                <p className={styles.summary}>
                  Points card: customers earn <b>{num(s.earnRate)} {s.earnRate === 1 ? "point" : "points"}</b> for every $1
                  they spend.
                </p>
              </div>
            )}
          </div>

          {!stamps && (
            <div className="fsec">
              <div className="fsec-intro">
                <h3>Reward buttons</h3>
                <p className="help">The 4 rewards your cashiers see on the Scan screen. Picking a set switches them right away.</p>
              </div>
              <div className="fsec-body">
                <div className={styles.templates}>
                  {(Object.keys(REDEEM_TEMPLATES) as TemplateKey[]).map((key) => {
                    const t = REDEEM_TEMPLATES[key];
                    const current = s.template === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={styles.tpl}
                        aria-pressed={current}
                        onClick={() => !current && save("template", { template: key }, `${t.label} buttons are live on the Scan screen`)}
                      >
                        <span className={styles.tplHead}>
                          <span className={styles.tplName}>{t.label}</span>
                          {current && <span className="chip chip--accent">Current</span>}
                        </span>
                        <span className={styles.tplItems}>
                          {t.actions.map((a) => (
                            <span key={a.id} className={styles.tplItem}>
                              <span>{a.label}</span>
                              <span className={styles.cost}>{num(-a.points)} pts</span>
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {status("template")}
              </div>
            </div>
          )}
        </section>

        <section id="earning" className={`panel ${styles.group}`} aria-labelledby="earning-h">
          <div className="panel-h">
            <h2 className="panel-t" id="earning-h">Earning</h2>
          </div>
          {!stamps && (
            <>
              <div className="fsec">
                <div className="fsec-intro">
                  <h3>
                    <label htmlFor="f-rate">Earn rate</label>
                  </h3>
                  <p className="help" id="h-rate">
                    Points a customer gets for every $1 they spend, from {EARN_RATE.min} to {EARN_RATE.max}.
                  </p>
                </div>
                <form className="fsec-body" onSubmit={saveRate} noValidate>
                  <div className="field">
                    <label className="affix">
                      <input
                        id="f-rate"
                        inputMode="decimal"
                        autoComplete="off"
                        value={rate}
                        onChange={(e) => {
                          setRate(e.target.value);
                          clearErr("rate");
                        }}
                        aria-invalid={rateErr ? true : undefined}
                        aria-describedby={describedBy("h-rate", rateErr ? "e-rate" : "x-rate")}
                      />
                      <span>pts per $1</span>
                    </label>
                    {rateErr ? (
                      <FieldError id="e-rate" text={rateErr} />
                    ) : (
                      <div className="field-help" id="x-rate" aria-live="polite">
                        A {dollars(EXAMPLE_BILL)} bill earns {num(Math.round(rateNum * EXAMPLE_BILL))} points.
                      </div>
                    )}
                  </div>
                  <div className="fsec-foot">
                    <button className={saveClass(rateNum !== s.earnRate)} type="submit" disabled={busy !== null || !rateValid || rateNum === s.earnRate}>
                      {saveLabel("rate")}
                    </button>
                    {status("rate")}
                  </div>
                </form>
              </div>

              <div className="fsec">
                <div className="fsec-intro">
                  <h3>
                    <label htmlFor="f-limit">Bill limit</label>
                  </h3>
                  <p className="help" id="h-limit">
                    The biggest bill a cashier can add points for, from {dollars(BILL_MIN)} to {dollars(BILL_MAX)}.
                  </p>
                </div>
                <form className="fsec-body" onSubmit={saveLimit} noValidate>
                  <div className="field">
                    <label className="affix">
                      <span>$</span>
                      <input
                        id="f-limit"
                        inputMode="decimal"
                        autoComplete="off"
                        value={limit}
                        onChange={(e) => {
                          setLimit(e.target.value);
                          clearErr("limit");
                        }}
                        aria-invalid={limitErr ? true : undefined}
                        aria-describedby={describedBy("h-limit", limitErr ? "e-limit" : "x-limit")}
                      />
                    </label>
                    {limitErr ? (
                      <FieldError id="e-limit" text={limitErr} />
                    ) : (
                      <div className="field-help" id="x-limit" aria-live="polite">
                        Bills of {dollars(limitNum / 2)} or more ask the cashier to double-check. The largest earns{" "}
                        {num(Math.round(limitNum * s.earnRate))} points.
                      </div>
                    )}
                  </div>
                  <div className="fsec-foot">
                    <button className={saveClass(limitNum !== s.maxBill)} type="submit" disabled={busy !== null || !limitValid || limitNum === s.maxBill}>
                      {saveLabel("limit")}
                    </button>
                    {status("limit")}
                  </div>
                </form>
              </div>

              <div className="fsec">
                <div className="fsec-intro">
                  <h3>Happy hour</h3>
                  <p className="help">
                    Bills added in this weekly window earn extra points, and every card shows it. It runs on your shop&apos;s
                    clock: {timezoneLabel(s.timezone)}.
                  </p>
                </div>
                <form className="fsec-body" onSubmit={saveHappyHour} noValidate>
                  <div className={`segmented ${styles.seg}`} role="group" aria-label="Happy hour points">
                    {([[0, "Off"], [2, "2× points"], [3, "3× points"]] as const).map(([m, text]) => (
                      <button key={m} type="button" aria-pressed={hh.multiplier === m} onClick={() => setHh({ ...hh, multiplier: m })}>
                        {text}
                      </button>
                    ))}
                  </div>
                  {hh.multiplier > 0 && (
                    <>
                      <fieldset className={styles.days}>
                        <legend className="field-label">Days</legend>
                        {DAY_ORDER.map((d) => (
                          <label key={d} className={styles.day}>
                            <input
                              type="checkbox"
                              checked={hh.days.includes(d)}
                              onChange={(e) =>
                                setHh({ ...hh, days: e.target.checked ? [...hh.days, d] : hh.days.filter((x) => x !== d) })
                              }
                            />
                            {DAY_NAMES[d]}
                          </label>
                        ))}
                      </fieldset>
                      <div className={styles.times}>
                        <div className="field">
                          <label className="field-label" htmlFor="hh-from">From</label>
                          <input id="hh-from" type="time" value={hh.start} onChange={(e) => setHh({ ...hh, start: e.target.value })} />
                        </div>
                        <div className="field">
                          <label className="field-label" htmlFor="hh-until">Until</label>
                          <input id="hh-until" type="time" value={hh.end} onChange={(e) => setHh({ ...hh, end: e.target.value })} />
                        </div>
                      </div>
                    </>
                  )}
                  {typeof hhCheck === "string" ? (
                    <FieldError id="e-hh" text={hhCheck} />
                  ) : (
                    <div className={styles.preview} aria-live="polite">
                      {hhCheck ? (
                        <>
                          Cards will say <b>{describeHappyHour(hhCheck)}</b>
                        </>
                      ) : (
                        "No happy hour: every bill earns the normal rate."
                      )}
                    </div>
                  )}
                  <div className="fsec-foot">
                    <button className={saveClass(hhChanged)} type="submit" disabled={busy !== null || typeof hhCheck === "string" || !hhChanged}>
                      {saveLabel("hh", "Save happy hour")}
                    </button>
                    {status("hh")}
                  </div>
                </form>
              </div>
            </>
          )}

          <div className="fsec">
            <div className="fsec-intro">
              <h3>Birthday treat</h3>
              <p className="help">
                Customers can add their birthday when they join. Around it, cards over a month old get{" "}
                {num(s.birthdayBonus)} bonus {unitLabel(s.mode, s.birthdayBonus)}
                {stamps ? `, a full card (${s.birthdayTreat})` : `, the price of ${s.birthdayTreat}`}.
              </p>
            </div>
            <div className="fsec-body">
              <label className={styles.toggle}>
                <span>Give customers a birthday treat</span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={busy === "bday" ? !s.birthdayReward : s.birthdayReward}
                  onChange={(e) =>
                    save(
                      "bday",
                      { birthdayReward: e.target.checked },
                      e.target.checked
                        ? "Birthday treat is on. New customers can add their birthday when they join."
                        : "Birthday treat is off"
                    )
                  }
                />
                <span className="switch" aria-hidden="true" />
              </label>
              {status("bday")}
            </div>
          </div>
        </section>

        <section id="extras" className={`panel ${styles.group}`} aria-labelledby="extras-h">
          <div className="panel-h">
            <h2 className="panel-t" id="extras-h">Card extras</h2>
          </div>
          <div className="fsec">
            <div className="fsec-intro">
              <h3>
                <label htmlFor="f-review">Review link</label>
              </h3>
              <p className="help" id="h-review">
                From a customer&apos;s 3rd visit, the back of their card asks them to review {s.merchantName} at this link. Leave it
                empty for none.
              </p>
            </div>
            <form className="fsec-body" onSubmit={saveReview} noValidate>
              <div className="field">
                <input
                  id="f-review"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  maxLength={500}
                  placeholder="https://g.page/…"
                  value={review}
                  onChange={(e) => {
                    setReview(e.target.value);
                    clearErr("review");
                  }}
                  aria-invalid={errs.review ? true : undefined}
                  aria-describedby={describedBy("h-review", errs.review && "e-review")}
                />
                <FieldError id="e-review" text={errs.review} />
              </div>
              <div className="fsec-foot">
                <button className={saveClass(review.trim() !== s.reviewUrl)} type="submit" disabled={busy !== null || review.trim() === s.reviewUrl}>
                  {saveLabel("review")}
                </button>
                {status("review")}
              </div>
            </form>
          </div>

          <div className="fsec">
            <div className="fsec-intro">
              <h3>Shop location</h3>
              <p className="help" id="h-place">
                Near your shop, iPhones can show the card on the Lock Screen. Stand in your shop and tap Use this device&apos;s
                location, or paste from Google Maps.
              </p>
            </div>
            <form className="fsec-body" onSubmit={savePlace} noValidate>
              <div className="field">
                <label className="field-label" htmlFor="f-place">Latitude, longitude</label>
                <div className={styles.locRow}>
                  <input
                    id="f-place"
                    autoComplete="off"
                    placeholder="37.7749, -122.4194"
                    value={place}
                    onChange={(e) => {
                      setPlace(e.target.value);
                      clearErr("place");
                    }}
                    aria-invalid={errs.place ? true : undefined}
                    aria-describedby={describedBy("h-place", errs.place && "e-place")}
                  />
                  <button className="btn btn-ghost" type="button" onClick={locate} disabled={locating}>
                    {locating ? "Finding location…" : "Use this device's location"}
                  </button>
                </div>
                <FieldError id="e-place" text={errs.place} />
              </div>
              <div className="fsec-foot">
                <button className={saveClass(place.trim() !== s.location)} type="submit" disabled={busy !== null || place.trim() === s.location}>
                  {saveLabel("place")}
                </button>
                {status("place")}
              </div>
            </form>
          </div>
        </section>
        <div ref={endRef} />
      </div>
    </div>
  );
}
