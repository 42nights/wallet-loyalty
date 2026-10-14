import type { Metadata } from "next";
import Link from "next/link";
import { BOOKING_URL, REDEEM_TEMPLATES } from "@/lib/config";
import DemoClient, { type DemoMerchant } from "./DemoClient";
import { SAMPLES, SAMPLE_SERIAL, qrPath } from "./samples";
import s from "./demo.module.css";

// Public, no database, no auth: everything below runs on sample data in the
// browser, so the demo works even when Supabase is down.

export const metadata: Metadata = {
  title: "Live demo · 42nights Wallet Loyalty",
  description:
    "Try an Apple Wallet loyalty card in your browser: ring up a bill at the counter, watch the card update, and see what the owner's dashboard shows. Sample data, nothing saved.",
  openGraph: {
    title: "Try the 42nights Wallet Loyalty demo",
    description: "Be the customer and the cashier: earn points, redeem a reward and watch the Apple Wallet card change.",
    type: "website",
  },
};

export default function DemoPage() {
  // Reward buttons come straight from the real templates, so the demo cannot drift.
  const merchants: DemoMerchant[] = SAMPLES.map((m) => ({ ...m, actions: REDEEM_TEMPLATES[m.key].actions }));
  const updated = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <main className={s.page}>
      <header className={s.bar}>
        <Link href="/" className={`brand ${s.brand}`}>
          <span className="dot" aria-hidden="true" /> 42nights
        </Link>
        <span className={s.pill}>Demo — sample data</span>
        <Link href="/scan" className={s.staff}>
          Staff login
        </Link>
      </header>

      <div className={s.intro}>
        <h1>Be the customer and the cashier.</h1>
        <p>
          Pick a sample business, ring up a bill at the counter and watch the loyalty card on the phone change. Nothing
          here is saved, and the names and numbers are made up.
        </p>
      </div>

      <DemoClient merchants={merchants} qr={qrPath(SAMPLE_SERIAL)} updated={updated} />

      {/* "Ask us about a pilot" on / lands here. With no booking link we have
          nothing to offer, so the note says who can put them in touch. */}
      <footer id="contact" className={s.foot}>
        <p>Want this for your business?</p>
        {!BOOKING_URL && (
          <div className={s.footNote}>
            Ask us about a pilot. We set up every business ourselves, so ask the person who shared this page with you, or
            the staff at the shop where you saw the card, to put you in touch.
          </div>
        )}
        <div className={s.footCtas}>
          {BOOKING_URL && (
            <a href={BOOKING_URL} target="_blank" rel="noopener" className="btn btn-primary">
              Book a call
            </a>
          )}
          <Link href="/#founding" className={`btn ${BOOKING_URL ? "btn-ghost" : "btn-primary"}`}>
            Founding merchants
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to the overview
          </Link>
        </div>
      </footer>
    </main>
  );
}
