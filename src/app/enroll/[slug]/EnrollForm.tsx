"use client";
import { useState, useSyncExternalStore, type FormEvent, type InputHTMLAttributes } from "react";
import QRCode from "qrcode";
import { NAME_MAX, validateEnroll, type FieldErrors } from "@/app/api/enroll/validate";
import s from "./EnrollForm.module.css";

// Browsers that can add a .pkpass straight to Wallet: every browser on iPhone
// and iPad (all WebKit; Wallet takes the download), and Safari on the Mac.
// iPadOS Safari reports a Mac user agent by default, which the Safari branch
// covers. Everything else gets a QR to scan with an iPhone instead.
function canAddToWallet(ua: string): boolean {
  if (inAppBrowser(ua)) return false;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
}

// Links opened inside Instagram, Facebook, TikTok, Snapchat… load in the app's
// own web view, which cannot show the Wallet sheet — a .pkpass there goes
// nowhere. Those visitors get the card link to open in Safari instead.
function inAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly|Snapchat|Twitter/i.test(ua);
}

const noSubscribe = () => () => {};

// Apple's own artwork, unaltered (Add to Apple Wallet guidelines). Only shown
// where tapping it really opens Wallet.
const walletBadge = <img className={s.badge} src="/add-to-apple-wallet.svg" width={152} height={48} alt="Add to Apple Wallet" />;

// qr is set off Apple devices; inApp = an iPhone stuck in an app's web view
type Done = { cardUrl: string; qr: string | null; inApp: boolean };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");

