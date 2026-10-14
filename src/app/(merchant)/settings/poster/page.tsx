import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { getStaff, isAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { PUBLIC_BASE_URL, redemptionsFor, templateKey, type TemplateKey } from "@/lib/config";
import { UUID_RE, rgbToHex, themeHex } from "@/lib/admin/merchant";
import { defaultAssetBuffer } from "@/lib/passDefaults";
import PrintButton from "./PrintButton";
import s from "./poster.module.css";

export const runtime = "nodejs";

type MerchantRow = {
  id: string;
  name: string;
  slug: string | null;
  earn_rate: number | string;
  redeem_template: string | null;
  bg_color: string | null;
  fg_color: string | null;
  label_color: string | null;
};

// The logo the merchant's Wallet card shows: their own upload (largest first,
// it is going on paper), else their template's bundled default — the same
// choice buildApplePass() makes. Inlined, so the private bucket never leaks a URL.
async function logoSrc(merchantId: string, template: TemplateKey): Promise<string> {
  let png: Buffer | undefined;
  for (const name of ["logo@3x.png", "logo@2x.png", "logo.png"]) {
    const { data } = await db.storage.from("pass-assets").download(`merchants/${merchantId}/${name}`);
    if (data?.size) {
      png = Buffer.from(await data.arrayBuffer());
      break;
    }
  }
  png ??= defaultAssetBuffer("logo@3x.png", template)!;
  return `data:image/png;base64,${png.toString("base64")}`;
}

// Printable "Scan to join" sign, US Letter portrait. The owner gets their own
// shop's; the creator admin opens any merchant's with ?merchant=<id> (linked
// from /admin/merchants/<id>). The param is only honoured for an admin
// session, so a staff login can never print another merchant's poster.
export default async function PosterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { merchant: asked } = await searchParams;
  let merchantId: string;
  let back: string;
  if (asked !== undefined) {
    if (!(await isAdmin())) redirect("/admin/login");
    if (typeof asked !== "string" || !UUID_RE.test(asked)) notFound();
    merchantId = asked;
    back = `/admin/merchants/${asked}`;
  } else {
    const staff = await getStaff();
    if (!staff) redirect("/login");
    if (staff.role !== "owner" || !staff.merchantId) redirect("/scan?denied=1");
    merchantId = staff.merchantId;
    back = "/settings";
  }

  const { data: m } = await db
    .from("merchants")
    .select("id, name, slug, earn_rate, redeem_template, bg_color, fg_color, label_color")
    .eq("id", merchantId)
    .maybeSingle<MerchantRow>();
  if (!m) notFound();

  const bar = (
    <div className={s.bar}>
      <div>
        <Link href={back} className={s.back}>← Back</Link>
        <div className={s.title}>Sign-up poster</div>
        <div className={s.help}>
          US Letter, portrait — fits an 8.5 × 11 in sign holder. Reads just as well printed in black and white.
        </div>
      </div>
      {m.slug && <PrintButton />}
    </div>
  );

  if (!m.slug)
    return (
      <div className={s.page}>
        {bar}
        <div className="card label">No public sign-up link yet — ask 42nights to set your sign-up slug.</div>
      </div>
    );

  const template = templateKey(m.redeem_template);
  // Same colours the card uses: the merchant's own, else their template's theme.
  const theme = themeHex(template);
  const colors = {
    "--pb": rgbToHex(m.bg_color, theme.bg),
    "--pf": rgbToHex(m.fg_color, theme.fg),
    "--pl": rgbToHex(m.label_color, theme.label),
  } as React.CSSProperties;

  const enrollUrl = `${PUBLIC_BASE_URL}/enroll/${m.slug}`;
  // Level M: a printed code survives smudges and table-tent glare, and the
  // short enroll URL keeps it to few, large modules.
  const qrSvg = await QRCode.toString(enrollUrl, { type: "svg", margin: 3, errorCorrectionLevel: "M" });
  const logo = await logoSrc(m.id, template);

  const rate = Number(m.earn_rate);
  // Cheapest reward (first of a tie, as on the card's NEXT REWARD field).
  const first = redemptionsFor(template).reduce((a, b) => (b.points > a.points ? b : a));
  const cost = -first.points;
  // Each earn is round(rate × bill), hence "about": per-visit rounding moves it slightly.
  const spend = Math.ceil(cost / rate).toLocaleString("en-US");

  // About 75 characters fit in three lines at full size; a longer headline
  // (names run to 80 characters) gets smaller type so the QR keeps its room.
  const headline = `Get your ${m.name} rewards card`;
  const headlineSize = 7.4 * Math.min(1, 75 / headline.length);

  return (
    <div className={s.page}>
      {bar}
      <article className={s.sheet} style={colors} aria-label={`${m.name} sign-up poster`}>
        <div className={s.inner}>
          <header className={s.band}>
            <img className={s.logo} src={logo} alt="" />
            <span className={s.name}>{m.name}</span>
            <span className={s.kicker}>Rewards card</span>
          </header>

          <h1 className={s.headline} style={{ fontSize: `${headlineSize}cqw` }}>{headline}</h1>

          <div className={s.qrWrap}>
            <img
              className={s.qr}
              src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`}
              alt={`QR code that opens the ${m.name} rewards sign-up page`}
            />
          </div>
          <p className={s.lead}>
            Scan with your iPhone camera — it goes straight into Apple Wallet. No app, no paper card.
          </p>

          <div className={s.earn}>
            <div className={s.tile}>
              <div className={s.tileLabel}>Earn</div>
              <div className={s.tileValue}>
                {rate.toLocaleString("en-US")} point{rate === 1 ? "" : "s"}
              </div>
              <div className={s.tileSub}>for every $1 you spend</div>
            </div>
            <div className={s.tile}>
              <div className={s.tileLabel}>First reward</div>
              <div className={s.tileValue}>{first.label}</div>
              <div className={s.tileSub}>
                at {cost.toLocaleString("en-US")} points — about ${spend} spent
              </div>
            </div>
          </div>

          <footer className={s.url}>Or open {enrollUrl.replace(/^https?:\/\//, "")} in Safari</footer>
        </div>
      </article>
    </div>
  );
}
