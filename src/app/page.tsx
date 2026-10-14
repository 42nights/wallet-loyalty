import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { REDEEM_TEMPLATES } from "@/lib/config";
import { Donut, SEGMENT_COLORS, TrendChart } from "./(merchant)/dashboard/charts";
import ThemeToggle from "./(merchant)/dashboard/ThemeToggle";
import { LockBanner, Phone, WalletCard } from "./demo/WalletCard";
import { SAMPLES, SAMPLE_SERIAL, qrPath } from "./demo/samples";
import s from "./page.module.css";

// Public landing page — what Ayaan shows a restaurant owner (decision D5).
// Staff keep using /login and /scan. No database reads, so it renders even
// when Supabase is down.
//
// Copy rule: only claim what exists in the code today. Anything not built yet
// sits in COMING_SOON and is labelled as such on the page.

// ---------------------------------------------------------------------------
// Pricing — edit here. Per location, per month, USD. Source: business plan §7.
// ---------------------------------------------------------------------------
const PRICING = [
  {
    name: "Founding offer",
    price: 19,
    tag: "First 10 merchants only",
    blurb: "Everything in Growth, for the businesses that start with us.",
    features: ["Everything in Growth", "Your price locked for 12 months", "Limited to the first 10 merchants"],
    featured: true,
  },
  {
    name: "Starter",
    price: 29,
    tag: null,
    blurb: "The loyalty card and everything you need to run it.",
    features: [
      "Your branded Apple Wallet card",
      "Unlimited members and staff logins",
      "Counter terminal for any phone or tablet",
      "Restaurant, café or retail reward set",
      "Owner dashboard, customer list and segments",
      "Lost-card re-send link",
    ],
    featured: false,
  },
  {
    name: "Growth",
    price: 59,
    tag: null,
    blurb: "Starter, plus the tools to bring customers back.",
    features: [
      "Everything in Starter",
      "Bonus-point campaigns for any segment",
      "Offers on the back of the card",
      "AI insights: ask your data, weekly digest",
    ],
    featured: false,
  },
];

// Decided but not built. Keep this list honest; remove an item when it ships.
const COMING_SOON = ["Re-send a lost card with a QR code at the counter", "Google Wallet for Android customers"];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does it work on Android?",
    a: "Not yet. Today the card is for Apple Wallet on iPhone. Google Wallet is on our roadmap, but we have not set a date. Customers on Android can keep using your paper card in the meantime.",
  },
  {
    q: "What does my customer need?",
    a: "An iPhone. Apple Wallet is built in. They scan your QR code, open the page in Safari, type their name and phone number, and add the card. No app, no account, no password.",
  },
  {
    q: "How long does setup take?",
    a: "We do the setup for you. Send us your logo, your colours and the reward set you want, and we create your card, your sign-up link and your staff logins. Training your staff takes three moves: scan the card, type the bill, tap Add.",
  },
  {
    q: "What do I need at the counter?",
    a: "Any phone or tablet with a camera. The staff terminal runs in the browser and can be added to the home screen like an app. There is no POS integration: staff type the bill amount.",
  },
  {
    q: "Can customers share a card or fake a stamp?",
    a: "No. Cards cannot be shared between Wallet users, and only your logged-in staff can add or redeem points. Every counter transaction records which staff member rang it up.",
  },
  {
    q: "What happens if a customer loses their phone or deletes the card?",
    a: "You send the card again from their customer page, with a link that works for one hour. Their points are safe, because the balance is kept on our side, not on the phone.",
  },
  {
    q: "Can you text or email my customers?",
    a: "Not today. Campaigns add bonus points to a group of customers and put an offer on the back of their card in Wallet.",
  },
  {
    q: "Who can see my customer data?",
    a: "Only your business. Every lookup is limited to your shop, so another business on the platform can never see your customers. The dashboard is for the owner; cashier logins only work the counter.",
  },
];

const COMPARE: { row: string; paper: string; app: string; wallet: string }[] = [
  { row: "What the customer installs", paper: "Nothing, but they must carry it", app: "An app and an account", wallet: "Nothing. Wallet is built into iPhone" },
  { row: "Forgotten at home", paper: "All the time", app: "Only if they deleted the app", wallet: "It lives on their phone" },
  { row: "Stamps can be copied or shared", paper: "Yes", app: "Depends on the app", wallet: "No. Only your staff add points" },
  { row: "Shows you who your regulars are", paper: "No", app: "Yes", wallet: "Yes, with segments and campaigns" },
  { row: "What it takes to start", paper: "A print run", app: "Design, build and App Store review", wallet: "We set it up for you" },
];