// unit: what the card counts, "points" or "stamps"
// askBirthday: the shop has the birthday treat on, so the form offers the
// optional month + day pickers (sent as "MM-DD"; no year is ever asked).
export default function EnrollForm({
  slug,
  merchantName,
  unit,
  askBirthday = false,
}: {
  slug: string;
  merchantName: string;
  unit: string;
  askBirthday?: boolean;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bMonth, setBMonth] = useState("");
  const [bDay, setBDay] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  // "info" = already enrolled (not the customer's fault), "bad" = a real failure.
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "bad" } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const wallet = useSyncExternalStore(noSubscribe, () => canAddToWallet(navigator.userAgent), () => false);

  function showErrors(next: FieldErrors) {
    setErrors(next);
    const first = (["name", "phone", "email", "birthday"] as const).find((k) => next[k]);
    if (first) document.getElementById(`enroll-${first}`)?.focus();
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    // one picker set without the other is sent as-is ("03-") so it gets an error
    const birthday = askBirthday && (bMonth || bDay) ? `${bMonth}-${bDay}` : "";
    const check = validateEnroll({ name, phone, email, birthday });
    if (!check.ok) return showErrors(check.errors);
    setErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, birthday, consent, slug }),
      });
      const data: { cardUrl?: string; error?: string; fields?: FieldErrors } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !data.cardUrl) {
        if (data.fields) return showErrors(data.fields);
        return setNotice({
          text: data.error || "Something went wrong. Please try again.",
          tone: res.status === 409 ? "info" : "bad",
        });
      }
      const { cardUrl } = data;
      if (canAddToWallet(navigator.userAgent)) {
        // A normal GET of the signed link: the response is the .pkpass, so the
        // Wallet sheet opens over this page and the success screen stays behind it.
        window.location.href = cardUrl;
        setDone({ cardUrl, qr: null, inApp: false });
      } else {
        // SVG stays crisp at any size; level L keeps the long signed link to
        // fewer, larger modules (a screen is a clean surface to scan from).
        const svg = await QRCode.toString(cardUrl, { type: "svg", margin: 2, errorCorrectionLevel: "L" });
        setDone({
          cardUrl,
          qr: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
          inApp: inAppBrowser(navigator.userAgent),
        });
      }
    } catch {
      setNotice({
        text: "Could not reach the shop's server. Check your connection and try again.",
        tone: "bad",
      });
    } finally {
      setBusy(false);
    }
  }

  const brand = (
    <div className="brand">
      <span className="dot" /> {merchantName} <small>join</small>
    </div>
  );

  if (done && !done.qr)
    return (
      <div className="wrap">
        {brand}
        <div className="card stack" role="status">
          <div className={s.title}>Your card is ready</div>
          <p className={s.lead}>
            Tap <b>Add</b> in the Wallet sheet to save your {merchantName} card.
            Your {unit} update on it automatically.
          </p>
          <a className={s.badgeBtn} href={done.cardUrl}>
            {walletBadge}
          </a>
          <p className={s.hint}>
            No Wallet sheet? Open this page in Safari. The link works for 1 hour; after that,
            ask staff to re-send your card.
          </p>
        </div>
      </div>
    );

  if (done?.qr)
    return (
      <div className="wrap">
        {brand}
        <div className="card stack" role="status">
          {done.inApp ? (
            <>
              <div className={s.title}>You&rsquo;re in! Open your card in Safari</div>
              <p className={s.lead}>
                This app&rsquo;s browser can&rsquo;t add cards to Wallet. Tap <b>•••</b> and choose{" "}
                <b>Open in browser</b>, or copy your card link and paste it into Safari.
              </p>
              <button
                type="button"
                className={`btn btn-primary ${s.linkBtn}`}
                onClick={() => navigator.clipboard?.writeText(done.cardUrl).then(() => setCopied(true), () => {})}
              >
                {copied ? "Link copied" : "Copy my card link"}
              </button>
            </>
          ) : (
            <>
              <div className={s.title}>You&rsquo;re in! Now add it on your iPhone</div>
              {/* Apple's suggested wording for a page opened on another device. */}
              <p className={s.lead}>
                To add this card to Wallet, open this web page on your iPhone or iPod touch.
              </p>
            </>
          )}
          <img
            className={s.qr}
            src={done.qr}
            width={240}
            height={240}
            alt="QR code that opens your card in Apple Wallet on an iPhone"
          />
          <p className={s.hint}>
            Point your iPhone camera at the code and tap the link. The code works for 1 hour;
            after that, ask staff to re-send your card.
          </p>
        </div>
      </div>
    );

  return (
    <div className="wrap">
      {brand}
      <form className="card stack" onSubmit={join} noValidate>
        <div className="label">Get your loyalty card in Apple Wallet</div>
        <Field
          id="enroll-name"
          label="Name"
          error={errors.name}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((x) => ({ ...x, name: undefined }));
          }}
          autoComplete="name"
          maxLength={NAME_MAX}
          required
        />
        <Field
          id="enroll-phone"
          label="Phone"
          error={errors.phone}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setErrors((x) => ({ ...x, phone: undefined }));
          }}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
        />
        <Field
          id="enroll-email"
          label="Email (optional)"
          error={errors.email}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((x) => ({ ...x, email: undefined }));
          }}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
        />
        {askBirthday && (
          <div className={s.field}>
            <fieldset className={s.birthday} aria-describedby="enroll-birthday-why">
              <legend className="label">Birthday (month and day, optional)</legend>
              <select
                id="enroll-birthday"
                aria-label="Month"
                aria-invalid={errors.birthday ? true : undefined}
                aria-describedby={errors.birthday ? "enroll-birthday-error" : undefined}
                value={bMonth}
                onChange={(e) => {
                  setBMonth(e.target.value);
                  setErrors((x) => ({ ...x, birthday: undefined }));
                }}
              >
                <option value="">Month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={pad(i + 1)}>{m}</option>
                ))}
              </select>
              <select
                aria-label="Day"
                aria-invalid={errors.birthday ? true : undefined}
                aria-describedby={errors.birthday ? "enroll-birthday-error" : undefined}
                value={bDay}
                onChange={(e) => {
                  setBDay(e.target.value);
                  setErrors((x) => ({ ...x, birthday: undefined }));
                }}
              >
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i} value={pad(i + 1)}>{i + 1}</option>
                ))}
              </select>
            </fieldset>
            <div id="enroll-birthday-why" className={s.hint}>
              {merchantName} adds a birthday treat to your card around your birthday, once the card is a month old. No year
              needed.
            </div>
            {errors.birthday && (
              <div id="enroll-birthday-error" className={s.error}>
                {errors.birthday}
              </div>
            )}
          </div>
        )}
        <label className="row" style={{ gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{ width: "auto" }}
          />
          <span className="label" style={{ margin: 0 }}>
            Text/email me offers from {merchantName}
          </span>
        </label>
        {notice && (
          <div
            className={notice.tone === "bad" ? "toast bad" : `toast ${s.info}`}
            role={notice.tone === "bad" ? "alert" : "status"}
          >
            {notice.text}
          </div>
        )}
        {wallet && !busy ? (
          <button type="submit" className={s.badgeBtn}>
            {walletBadge}
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Creating your card…" : "Get my card"}
          </button>
        )}
        <div className={s.hint}>
          On iPhone your card opens in Wallet. On other devices you will get a code to scan
          with your iPhone.
        </div>
      </form>
    </div>
  );
}

// A labelled input with its inline error. Keeps the `.label` + sibling <input>
// shape the e2e helper keys on.
function Field({
  id,
  label,
  error,
  ...input
}: { id: string; label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={s.field}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...input}
      />
      {error && (
        <div id={`${id}-error`} className={s.error}>
          {error}
        </div>
      )}
    </div>
  );
}
