"use client";
import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import QRCode from "qrcode";
import { NAME_MAX, validateEnroll, type FieldErrors } from "@/app/api/enroll/validate";
import s from "./EnrollForm.module.css";

// Browsers that can add a .pkpass straight to Wallet: every browser on iPhone
// and iPad (all WebKit; Wallet takes the download), and Safari on the Mac.
// iPadOS Safari reports a Mac user agent by default, which the Safari branch
// covers. Everything else gets a QR to scan with an iPhone instead.
function canAddToWallet(ua: string): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
}

type Done = { cardUrl: string; qr: string | null }; // qr is set off Apple devices

export default function EnrollForm({
  slug,
  merchantName,
}: {
  slug: string;
  merchantName: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  function showErrors(next: FieldErrors) {
    setErrors(next);
    const first = (["name", "phone", "email"] as const).find((k) => next[k]);
    if (first) document.getElementById(`enroll-${first}`)?.focus();
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    const check = validateEnroll({ name, phone, email });
    if (!check.ok) return showErrors(check.errors);
    setErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, consent, slug }),
      });
      const data: { cardUrl?: string; error?: string; fields?: FieldErrors } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !data.cardUrl) {
        if (data.fields) return showErrors(data.fields);
        return setNotice(data.error || "Something went wrong. Please try again.");
      }
      const { cardUrl } = data;
      if (canAddToWallet(navigator.userAgent)) {
        // A normal GET of the signed link: the response is the .pkpass, so the
        // Wallet sheet opens over this page and the success screen stays behind it.
        window.location.href = cardUrl;
        setDone({ cardUrl, qr: null });
      } else {
        setDone({ cardUrl, qr: await QRCode.toDataURL(cardUrl, { margin: 2, width: 480 }) });
      }
    } catch {
      setNotice("Could not reach the shop's server. Check your connection and try again.");
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
            Tap <b>Add</b> in the Wallet sheet to save your {merchantName} card. Your points
            update on it automatically.
          </p>
          <a className={`btn btn-primary ${s.linkBtn}`} href={done.cardUrl}>
            Open my card again
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
          <div className={s.title}>You&rsquo;re in! Now add it on your iPhone</div>
          {/* Apple's suggested wording for a page opened on another device. */}
          <p className={s.lead}>
            To add this card to Wallet, open this web page on your iPhone or iPod touch.
          </p>
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
          <div className="toast bad" role="alert">
            {notice}
          </div>
        )}
        {/*
          APPLE WALLET BADGE SLOT (apple-wallet#8). Apple: "Be sure to use the
          badges provided by Apple. Do not create your own versions." So this
          stays a neutral text button until the real badge is in place.
          Human step for Ayaan: download the official "Add to Apple Wallet" SVG
          from https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/
          after accepting the Apple Wallet Marketing Artwork License Agreement,
          save it under public/, and render it inside this button in place of
          the text, with clear space of at least 0.1x the badge height on every
          side. Do not redraw, recolour or restyle it.
        */}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Creating your card…" : "Get my card"}
        </button>
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
