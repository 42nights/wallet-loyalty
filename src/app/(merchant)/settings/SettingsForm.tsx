"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EARN_RATE, REDEEM_TEMPLATES, STAMP_REWARD_MAX, type LoyaltyMode, type TemplateKey } from "@/lib/config";
import { formatMoney } from "@/lib/format";
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
};
type Msg = { kind: "ok" | "bad"; text: string } | null;

const EXAMPLE_BILL = 20;

export default function SettingsForm() {
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [rate, setRate] = useState("");
  const [limit, setLimit] = useState("");
  const [reward, setReward] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [linkMsg, setLinkMsg] = useState<Msg>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/merchant/settings");
      if (res.status === 401) return router.push("/login");
      if (res.status === 403) return router.push("/scan");
      if (!res.ok) return setMsg({ kind: "bad", text: "Could not load settings" });
      const data: Settings = await res.json();
      setS(data);
      setRate(String(data.earnRate));
      setLimit(String(data.maxBill));
      setReward(data.stampReward);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Partial<Pick<Settings, "template" | "earnRate" | "maxBill" | "stampReward">>, okText: string) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/merchant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 403) return router.push("/scan");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ kind: "bad", text: data.error || "Could not save" });
      setS(data);
      setRate(String(data.earnRate));
      setLimit(String(data.maxBill));
      setReward(data.stampReward);
      setMsg({ kind: "ok", text: okText });
    } finally {
      setBusy(false);
    }
  }

  function saveRate(e: FormEvent) {
    e.preventDefault();
    save({ earnRate: Number(rate) }, `Earn rate saved: ${Number(rate)} pts per ${formatMoney(1)}`);
  }

  function saveLimit(e: FormEvent) {
    e.preventDefault();
    save({ maxBill: Number(limit) }, `Bill limit saved: ${formatMoney(Number(limit))}`);
  }

  function saveReward(e: FormEvent) {
    e.preventDefault();
    save({ stampReward: reward.trim() }, `Reward renamed to ${reward.trim()}. Customers' cards update in Wallet.`);
  }

  async function copyLink() {
    if (!s?.enrollUrl) return;
    await navigator.clipboard.writeText(s.enrollUrl).then(
      () => setLinkMsg({ kind: "ok", text: "Link copied" }),
      () => setLinkMsg({ kind: "bad", text: "Could not copy — select the link and copy it" })
    );
  }

  const rateNum = Number(rate);
  const rateValid = rate.trim() !== "" && rateNum >= EARN_RATE.min && rateNum <= EARN_RATE.max;
  const limitNum = Number(limit);
  const limitValid = limit.trim() !== "" && limitNum >= 10 && limitNum <= 100000;
  // A stamp card has no bill rules or reward template: those sections are hidden.
  const stamps = s?.mode === "stamps";

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>settings</small>
      </div>
      {!s ? (
        <div className="card">
          {msg ? <div className={`toast ${msg.kind}`}>{msg.text}</div> : <div className="label">Loading…</div>}
        </div>
      ) : (
        <div className="stack">
          {msg && <div className={`toast ${msg.kind}`} role="status" style={{ marginTop: 0 }}>{msg.text}</div>}

          <section className="card stack" aria-labelledby="mode-h">
            <div>
              <div className="label" id="mode-h">Loyalty card</div>
              <div className={styles.example}>
                {stamps ? (
                  <>Stamp card: <b>{s.stampGoal}</b> stamps earn <b>{s.stampReward}</b></>
                ) : (
                  <>Points: customers earn points on every {formatMoney(1)} they spend</>
                )}
              </div>
              <div className={styles.help}>
                Set up by 42nights.{" "}
                {stamps
                  ? "The number of stamps stays fixed once customers have stamps, so every card keeps its value. You can rename the reward."
                  : "The earn rate and rewards are below."}
              </div>
            </div>
            {stamps && (
              <>
                <form className="row" onSubmit={saveReward}>
                  <input value={reward} onChange={(e) => setReward(e.target.value)} maxLength={STAMP_REWARD_MAX} aria-label="Reward name" />
                  <button
                    className="btn btn-primary"
                    style={{ width: "auto", padding: "0 20px" }}
                    type="submit"
                    disabled={busy || !reward.trim() || reward.trim() === s.stampReward}
                  >
                    Save
                  </button>
                </form>
                <div className={styles.help}>
                  What cashiers tap and customers see on their card, up to {STAMP_REWARD_MAX} characters. Saving updates every card in Wallet.
                </div>
              </>
            )}
          </section>

          <section className="card stack" aria-labelledby="tpl-h" hidden={stamps}>
            <div>
              <div className="label" id="tpl-h">Redeem buttons</div>
              <div className={styles.help}>
                The 4 rewards your cashiers see on /scan. Switching changes them right away.
              </div>
            </div>
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
                    disabled={busy}
                    onClick={() => !current && save({ template: key }, `${t.label} buttons are live on /scan`)}
                  >
                    <span className={styles.tplHead}>
                      <span className={styles.tplName}>{t.label}</span>
                      {current && <span className={styles.badge}>Current</span>}
                    </span>
                    <span className={styles.tplItems}>
                      {t.actions.map((a) => (
                        <span key={a.id} className={styles.tplItem}>
                          <span>{a.label}</span>
                          <span className={styles.cost}>{-a.points} pts</span>
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card stack" aria-labelledby="rate-h" hidden={stamps}>
            <div>
              <div className="label" id="rate-h">Earn rate</div>
              <div className={styles.help}>Points per {formatMoney(1)} spent ({EARN_RATE.min} – {EARN_RATE.max}).</div>
            </div>
            <form className="row" onSubmit={saveRate}>
              <input
                type="number"
                inputMode="decimal"
                min={EARN_RATE.min}
                max={EARN_RATE.max}
                step="any"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                aria-label={`Points per ${formatMoney(1)} spent`}
              />
              <button
                className="btn btn-primary"
                style={{ width: "auto", padding: "0 20px" }}
                type="submit"
                disabled={busy || !rateValid || rateNum === s.earnRate}
              >
                Save
              </button>
            </form>
            <div className={styles.example} aria-live="polite">
              {rateValid ? (
                <>A {formatMoney(EXAMPLE_BILL)} bill earns <b>{Math.round(rateNum * EXAMPLE_BILL)}</b> points</>
              ) : (
                <span style={{ color: "var(--bad)" }}>Enter a rate between {EARN_RATE.min} and {EARN_RATE.max}</span>
              )}
            </div>
          </section>

          <section className="card stack" aria-labelledby="limit-h" hidden={stamps}>
            <div>
              <div className="label" id="limit-h">Bill limit</div>
              <div className={styles.help}>
                The largest bill a cashier can add points for ({formatMoney(10)} – {formatMoney(100000)}). Bigger bills are refused, and
                bills of half the limit or more ask the cashier to confirm first.
              </div>
            </div>
            <form className="row" onSubmit={saveLimit}>
              <input
                type="number"
                inputMode="decimal"
                min={10}
                max={100000}
                step="any"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                aria-label="Largest bill"
              />
              <button
                className="btn btn-primary"
                style={{ width: "auto", padding: "0 20px" }}
                type="submit"
                disabled={busy || !limitValid || limitNum === s.maxBill}
              >
                Save
              </button>
            </form>
            <div className={styles.example} aria-live="polite">
              {limitValid ? (
                <>Bills from <b>{formatMoney(limitNum / 2)}</b> need a confirm; the largest earns <b>{Math.round(limitNum * s.earnRate)}</b> points</>
              ) : (
                <span style={{ color: "var(--bad)" }}>Enter a limit between {formatMoney(10)} and {formatMoney(100000)}</span>
              )}
            </div>
          </section>

          <section className="card stack" aria-labelledby="link-h">
            <div>
              <div className="label" id="link-h">Customer sign-up link</div>
              <div className={styles.help}>
                Print it as a QR at the counter or share it — customers add your card to Apple Wallet from it.
              </div>
            </div>
            {s.enrollUrl ? (
              <>
                <a className={styles.link} href={s.enrollUrl} target="_blank" rel="noreferrer">
                  {s.enrollUrl}
                </a>
                <button className="btn btn-ghost" type="button" onClick={copyLink}>Copy link</button>
                {linkMsg && <div className={`toast ${linkMsg.kind}`} role="status">{linkMsg.text}</div>}
              </>
            ) : (
              <div className="label">No public link yet — ask 42nights to set your sign-up slug.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
