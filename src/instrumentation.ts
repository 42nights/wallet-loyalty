// Next.js calls register() once when a server instance starts.
//
// Without SALES_CONTACT_EMAIL the public page has no "Book a call" button and
// sends prospects to the demo's contact note instead (F5). That is a working
// page, not a broken one, so warn rather than fail the deploy.
export function register() {
  if (process.env.NODE_ENV === "production" && !process.env.SALES_CONTACT_EMAIL?.trim())
    console.warn(
      'SALES_CONTACT_EMAIL is not set: the landing page shows "Ask us about a pilot" instead of a "Book a call" email link. Set it in the deploy environment.'
    );
}
