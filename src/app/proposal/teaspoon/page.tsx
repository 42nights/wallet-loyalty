import type { Metadata } from "next";
import { Work_Sans } from "next/font/google";
import s from "./proposal.module.css";

// The pilot proposal for Teaspoon: one page to send their leadership, with
// the concept video, how the card works, the free pilot and a live demo. Not
// indexed; the video, poster and QR live in public/proposal/.

const work = Work_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"] });
const SITE = "https://wallet-loyalty-seven.vercel.app";
const ENROLL = `${SITE}/enroll/teaspoon-demo`;
const TRY = `${SITE}/try/teaspoon-demo`;

export const metadata: Metadata = {
  title: "Teaspoon × 42nights · Apple Wallet loyalty pilot",
  description: "A no-download Teaspoon loyalty card in Apple Wallet, and a free 60-day pilot at 1 to 3 stores.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Teaspoon × 42nights · Apple Wallet loyalty pilot",
    description: "A no-download Teaspoon loyalty card in Apple Wallet, and a free 60-day pilot at 1 to 3 stores.",
    images: [{ url: `${SITE}/proposal/teaspoon-poster.jpg`, width: 1280, height: 720 }],
  },
};

const STEPS = [
  ["Scan", "The guest scans the “Scan to join” sign at the counter."],
  ["Join", "They enter a name and phone number. No app, no account, no password."],
  ["Add to Wallet", "One tap and the Teaspoon card is in Apple Wallet."],
  ["Stamp", "The barista scans the card from any phone or tablet and taps +1. At 10 stamps: $6 off any drink."],
];

const GETS = [
  ["Members you miss today", "Walk-ins who won't download the app join in a few taps, so their visits finally count."],
  ["A dashboard for each store", "Members, regulars, who hasn't been back, busy hours and staff activity. Export anything as CSV."],
  ["Offers on the card", "Give a group bonus stamps or an offer that shows on the back of their card. Birthday treat included."],
  ["Teaspoon on their phone", "The card sits in Apple Wallet beside their payment cards, in your colours, every time they open it."],
];

const PILOT = [
  ["Free for 60 days at 1 to 3 stores", "You choose the stores, ideally ones you run directly."],
  ["You set the success bar", "For example, walk-in sign-ups per day, or how many come back within 30 days."],
  ["We do the setup", "The card in your colours, counter signs, staff training, a day-3 check-in and weekly numbers."],
  ["No commitment", "No contract and no card on file. Nothing continues after day 60 unless you say so. Your data is yours to export, and deleted on request."],
];

const TIMELINE = [
  ["Week 1", "Card, signs and staff training"],
  ["Day 3", "Check-in at each store"],
  ["Weekly", "Sign-ups, returns and redemptions"],
  ["Day 60", "Review against your success bar"],
];

const LIMITS = [
  ["One card per store", "Stamps don't carry between stores yet. A brand-wide card is on our roadmap."],
  ["Apple Wallet only", "Google Wallet is planned. Android guests keep using the Teaspoon app."],
  ["Runs beside your till", "No POS or app integration. It keeps its own records and doesn't touch Golden Spoons."],
  ["No texts or emails", "It never messages your customers. Updates appear on the card in their Wallet."],
];

