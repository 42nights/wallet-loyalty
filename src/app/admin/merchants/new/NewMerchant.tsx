"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_TEMPLATE, EARN_RATE, type TemplateKey } from "@/lib/config";
import {
  DEFAULT_COLORS, MIN_PASSWORD, SLUG_RE, generatePassword, hexToRgb, rgbToHex, slugify,
} from "@/lib/admin/merchant";
import { ColorFields, EarnHint, TemplatePicker, WalletPreview, type Colors } from "../../fields";
import s from "../../admin.module.css";

type SlugState = "empty" | "invalid" | "checking" | "free" | "taken";
type Created = {
  id: string;
  name: string;
  enrollUrl: string;
  loginUrl: string;
  logins: { role: string; username: string; password: string }[];
};

const SLUG_HINT: Record<SlugState, [string, string]> = {
  empty: ["", "Type a business name first"],
  invalid: [s.bad, "Lowercase letters, digits and dashes only"],
  checking: ["", "Checking…"],
  free: [s.ok, "✓ Available"],
  taken: [s.bad, "Taken, pick another"],
};

// Onboarding: one screen, four numbered sections, live card preview. Derived
// fields (link name, usernames) follow the business name until edited by hand;
// `null` in state means "still derived".
export default function NewMerchant() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slugEdit, setSlugEdit] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateKey>(DEFAULT_TEMPLATE);
  const [earnRate, setEarnRate] = useState("10");
  const [colors, setColors] = useState<Colors>({
    bg: rgbToHex(DEFAULT_COLORS.bgColor, "#ffffff"),
    fg: rgbToHex(DEFAULT_COLORS.fgColor, "#141414"),
    label: rgbToHex(DEFAULT_COLORS.labelColor, "#787878"),
  });
  const [ownerEdit, setOwnerEdit] = useState<string | null>(null);
  const [ownerPw, setOwnerPw] = useState("");
  const [withCashier, setWithCashier] = useState(true);
  const [cashierEdit, setCashierEdit] = useState<string | null>(null);
  const [cashierPw, setCashierPw] = useState("");
  const [slugState, setSlugState] = useState<SlugState>("empty");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  const slug = slugEdit ?? slugify(name);
  const ownerUser = ownerEdit ?? (slug ? `${slug}-owner` : "");
  const cashierUser = cashierEdit ?? (slug ? `${slug}-cashier` : "");

  // Generated client-side after mount so server and client markup match.
  useEffect(() => {
    setOwnerPw(generatePassword());
    setCashierPw(generatePassword());
  }, []);

  // Debounced availability check; `live` drops answers for a stale slug.
  useEffect(() => {
    if (!slug) return setSlugState("empty");
    if (!SLUG_RE.test(slug)) return setSlugState("invalid");
    setSlugState("checking");
    let live = true;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/merchants?slug=${encodeURIComponent(slug)}`);
      if (res.status === 401) return router.push("/admin/login");
      const data = await res.json().catch(() => ({}));
      if (live) setSlugState(data.available ? "free" : "taken");
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [slug, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    const logins = [{ role: "owner", username: ownerUser, password: ownerPw }];
    if (withCashier) logins.push({ role: "cashier", username: cashierUser, password: cashierPw });
    const res = await fetch("/api/admin/merchants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        slug,
        template,
        earnRate: Number(earnRate),
        bgColor: hexToRgb(colors.bg),
        fgColor: hexToRgb(colors.fg),
        labelColor: hexToRgb(colors.label),
        owner: { username: ownerUser, password: ownerPw },
        cashier: withCashier ? { username: cashierUser, password: cashierPw } : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 401) return router.push("/admin/login");
    if (!res.ok) return setErr(data.error || "Could not create the merchant");
    setCreated({ id: data.id, name: name.trim(), enrollUrl: data.enrollUrl, loginUrl: data.loginUrl, logins });
    window.scrollTo({ top: 0 });
  }

  if (created) {
    const text = [
      `${created.name} — 42nights loyalty`,
      `Staff login: ${created.loginUrl}`,
      ...created.logins.map((l) => `${l.role}: ${l.username} / ${l.password}`),
      `Customer enroll link: ${created.enrollUrl}`,
    ].join("\n");
    return (
      <div className={s.formGrid}>
        <div className="panel">
          <div className={s.sectionT}><span className={s.step}>✓</span>{created.name} is live</div>
          <div className="toast ok" style={{ marginTop: 0 }}>
            Passwords are shown once. Only a hash is stored, so copy them now.
          </div>
          <dl className={s.secret}>
            <dt>Staff login</dt>
            <dd><a href={created.loginUrl} target="_blank" rel="noreferrer">{created.loginUrl}</a></dd>
            {created.logins.map((l) => (
              <div key={l.role} style={{ display: "contents" }}>
                <dt>{l.role}</dt>
                <dd>{l.username} / {l.password}</dd>
              </div>
            ))}
            <dt>Enroll link</dt>
            <dd><a href={created.enrollUrl} target="_blank" rel="noreferrer">{created.enrollUrl}</a></dd>
          </dl>
          <div className={s.actions}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}
            >
              {copied ? "Copied ✓" : "Copy all"}
            </button>
          </div>
          <div className="panel-t">Next steps</div>
          <ol className={s.steps}>
            <li>Send the owner their login. Owners get the dashboard; cashiers go straight to /scan.</li>
            <li>Upload the Wallet art (icon, logo, strip) on the merchant page. Until then cards use the default art.</li>
            <li>Put the enroll link behind a counter QR code, the receipt or the Instagram bio. Customers open it on iPhone to add the card.</li>
            <li>Do one test enroll on an iPhone, then a test earn and redeem at /scan.</li>
          </ol>
          <div className={s.actions}>
            <Link href={`/admin/merchants/${created.id}`} className="btn btn-primary" style={{ textDecoration: "none" }}>
              Open merchant page
            </Link>
            <a href="/admin/merchants/new" className="btn btn-ghost" style={{ textDecoration: "none", width: "auto" }}>
              Create another
            </a>
          </div>
        </div>
      </div>
    );
  }

  const [hintClass, hintText] = SLUG_HINT[slugState];
  const canSubmit = !busy && name.trim() !== "" && slugState === "free";

  return (
    <form onSubmit={submit}>
      <div className={s.head}>
        <div>
          <h1 className={s.title}>New merchant</h1>
          <div className={s.sub}>Business, rewards, brand, logins. About two minutes.</div>
        </div>
      </div>
      <div className={s.formGrid}>
        <div className="stack" style={{ minWidth: 0 }}>
          <div className={`panel ${s.section}`}>
            <div className={s.sectionT}><span className={s.step}>1</span>Business</div>
            <label className={s.field}>
              <span className="label">Business name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="Corgi Cafe" />
            </label>
            <div className={s.field}>
              <label className="label" htmlFor="slug">Enroll link</label>
              <div className={s.prefix}>
                <span>/enroll/</span>
                <input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlugEdit(e.target.value.toLowerCase())}
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={48}
                  required
                />
              </div>
              <span className={`${s.hint} ${hintClass}`} aria-live="polite">{hintText}</span>
            </div>
          </div>

          <div className={`panel ${s.section}`}>
            <div className={s.sectionT}><span className={s.step}>2</span>Rewards</div>
            <div className={s.field}>
              <span className="label">Redeem buttons at the counter</span>
              <TemplatePicker value={template} onChange={setTemplate} />
            </div>
            <label className={s.field}>
              <span className="label">Points per $1 spent</span>
              <input type="number" inputMode="decimal" min={EARN_RATE.min} max={EARN_RATE.max} step="any" value={earnRate} onChange={(e) => setEarnRate(e.target.value)} required />
              <EarnHint rate={Number(earnRate)} template={template} />
            </label>
          </div>

          <div className={`panel ${s.section}`}>
            <div className={s.sectionT}><span className={s.step}>3</span>Brand</div>
            <ColorFields value={colors} onChange={setColors} />
            <span className={s.hint}>Logo, icon and strip images are uploaded on the merchant page after creation.</span>
          </div>

          <div className={`panel ${s.section}`}>
            <div className={s.sectionT}><span className={s.step}>4</span>Logins</div>
            <div className={s.two}>
              <label className={s.field}>
                <span className="label">Owner username</span>
                <input value={ownerUser} onChange={(e) => setOwnerEdit(e.target.value.toLowerCase())} autoCapitalize="none" spellCheck={false} required />
              </label>
              <div className={s.field}>
                <label className="label" htmlFor="owner-pw">Owner password</label>
                <div className={s.inline}>
                  <input id="owner-pw" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} minLength={MIN_PASSWORD} required spellCheck={false} autoComplete="off" />
                  <button type="button" className={`btn btn-ghost ${s.smallBtn}`} onClick={() => setOwnerPw(generatePassword())}>New</button>
                </div>
              </div>
            </div>
            <label className={s.check}>
              <input type="checkbox" checked={withCashier} onChange={(e) => setWithCashier(e.target.checked)} />
              Also create a cashier login (counter staff: /scan only)
            </label>
            {withCashier && (
              <div className={s.two}>
                <label className={s.field}>
                  <span className="label">Cashier username</span>
                  <input value={cashierUser} onChange={(e) => setCashierEdit(e.target.value.toLowerCase())} autoCapitalize="none" spellCheck={false} required />
                </label>
                <div className={s.field}>
                  <label className="label" htmlFor="cashier-pw">Cashier password</label>
                  <div className={s.inline}>
                    <input id="cashier-pw" value={cashierPw} onChange={(e) => setCashierPw(e.target.value)} minLength={MIN_PASSWORD} required spellCheck={false} autoComplete="off" />
                    <button type="button" className={`btn btn-ghost ${s.smallBtn}`} onClick={() => setCashierPw(generatePassword())}>New</button>
                  </div>
                </div>
              </div>
            )}
            <span className={s.hint}>Usernames: lowercase letters, digits, dot, dash or underscore. Passwords: {MIN_PASSWORD}+ characters.</span>
          </div>

          {err && <div className="toast bad" role="alert">{err}</div>}
          <div className={s.actions}>
            <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
              {busy ? "Creating…" : "Create merchant"}
            </button>
            <Link href="/admin" className="btn btn-ghost" style={{ textDecoration: "none", width: "auto" }}>Cancel</Link>
          </div>
        </div>

        <div className={s.side}>
          <WalletPreview name={name} colors={colors} />
          <div className={s.sideNote}>Live preview. Wallet draws the real card from these colours and the art you upload later.</div>
        </div>
      </div>
    </form>
  );
}
