import { test, expect, fx, apiLogin } from "./helpers";

test("stamp card cashier: +1 / +3 stamps, undo, reward unlocks at the goal", async ({ page }, info) => {
  const card = fx.stamps.cards[info.project.name];
  await apiLogin(page, fx.stamps.cashier);
  await page.goto("/scan");
  await page.getByPlaceholder("serial…").fill(card.serial);
  await page.getByPlaceholder("serial…").press("Enter");
  await expect(page.getByText(card.name)).toBeVisible();
  const balance = page.locator(".balance");
  await expect(balance).toHaveText("0");
  await expect(page.getByText("of 5 stamps")).toBeVisible();

  // no bill box on a stamp card, and none of the points template's buttons
  await expect(page.getByPlaceholder("bill amount")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Free Coffee/ })).toHaveCount(0);

  // the one reward is dimmed until the card is full
  const reward = page.getByRole("button", { name: /Free latte/ });
  await expect(reward).toBeDisabled();
  await expect(reward).toContainText("needs 5 · has 0");

  const toast = page.locator(".toast.ok");
  await page.getByRole("button", { name: "+1 stamp", exact: true }).click();
  await expect(balance).toHaveText("1");
  await expect(toast).toContainText("+1 stamp");

  // a mis-tap of +3 is taken back with Undo
  await page.getByRole("button", { name: "+3 stamps", exact: true }).click();
  await expect(balance).toHaveText("4");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(balance).toHaveText("1");
  await expect(toast).toHaveText("Undone: +3 stamps");

  await page.getByRole("button", { name: "+2 stamps", exact: true }).click();
  await expect(balance).toHaveText("3");
  await page.getByRole("button", { name: "+2 stamps", exact: true }).click();
  await expect(balance).toHaveText("5");
  await expect(reward).toBeEnabled();
  await reward.click();
  await expect(balance).toHaveText("0");
  await expect(toast).toContainText("Free latte redeemed");
  await expect(reward).toContainText("needs 5 · has 0");
});
