import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { BOOKING_URL, REDEEM_TEMPLATES } from "@/lib/config";
import { Donut, SEGMENT_COLORS, TrendChart } from "./(merchant)/dashboard/charts";
import ThemeToggle from "./(merchant)/dashboard/ThemeToggle";
import { SAMPLES, SAMPLE_SERIAL, qrPath } from "./demo/samples";
import {
  HowScreens,
  LockScreen,
  OwnerScreen,
  Paper,
  ReadyScreen,
  RewardsScreen,
  StoryPhone,
  WhyScreen,
  runs,
  type Story as StoryData,
} from "./landing/screens";
import Story from "./landing/Story";
import s from "./page.module.css";

// Public landing page — what Ayaan shows a restaurant owner (decision D5).
// Staff keep using /login and /scan. No database reads, so it renders even
// when Supabase is down.
//
// Copy rule: only claim what exists in the code today. Anything not built yet
// sits in COMING_SOON and is labelled as such on the page.
//
// No prices on the public page (Ayaan, 2026-10-13). The price recommendation
// stays in the internal business plan.

// Decided but not built. Keep this list honest; remove an item when it ships.
const COMING_SOON = ["Google Wallet for Android customers"];

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
    a: "Staff find them by phone number at the counter and show a QR code that puts the card back on their iPhone, or share the same link from the customer page. The link works for one hour. Their points are safe, because the balance is kept on our side, not on the phone.",
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

// Read in five seconds: a mark per cell, a few words, the Wallet column last.
// The marks are drawn, so screen readers get VERDICT[mark] before each cell.
type Verdict = "good" | "mixed" | "poor";
const VERDICT: Record<Verdict, string> = { good: "Good", mixed: "Mixed", poor: "Poor" };
const OPTIONS = ["Paper punch card", "Your own app", "42nights Wallet card"];
const COMPARE: { row: string; cells: [Verdict, string][] }[] = [
  { row: "Customer installs", cells: [["good", "Nothing"], ["poor", "An app and an account"], ["good", "Nothing, built into iPhone"]] },
  { row: "Forgotten at home", cells: [["poor", "All the time"], ["mixed", "Only if deleted"], ["good", "Lives on their phone"]] },
  { row: "Stamps copied or shared", cells: [["poor", "Easy to copy"], ["mixed", "Depends on the app"], ["good", "Only your staff add points"]] },
  { row: "Shows your regulars", cells: [["poor", "Nothing recorded"], ["good", "Yes"], ["good", "Yes, with segments"]] },
  { row: "Effort to start", cells: [["mixed", "A print run"], ["poor", "Build and App Store review"], ["good", "We set it up"]] },
];

