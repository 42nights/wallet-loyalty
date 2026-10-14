import { REDEEM_TEMPLATES } from "../../src/lib/config";
import { test, expect, fx, field } from "./helpers";

test("cashier: login → /scan → manual serial → earn by bill → template buttons", async ({ page }, info) => {
  const card = fx.scanCards[info.project.name];

  await page.goto("/login");
  await field(page, "Username").fill(fx.cashier.username);
  await field(page, "Password").fill(fx.cashier.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/scan");

  // no camera in the test browser → the manual serial path
  await page.getByPlaceholder("serial…").fill(card.serial);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.getByText(card.name)).toBeVisible();
  await expect(page.locator(".balance")).toHaveText("0");

  // earn_rate 10: $12.50 → 125 points, previewed then applied
  await page.getByPlaceholder("bill amount").fill("12.5");
  await expect(page.getByText("= 125 pts (10× rate)")).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".balance")).toHaveText("125");
  await expect(page.locator(".toast.ok")).toHaveText("+125 pts");

  // the fixture merchant is on the cafe template: its 4 buttons, nobody else's
  for (const a of REDEEM_TEMPLATES.cafe.actions)
    await expect(page.getByRole("button", { name: a.label })).toBeVisible();
  for (const a of REDEEM_TEMPLATES.restaurant.actions)
    await expect(page.getByRole("button", { name: a.label })).toHaveCount(0);

  // and a button actually redeems: Extra Shot = 80
  await page.getByRole("button", { name: "Extra Shot" }).click();
  await expect(page.locator(".balance")).toHaveText("45");
  await expect(page.locator(".toast.ok")).toHaveText("Extra Shot redeemed");
});
