import { test as base, expect, type Page } from "@playwright/test";

type Login = { username: string; password: string };
type Card = { serial: string; name: string; phone: string | null };

// Written by global-setup.mjs before the workers start.
export const fx: {
  run: string;
  slug: string;
  owner: Login;
  cashier: Login;
  scanCards: Record<string, Card>;
  searchCard: Card;
  stamps: { cashier: Login; cards: Record<string, Card> }; // a 5-stamp "Free latte" shop
  // per project: a merchant of its own for the happy-hour journey
  happy: Record<string, { owner: Login; cashier: Login; card: Card }>;
} = JSON.parse(process.env.E2E_FIXTURE ?? "null");

// Every spec uses this `test`: it fails a test whose page saw any 5xx. Without
// it a server error can hide behind next dev's auto-reload and still go green.
export const test = base.extend<{ noServerErrors: void }>({
  noServerErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("response", (r) => {
        if (r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      });
      await use();
      expect(errors, "5xx responses seen by the page").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// The app's forms put a `.label` caption before each input; find the input
// that directly follows the caption text.
export const field = (page: Page, label: string) =>
  page.locator(".label", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::input[1]");

// Sign in through the API on the page's own cookie jar (the UI login journey is
// covered once, in scan.spec.ts).
export async function apiLogin(page: Page, who: Login) {
  const r = await page.request.post("/api/merchant/login", { data: who });
  if (!r.ok()) throw new Error(`login ${who.username} → ${r.status()}`);
}
