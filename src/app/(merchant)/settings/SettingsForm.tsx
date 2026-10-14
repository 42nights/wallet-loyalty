"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { REDEEM_TEMPLATES, type TemplateKey } from "@/lib/config";
import styles from "./settings.module.css";

type Settings = {
  merchantName: string;
  template: TemplateKey;
  earnRate: number;
  enrollUrl: string | null;
};
type Msg = { kind: "ok" | "bad"; text: string } | null;

const EXAMPLE_BILL = 20;

export default function SettingsForm() {
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [rate, setRate] = useState("");
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
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Partial<Pick<Settings, "template" | "earnRate">>, okText: string) {
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
      setMsg({ kind: "ok", text: okText });
    } finally {
      setBusy(false);
    }
  }

  function saveRate(e: FormEvent) {
    e.preventDefault();
    save({ earnRate: Number(rate) }, `Earn rate saved: ${Number(rate)} pts per 1.00`);
  }

  async function copyLink() {
    if (!s?.enrollUrl) return;
    await navigator.clipboard.writeText(s.enrollUrl).then(
      () => setLinkMsg({ kind: "ok", text: "Link copied" }),
      () => setLinkMsg({ kind: "bad", text: "Could not copy — select the link and copy it" })
    );
  }

  const rateNum = Number(rate);
  const rateValid = rate.trim() !== "" && rateNum >= 0.1 && rateNum <= 100;

  return (
    <div className="wrap">
      <div className="brand">
        <span className="dot" /> 42nights <small>settings</small>
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        <Link className="btn btn-ghost" href="/scan">Scan</Link>
        <Link className="btn btn-ghost" href="/dashboard">Dashboard</Link>
        <Link className="btn btn-ghost" href="/staff">Staff</Link>
      </div>

      {!s ? (
        <div className="card">
          {msg ? <div className={`toast ${msg.kind}`}>{msg.text}</div> : <div className="label">Loading…</div>}
        </div>
      ) : (
        <div className="stack">
          {msg && <div className={`toast ${msg.kind}`} role="status" style={{ marginTop: 0 }}>{msg.text}</div>}

          <section className="card stack" aria-labelledby="tpl-h">
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

          <section className="card stack" aria-labelledby="rate-h">
            <div>
              <div className="label" id="rate-h">Earn rate</div>
              <div className={styles.help}>Points per 1.00 spent (0.1 – 100).</div>
            </div>
            <form className="row" onSubmit={saveRate}>
              <input
                type="number"
                inputMode="decimal"
                min={0.1}
                max={100}
                step="any"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                aria-label="Points per 1.00 spent"
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
                <>A {EXAMPLE_BILL.toFixed(2)} bill earns <b>{Math.round(rateNum * EXAMPLE_BILL)}</b> points</>
              ) : (
                <span style={{ color: "var(--bad)" }}>Enter a rate between 0.1 and 100</span>
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
