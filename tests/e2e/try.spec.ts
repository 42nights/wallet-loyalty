import { test, expect, fx } from "./helpers";

// /try/<slug>: a demo merchant's card simulated in the browser. Nothing is
// written, so both projects share one fixture shop (goal 5, "Free latte").
test("try page: stamps add up, the reward unlocks at the goal, unknown slugs 404", async ({ page }) => {
  await page.goto(`/try/${fx.tryDemo.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fx.tryDemo.name);

  const balance = page.locator(".balance");
  const card = page.getByRole("img", { name: /loyalty card in Apple Wallet/ });
  const reward = page.getByRole("button", { name: /Free latte/ });
  await expect(balance).toHaveText("1"); // the sample customer starts 4 short of the goal
  await expect(reward).toBeDisabled();
  await expect(reward).toContainText("needs 5 · has 1");

  await page.getByRole("button", { name: "+1 stamp", exact: true }).click();
  await expect(balance).toHaveText("2");
  await page.getByRole("button", { name: "+3 stamps", exact: true }).click();
  await expect(balance).toHaveText("5");
  await expect(card).toHaveAccessibleName(/5 of 5 stamps/); // the phone's card catches up
  await expect(reward).toBeEnabled();

  await reward.click();
  await expect(balance).toHaveText("0");
  await expect(page.locator(".toast.ok")).toContainText("Free latte redeemed");

  expect((await page.goto("/try/no-such-shop-demo"))?.status()).toBe(404);
  expect((await page.goto(`/try/${fx.slug}`))?.status()).toBe(404); // a live shop, not a demo
});