export default function TeaspoonProposal() {
  return (
    <div className={`${s.page} ${work.className}`}>
      <header className={s.open}>
        <div className={`${s.wrap} ${s.openGrid}`}>
          <div>
            <p className={s.eyebrow}>Pilot proposal · October 2026</p>
            <h1 className={s.h1}>
              Teaspoon&apos;s loyalty card in Apple Wallet. <em>No download.</em>
            </h1>
            <p className={s.lede}>
              Every guest who isn&apos;t on the Teaspoon app yet can join at the register: scan, enter a name and number, tap
              Add. Your baristas stamp it from any phone or tablet.
            </p>
            <p className={s.for}>Prepared for the Teaspoon leadership team by Ayaan Gazali, founder of 42nights.</p>
          </div>
          <figure className={s.film}>
            <video controls preload="metadata" playsInline poster="/proposal/teaspoon-poster.jpg">
              <source src="/proposal/teaspoon.mp4" type="video/mp4" />
            </video>
            <figcaption>The concept in 88 seconds, with captions.</figcaption>
          </figure>
        </div>
      </header>

      <main className={s.wrap}>
        <section className={s.section} aria-labelledby="opp">
          <h2 id="opp">The opportunity</h2>
          <p className={s.sub}>The Teaspoon Rewards app is well loved. The gap is the guest at the register who hasn&apos;t downloaded it.</p>
          <blockquote className={s.quote}>
            “All accounts must be started through the app or online ordering website.”
            <cite>Teaspoon FAQ, teaspoonlife.com</cite>
          </blockquote>
          <ul className={s.bullets}>
            <li>A walk-in who won&apos;t download the app earns nothing for that visit, and Teaspoon never learns they came in.</li>
            <li>The card doesn&apos;t replace the app. It catches everyone else, in the time it takes to pour a drink.</li>
          </ul>
        </section>

        <section className={s.section} aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <p className={s.sub}>Built and running today. No new hardware and no change to your POS.</p>
          <ol className={s.steps}>
            {STEPS.map(([t, d]) => (
              <li key={t}>
                <b>{t}</b>
                <span>{d}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={s.section} aria-labelledby="gets">
          <h2 id="gets">What Teaspoon gets</h2>
          <div className={s.two}>
            {GETS.map(([t, d]) => (
              <div key={t}>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={s.section} aria-labelledby="pilot">
          <h2 id="pilot">The pilot</h2>
          <p className={s.sub}>A free pilot, on your terms.</p>
          <div className={s.two}>
            {PILOT.map(([t, d]) => (
              <div key={t}>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
          <ol className={s.timeline}>
            {TIMELINE.map(([t, d]) => (
              <li key={t}>
                <b>{t}</b>
                <span>{d}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${s.section} ${s.flush}`} aria-labelledby="limits">
          <div className={s.limits}>
            <h2 id="limits">What it isn&apos;t, yet</h2>
            <p className={s.sub}>Said up front, so there are no surprises in a pilot.</p>
            <dl>
              {LIMITS.map(([t, d]) => (
                <div key={t}>
                  <dt>{t}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className={s.section} aria-labelledby="try">
          <h2 id="try">Try it yourself</h2>
          <div className={s.try}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proposal/teaspoon-qr.svg" alt="QR code for the Teaspoon demo card" className={s.qr} width={180} height={180} />
            <div>
              <p className={s.tryLead}>Scan with an iPhone camera to add the demo card to Apple Wallet.</p>
              <div className={s.buttons}>
                <a className={s.primary} href={ENROLL}>Get the demo card</a>
                <a className={s.secondary} href={TRY}>No iPhone? Try it in the browser</a>
              </div>
              <p className={s.small}>
                &ldquo;Teaspoon Demo&rdquo; is a test card and doesn&apos;t earn real Golden Spoons. Demo logins for the barista screen
                and owner dashboard on request.
              </p>
            </div>
          </div>
        </section>

        <section className={`${s.section} ${s.flush}`}>
          <div className={s.next}>
            <h2>Next step: a 30-minute call</h2>
            <p>We agree on the success bar and pick the pilot stores. Reply to this email with a time that suits you.</p>
            <p className={s.sign}>Ayaan Gazali · Founder, 42nights</p>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={s.wrap}>
          Concept by 42nights for Teaspoon. Not affiliated with Teaspoon. Teaspoon and the Teaspoon spoon are Teaspoon&apos;s marks,
          shown only to illustrate the concept. Apple, Apple Wallet and iPhone are trademarks of Apple Inc., registered in the
          U.S. and other countries.
        </div>
      </footer>
    </div>
  );
}
