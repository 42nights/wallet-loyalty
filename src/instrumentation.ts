import { BOOKING_URL } from "@/lib/config";

// Next.js calls register() once when a server instance starts.
//
// Without SALES_BOOKING_URL the public page has no "Book a call" button and
// sends prospects to the demo's contact note instead (F5). That is a working
// page, not a broken one, so warn rather than fail the deploy.
export function register() {
  if (process.env.NODE_ENV === "production" && !BOOKING_URL)
    console.warn(
      'SALES_BOOKING_URL is not set (or is not https): the landing page shows "Ask us about a pilot" instead of a "Book a call" link. Set it to the Cal.com booking page in the deploy environment.'
    );
}
