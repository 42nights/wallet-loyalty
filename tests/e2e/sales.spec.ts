import { SAMPLES } from "../../src/app/demo/samples";
import { test, expect } from "./helpers";

// The public pages: / and /demo. No fixtures, no login. The e2e server runs
// without SALES_BOOKING_URL (it is not in .env.local), so the second call to
// action is "Ask us about a pilot", never a booking link.

test("landing: no prices, no founding section, section links and a next step", async ({ page }) => {
  await page.goto("/");

  // pricing is hidden on the public page (Ayaan, 2026-10-13)
  await expect(page.locator("main")).not.toContainText(/pricing|per month|per location/i);
  await expect(page.getByRole("heading", { name: "Founding merchants" })).toHaveCount(0);

  // F13: the section links stay on screen at phone width too
  const nav = page.getByRole("navigation", { name: "Sections" });
  for (const name of ["How it works", "For owners", "FAQ"])
    await expect(nav.getByRole("link", { name })).toBeInViewport();

  // F5: always a next step after the demo, and no made-up address
  const hero = page.locator("main section").first();
  await expect(hero.getByRole("link", { name: "See the live demo" })).toHaveAttribute("href", "/demo");
  await expect(page.getByRole("link", { name: "Book a call" })).toHaveCount(0);
  const pilot = hero.getByRole("link", { name: "Ask us about a pilot" });
  await expect(pilot).toHaveAttribute("href", "/demo#contact");
  await pilot.click();
  await page.waitForURL("**/demo#contact");
  await expect(page.locator("#contact")).toContainText("ask the person who shared this page with you");
  await expect(page.locator("main")).not.toContainText(/pricing|per month/i);
});

test("demo terminal: dims rewards it can't cover and refuses an over-limit bill, like /scan", async ({ page }) => {
  const retail = SAMPLES.find((m) => m.key === "retail")!;
  await page.goto("/demo");
  await page.getByRole("button", { name: /Retail/ }).click();
  const counter = page.getByRole("region", { name: "Counter terminal" });
  await expect(counter.locator(".balance")).toHaveText(String(retail.startPoints));

  // F17: a reward the balance can't cover is disabled and says what's missing
  const fiveOff = counter.getByRole("button", { name: /\$5 Off/ });
  await expect(fiveOff).toBeDisabled();
  await expect(fiveOff).toContainText(`needs 500 · has ${retail.startPoints}`);
  await expect(counter.getByRole("button", { name: /Priority Service/ })).toBeEnabled();

  // F17: a too-large bill gets the shop-limit message, not "enter an amount"
  await counter.locator("#demo-bill").fill("100000");
  await counter.getByRole("button", { name: "Add", exact: true }).click();
  await expect(counter.locator(".toast.bad")).toHaveText(/^Bill is over this shop's limit of \$1,000\.00/);
  await expect(counter.locator(".balance")).toHaveText(String(retail.startPoints));
});