export const metadata: Metadata = {
  title: "42nights Wallet Loyalty | Loyalty cards in Apple Wallet",
  description:
    "A branded loyalty card your customers keep in Apple Wallet. No app to download: they scan a QR code at the counter, your staff scan the card when they pay, and the balance updates after every visit.",
  openGraph: {
    title: "42nights Wallet Loyalty",
    description:
      "Your loyalty card, in their Apple Wallet. For restaurants, cafés and shops: no app to download, a card that updates after every visit, and a dashboard of your regulars.",
    type: "website",
    siteName: "42nights",
  },
};

export default async function Landing() {
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  const contact = process.env.SALES_CONTACT_EMAIL?.trim();
  const mailto = contact ? `mailto:${contact}?subject=${encodeURIComponent("42nights Wallet Loyalty")}` : null;
  const cafe = SAMPLES[0];
  const qr = qrPath(SAMPLE_SERIAL);
  const updated = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const segments = [
    { key: "vip", label: "VIP", value: 41 },
    { key: "regular", label: "Regular", value: 96 },
    { key: "new", label: "New", value: 58 },
    { key: "active", label: "Active", value: 43 },
    { key: "at_risk", label: "At-risk", value: 37 },
    { key: "lapsed", label: "Lapsed", value: 64 },
    { key: "dormant", label: "Dormant", value: 73 },
  ].map((x) => ({ label: x.label, value: x.value, color: SEGMENT_COLORS[x.key] }));

  const ctas = (
    <div className={s.ctas}>
      <Link href="/demo" className={`btn btn-primary ${s.cta}`}>
        See the live demo
      </Link>
      {mailto && (
        <a href={mailto} className={`btn btn-ghost ${s.cta}`}>
          Book a call
        </a>
      )}
    </div>
  );

  return (
    <div className={s.page}>
      <header className={s.nav}>
        <Link href="/" className={s.brand}>
          <span className={s.mark} aria-hidden="true" />
          42nights <span className={s.brandSub}>Wallet Loyalty</span>
        </Link>
        <nav className={s.navLinks} aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#owners">For owners</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link href="/login" className={s.staff}>
          Staff login
        </Link>
        <ThemeToggle initial={theme} />
      </header>

      <main>
        <section className={s.hero}>
          <div className={s.heroText}>
            <h1>Your loyalty card, in their Apple Wallet.</h1>
            <p className={s.lede}>
              Customers add your branded card by scanning a QR code at the counter. There is no app to download. Your
              staff scan the card when they pay, and the points on it update after every visit.
            </p>
            {ctas}
            <p className={s.small}>
              For restaurants, cafés and shops. Already set up? <Link href="/login">Staff login</Link>
            </p>
          </div>

          <div className={s.heroArt} aria-hidden="true">
            <div className={s.punch}>
              <div className={s.punchHead}>
                <b>{cafe.name}</b>
                <span>Buy 9 coffees, the 10th is on us</span>
              </div>
              <div className={s.holes}>
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className={i < 7 ? s.stamped : undefined} />
                ))}
              </div>
            </div>
            <div className={s.heroPhone}>
              <Phone banner={<LockBanner name={cafe.name} colors={cafe.colors} points={305} shown />}>
                <div className={s.cardOffset}>
                  <WalletCard name={cafe.name} colors={cafe.colors} points={305} updated={updated} qr={qr} />
                </div>
              </Phone>
            </div>
          </div>
        </section>

        <section id="how" className={s.section}>
          <h2>Three steps, no app</h2>
          <ol className={s.steps}>
            <li>
              <h3>The customer scans your QR code</h3>
              <p>
                It opens your sign-up page. They type their name and phone number and add the card to Apple Wallet.
                Nothing to install, no password to remember.
              </p>
            </li>
            <li>
              <h3>Staff scan the card at the counter</h3>
              <p>
                Type the bill amount and the points are added, or tap a reward to redeem it. Any phone or tablet with a
                camera works.
              </p>
            </li>
            <li>
              <h3>The balance updates on the card</h3>
              <p>
                After each visit the new balance shows on the card in their Wallet, so customers always know how close
                the next reward is.
              </p>
            </li>
          </ol>
        </section>

        <section id="templates" className={s.section}>
          <h2>Rewards that fit what you sell</h2>
          <p className={s.sectionLede}>
            Pick the reward set for your kind of business. These are the four buttons your staff tap at the counter.
            Customers earn points on every dollar they spend, at a rate set for your shop.
          </p>
          <div className={s.templates}>
            {Object.entries(REDEEM_TEMPLATES).map(([key, t]) => (
              <div key={key} className={s.template}>
                <h3>{t.label}</h3>
                <ul className={s.keys}>
                  {t.actions.map((a) => (
                    <li key={a.id}>
                      <span>{a.label}</span>
                      <small>{-a.points} pts</small>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="owners" className={`${s.section} ${s.owners}`}>
          <div>
            <h2>See who your regulars are</h2>
            <p className={s.sectionLede}>
              Every scan lands in a dashboard only the owner can open. Cashier logins work the counter; the numbers stay
              with you.
            </p>
            <dl className={s.features}>
              <div>
                <dt>Dashboard</dt>
                <dd>Members, active members, points issued and redeemed, repeat rate, and a heatmap of your busiest hours.</dd>
              </div>
              <div>
                <dt>Customer list</dt>
                <dd>Search by name or phone, open anyone&apos;s visit history, add tags and notes, and adjust points by hand.</dd>
              </div>
              <div>
                <dt>Segments</dt>
                <dd>
                  Customers are grouped for you: VIP, Regular, New, Active, At-risk, Lapsed and Dormant. At-risk means a
                  regular with three or more visits who has not been back in a month.
                </dd>
              </div>
              <div>
                <dt>Campaigns</dt>
                <dd>
                  Give a segment bonus points and put an offer on the back of their card. Two weeks later you see what
                  share of them came back and spent.
                </dd>
              </div>
              <div>
                <dt>Staff</dt>
                <dd>Add cashier logins, reset their passwords, and see how many transactions each one rang up.</dd>
              </div>
              <div>
                <dt>AI insights</dt>
                <dd>Ask questions about your customers in plain English, and read a weekly digest. On the Growth plan.</dd>
              </div>
              <div>
                <dt>Lost cards</dt>
                <dd>Send a customer their card again from their page, with a link that works for one hour.</dd>
              </div>
            </dl>
            <div className={s.soon}>
              <span className={s.soonTag}>Coming soon</span>
              <ul>
                {COMING_SOON.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>

          <figure className={s.dash} aria-label={`Sample owner dashboard for ${cafe.name}`}>
            <div className={s.dashKpis}>
              <div className="panel">
                <span className="panel-t">Members</span>
                <b>{cafe.kpis.members}</b>
              </div>
              <div className="panel">
                <span className="panel-t">Active · 30d</span>
                <b>{cafe.kpis.active}</b>
              </div>
              <div className="panel">
                <span className="panel-t">Repeat rate</span>
                <b>{Math.round(cafe.kpis.repeat * 100)}%</b>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h">
                <span className="panel-t">Points flow</span>
                <span className={s.panelNote}>last 14 days</span>
              </div>
              <TrendChart
                series={[
                  { label: "Issued", color: "var(--c-issued)", data: cafe.issued14 },
                  { label: "Redeemed", color: "var(--c-redeemed)", data: cafe.redeemed14 },
                ]}
              />
            </div>
            <div className="panel">
              <div className="panel-h">
                <span className="panel-t">Segments</span>
              </div>
              <Donut label="members" segments={segments} size={140} thickness={20} />
            </div>
            <figcaption className={s.panelNote}>Sample data for a café. The real dashboard shows your own customers.</figcaption>
          </figure>
        </section>

        <section id="why" className={s.section}>
          <h2>Why a Wallet card</h2>
          <p className={s.sectionLede}>
            Paper cards get lost and copied. A custom app is expensive, and most customers will not install it for a free
            coffee. A Wallet card sits in between.
          </p>
          <table className={s.compare}>
            <thead>
              <tr>
                <td />
                <th scope="col">Paper punch card</th>
                <th scope="col">Your own app</th>
                <th scope="col" className={s.us}>
                  42nights Wallet card
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.row}>
                  <th scope="row">{r.row}</th>
                  <td data-label="Paper card">{r.paper}</td>
                  <td data-label="Own app">{r.app}</td>
                  <td data-label="42nights" className={s.us}>
                    {r.wallet}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="pricing" className={s.section}>
          <h2>Pricing</h2>
          <p className={s.sectionLede}>
            Per location, per month, in US dollars. No hardware to buy: your staff use a phone or tablet you already own.
          </p>
          <div className={s.tiers}>
            {PRICING.map((t) => (
              <div key={t.name} className={`${s.tier} ${t.featured ? s.featured : ""}`}>
                <div className={s.tierHead}>
                  <h3>{t.name}</h3>
                  {t.tag && <span className={s.tierTag}>{t.tag}</span>}
                </div>
                <p className={s.price}>
                  <b>${t.price}</b> per month, per location
                </p>
                <p className={s.tierBlurb}>{t.blurb}</p>
                <ul>
                  {t.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className={s.section}>
          <h2>Questions owners ask</h2>
          <div className={s.faq}>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={`${s.section} ${s.closing}`}>
          <h2>Try it before you decide.</h2>
          <p className={s.sectionLede}>
            The demo runs in your browser with sample data. Ring up a bill, redeem a reward and watch the card change.
          </p>
          {ctas}
        </section>
      </main>

      <footer className={s.footer}>
        <span>© {new Date().getFullYear()} 42nights</span>
        <Link href="/login">Staff login</Link>
        <Link href="/demo">Demo</Link>
        <p>Apple, Apple Wallet and iPhone are trademarks of Apple Inc., registered in the U.S. and other countries.</p>
      </footer>
    </div>
  );
}
