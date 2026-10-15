import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { BOOKING_URL, loyaltyMode, redemptionsFor, stampGoal, stampReward, templateKey } from "@/lib/config";
import { isRgb } from "@/lib/admin/merchant";
import { pngSize } from "@/lib/admin/png";
import { PASS_THEMES } from "@/lib/passThemes";
import { stampLayout } from "@/lib/wallet/apple/stampStrip";
import DemoClient from "../../demo/DemoClient";
import { SAMPLES, SAMPLE_SERIAL, qrPath } from "../../demo/samples";
import type { Logo } from "../../demo/WalletCard";
import StampBoard from "./StampBoard";
import s from "../../demo/demo.module.css";
import t from "./try.module.css";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Try the demo card · 42nights Wallet Loyalty",
  robots: { index: false, follow: false },
};

// /try/<slug>: the /demo experience in one demo merchant's own name, colours,
// art and rules (stamp card or points), for a prospect without an iPhone at
// hand. Only slugs ending in "-demo" are served, so a live shop never shows up
// here labelled as a demo. Only the merchants row and its uploaded art are
// read: the customer, the taps and the card on the page are all simulated.

type MerchantRow = {
  id: string;
  name: string;
  earn_rate: number | string;
  redeem_template: string | null;
  bg_color: string | null;
  fg_color: string | null;
  label_color: string | null;
  loyalty_mode?: string | null; // stamp card columns: absent on an un-migrated database
  stamp_goal?: number | null;
  stamp_reward?: string | null;
};

// The merchant's own upload of a Wallet image (largest first) with its @1x
// width, inlined so the private bucket never leaks a URL. Undefined when there
// is none: the card then shows initials, like /demo.
async function art(merchantId: string, base: "logo" | "icon"): Promise<Logo | undefined> {
  for (const scale of [3, 2, 1]) {
    const name = `${base}${scale > 1 ? `@${scale}x` : ""}.png`;
    const { data } = await db.storage.from("pass-assets").download(`merchants/${merchantId}/${name}`);
    const png = data?.size ? Buffer.from(await data.arrayBuffer()) : null;
    const size = png && pngSize(png);
    if (png && size)
      return { src: `data:image/png;base64,${png.toString("base64")}`, w: size.width / scale };
  }
}

export default async function TryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slug.endsWith("-demo")) notFound();
  const { data: m } = await db
    .from("merchants")
    .select("*") // "*": the stamp card columns may not exist yet (then it's points)
    .eq("slug", slug)
    .maybeSingle<MerchantRow>();
  if (!m) notFound();

  const template = templateKey(m.redeem_template);
  const theme = PASS_THEMES[template];
  const colors = {
    bg: isRgb(m.bg_color) ? m.bg_color : theme.bg,
    fg: isRgb(m.fg_color) ? m.fg_color : theme.fg,
    label: isRgb(m.label_color) ? m.label_color : theme.label,
  };
  const [logo, icon] = await Promise.all([art(m.id, "logo"), art(m.id, "icon")]);
  const sample = SAMPLES.find((x) => x.key === template)!;
  const qr = qrPath(SAMPLE_SERIAL);
  const stamps = loyaltyMode(m.loyalty_mode) === "stamps";
  const prospect = m.name.replace(/\s+demo$/i, "");

  return (
    <main className={s.page}>
      <header className={s.bar}>
        <Link href="/" className={`brand ${s.brand}`}>
          <span className="dot" aria-hidden="true" /> 42nights
        </Link>
        <span className={s.pill}>Demo — sample data</span>
      </header>
      <p className={t.affil}>Concept by 42nights, not affiliated with {prospect}.</p>

      <div className={s.intro}>
        <h1>
          Try the {m.name} {stamps ? "stamp card" : "card"}.
        </h1>
        <p>
          {stamps
            ? "Be the customer and the counter: add stamps, fill the card and redeem the reward."
            : "Be the customer and the cashier: ring up a bill, watch the card change and redeem a reward."}{" "}
          Nothing here is saved, and the customer is made up.
        </p>
      </div>

      <div className={t.stage}>
        {stamps ? (
          <StampBoard
            name={m.name}
            colors={colors}
            logo={logo}
            icon={icon?.src}
            reward={stampReward(m.stamp_reward)}
            slots={stampLayout(stampGoal(m.stamp_goal))}
            customer={sample.customer}
            qr={qr}
          />
        ) : (
          <DemoClient
            merchants={[
              {
                ...sample,
                name: m.name,
                colors,
                earnRate: Number(m.earn_rate),
                actions: redemptionsFor(template),
                logo,
                icon: icon?.src,
              },
            ]}
            qr={qr}
            updated={new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          />
        )}
      </div>

      <footer className={s.foot}>
        <p>See it in your own Wallet.</p>
        <div className={s.footNote}>
          The sign-up page asks for a name and phone number, then adds this demo card to Apple Wallet on an iPhone. On a
          computer it shows a QR code to scan with one.
        </div>
        <div className={s.footCtas}>
          <Link href={`/enroll/${slug}`} className="btn btn-primary">
            Add the real demo card to your iPhone
          </Link>
          {BOOKING_URL ? (
            <a href={BOOKING_URL} target="_blank" rel="noopener" className="btn btn-ghost">
              Ask about a pilot
            </a>
          ) : (
            <Link href="/demo#contact" className="btn btn-ghost">
              Ask about a pilot
            </Link>
          )}
        </div>
      </footer>
    </main>
  );
}