function Mark({ v }: { v: Verdict }) {
  return (
    <svg className={`${s.mark} ${s[v]}`} viewBox="0 0 20 20" aria-hidden="true">
      {v === "good" ? (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M6 10.4l2.6 2.6L14 7.4" className={s.tick} />
        </>
      ) : (
        <>
          <circle cx="10" cy="10" r="8.25" className={s.ring} />
          {v === "mixed" ? <path d="M10 1.75a8.25 8.25 0 0 0 0 16.5z" fill="currentColor" /> : <path d="M7 7l6 6M13 7l-6 6" className={s.ring} />}
        </>
      )}
    </svg>
  );
}

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
  const cafe = SAMPLES[0];
  const updated = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  // One phone tells the product story down the page (landing/Story.tsx). Each
  // section's lane holds its own phone, which is also where the travelling
  // one lands; data-beats marks where a chapter of that story starts. One
  // customer runs through it: Sam's card at 120 points is the hero, and How
  // it works shows how it got there.
  const story: StoryData = { cafe, diner: SAMPLES[1], qr: runs(qrPath(SAMPLE_SERIAL)), updated };
  const segments = [
    { key: "vip", label: "VIP", value: 41 },
    { key: "regular", label: "Regular", value: 96 },
    { key: "new", label: "New", value: 58 },
    { key: "active", label: "Active", value: 43 },
    { key: "at_risk", label: "At-risk", value: 37 },
    { key: "lapsed", label: "Lapsed", value: 64 },
    { key: "dormant", label: "Dormant", value: 73 },
  ].map((x) => ({ label: x.label, value: x.value, color: SEGMENT_COLORS[x.key] }));

  // Always a second step after the demo. Without a booking link there is
  // nothing to book (and we never make one up), so it points at the demo's
  // contact note instead; src/instrumentation.ts warns about that in production.
  const ctas = (
    <div className={s.ctas}>
      <Link href="/demo" className={`btn btn-primary ${s.cta}`}>
        See the live demo
      </Link>
      {BOOKING_URL ? (
        <a href={BOOKING_URL} target="_blank" rel="noopener" className={`btn btn-ghost ${s.cta}`}>
          Book a call
        </a>
      ) : (
        <Link href="/demo#contact" className={`btn btn-ghost ${s.cta}`}>
          Ask us about a pilot
        </Link>
      )}
    </div>
  );

  return (
    <div className={s.page}>
      <header className={s.nav}>
        <Link href="/" className={s.brand}>
          <span className={s.brandMark} aria-hidden="true" />
          42nights <span className={s.brandSub}>Wallet Loyalty</span>
        </Link>
        <nav className={s.navLinks} aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#owners">For owners</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link href="/scan" className={s.staff}>
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
              For restaurants, cafés and shops. Already set up? <Link href="/scan">Staff login</Link>
            </p>
          </div>

          <div className={s.heroArt} aria-hidden="true" data-hero-art>
            <Paper name={cafe.name} className={s.punch} />
            <div className={s.heroPhone}>
              <StoryPhone slot="static" intro>
                <LockScreen story={story} rest />
              </StoryPhone>
            </div>
          </div>
        </section>

        <section id="how" className={`${s.section} ${s.scrolly} ${s.left}`}>
          <div>
            <h2>Three steps, no app</h2>
            <ol className={s.steps}>
              <li data-beats="scan join add wallet">
                <h3>The customer scans your QR code</h3>
                <p>
                  It opens your sign-up page. They type their name and phone number and add the card to Apple Wallet.
                  Nothing to install, no password to remember.
                </p>
              </li>
              <li data-beats="counter">
                <h3>Staff scan the card at the counter</h3>
                <p>
                  Type the bill amount and the points are added, or tap a reward to redeem it. Any phone or tablet with a
                  camera works.
                </p>
              </li>
              <li data-beats="notify">
                <h3>The balance updates on the card</h3>
                <p>
                  After each visit the new balance shows on the card in their Wallet, so customers always know how close
                  the next reward is.
                </p>
              </li>
            </ol>
          </div>
          <div className={s.lane} data-lane aria-hidden="true">
            <StoryPhone slot="pin">
              <HowScreens story={story} />
            </StoryPhone>
          </div>
        </section>

        <section id="templates" className={`${s.section} ${s.scrolly}`}>
          <div>
            <h2 data-beats="points stamps stamp">Rewards that fit what you sell</h2>
            <p className={s.sectionLede}>
              Pick the reward set for your kind of business in Settings. These are the four buttons your staff tap at the counter.
              Customers earn points on every dollar they spend, at a rate you choose. Prefer a classic stamp card? Your card
              can count stamps instead: staff add 1 to 3 stamps per tap, no bill to type, and a full card earns the
              reward you pick.
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
          </div>
          <div className={s.lane} data-lane aria-hidden="true">
            <StoryPhone slot="pin">
              <RewardsScreen story={story} />
            </StoryPhone>
          </div>
        </section>

        <section id="owners" className={`${s.section} ${s.scrolly} ${s.left}`}>
          <div className={s.owners}>
            <div>
              <h2 data-beats="dash">See who your regulars are</h2>
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
                <div data-beats="risk">
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
                  <dd>Ask questions about your customers in plain English, and read a weekly digest.</dd>
                </div>
                <div>
                  <dt>Lost cards</dt>
                  <dd>Find a customer by phone at the counter and show a QR code that puts their card back on their iPhone. The link works for one hour.</dd>
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
          </div>
          <div className={s.lane} data-lane aria-hidden="true">
            <StoryPhone slot="pin">
              <OwnerScreen story={story} />
            </StoryPhone>
          </div>
        </section>

        <section id="why" className={`${s.section} ${s.scrolly}`}>
          <div>
            <h2 data-beats="why">Why a Wallet card</h2>
            <p className={s.sectionLede}>
              Paper cards get lost and copied. A custom app is expensive, and most customers will not install it for a free
              coffee. A Wallet card sits in between.
            </p>
            {/* Explicit roles: the phone layout restyles rows as grids, which
                drops native table semantics in some browsers. */}
            <table className={s.compare} role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <td role="cell" />
                  {OPTIONS.map((o, i) => (
                    <th key={o} scope="col" role="columnheader" className={i === 2 ? s.us : undefined}>
                      {o}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {COMPARE.map((r) => (
                  <tr key={r.row} role="row">
                    <th scope="row" role="rowheader">
                      {r.row}
                    </th>
                    {r.cells.map(([v, text], i) => (
                      <td key={i} role="cell" className={i === 2 ? s.us : undefined}>
                        <span className={s.cell}>
                          <Mark v={v} />
                          <span>
                            <span className={s.sr}>{VERDICT[v]}: </span>
                            {text}
                          </span>
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={s.takeaway}>
              <Mark v="good" />
              Only the Wallet card gets a check in every row.
            </p>
          </div>
          {/* The paper card the Wallet card replaces. On desktop the
              travelling phone carries its own copy and drops it during Why. */}
          <div className={`${s.lane} ${s.whyLane}`} data-lane aria-hidden="true">
            <Paper name={cafe.name} className={s.leftBehind} />
            <StoryPhone slot="pin">
              <WhyScreen story={story} />
            </StoryPhone>
          </div>
        </section>

        <section id="faq" className={`${s.section} ${s.faqSection}`}>
          <h2>Questions owners ask</h2>
          <div className={s.faq}>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          {/* Where the travelling phone parks, small, beside the questions. */}
          <div className={s.park} data-slot="pin" aria-hidden="true" />
        </section>

        <section className={`${s.section} ${s.closing}`} data-beats="ready">
          <div className={s.lane} data-lane aria-hidden="true">
            <StoryPhone slot="static">
              <ReadyScreen story={story} />
            </StoryPhone>
          </div>
          <h2>Try it before you decide.</h2>
          <p className={s.sectionLede}>
            The demo runs in your browser with sample data. Ring up a bill, redeem a reward and watch the card change.
          </p>
          {ctas}
        </section>
      </main>

      <footer className={s.footer}>
        <span>© {new Date().getFullYear()} 42nights</span>
        <Link href="/scan">Staff login</Link>
        <Link href="/demo">Demo</Link>
        <p>Apple, Apple Wallet and iPhone are trademarks of Apple Inc., registered in the U.S. and other countries.</p>
      </footer>
      <Story />
    </div>
  );
}
