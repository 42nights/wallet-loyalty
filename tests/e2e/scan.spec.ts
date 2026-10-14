import { REDEEM_TEMPLATES } from "../../src/lib/config";
import { test, expect, fx, apiLogin } from "./helpers";

test("cashier: login → /scan → manual serial → earn by bill → template buttons", async ({ page }, info) => {
  const card = fx.scanCards[info.project.name];
  // a controllable clock (time still flows) so the 10 s Undo window can be skipped
  await page.clock.install();

  await page.goto("/login");
  // by accessible name: the login fields are real <label>s (F12)
  await page.getByLabel("Username", { exact: true }).fill(fx.cashier.username);
  await page.getByLabel("Password", { exact: true }).fill(fx.cashier.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/scan");

  // no camera in the test browser: the page says so and points at the lookups
  await expect(page.getByText("Camera unavailable — allow camera access, or find the customer below")).toBeVisible();

  // the manual serial path; Enter submits it (the Go button is the same form)
  await page.getByPlaceholder("serial…").fill(card.serial);
  await page.getByPlaceholder("serial…").press("Enter");
  await expect(page.getByText(card.name)).toBeVisible();
  await expect(page.locator(".balance")).toHaveText("0");

  // 0 points: every reward is dimmed, unclickable, and says what's missing
  const coffee = page.getByRole("button", { name: /Free Coffee/ });
  await expect(coffee).toBeDisabled();
  await expect(coffee).toContainText("needs 300 · has 0");

  // junk input: an inline hint, no request, no toast
  const bill = page.getByPlaceholder("bill amount");
  const add = page.getByRole("button", { name: "Add", exact: true });
  await bill.fill("abc");
  await add.click();
  await expect(page.getByText("Enter an amount like 12.50")).toBeVisible();
  await expect(page.locator(".balance")).toHaveText("0");

  // earn_rate 10: "12,50" is 12.50 → 125 points, previewed then applied
  await bill.fill("12,50");
  await expect(page.getByText("Enter an amount like 12.50")).toHaveCount(0);
  await expect(page.getByText("= 125 pts (10× rate)")).toBeVisible();
  await add.click();
  await expect(page.locator(".balance")).toHaveText("125");
  const toast = page.locator(".toast.ok");
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(toast).toContainText("+125 pts");
  await expect(undo).toBeVisible();
  // the bill is cleared so a second tap can't credit it again
  await expect(bill).toHaveValue("");

  // the fixture merchant is on the cafe template: its 4 buttons, nobody else's
  for (const a of REDEEM_TEMPLATES.cafe.actions)
    await expect(page.getByRole("button", { name: a.label })).toBeVisible();
  for (const a of REDEEM_TEMPLATES.restaurant.actions)
    await expect(page.getByRole("button", { name: a.label })).toHaveCount(0);
  await expect(coffee).toContainText("needs 300 · has 125");

  // and a button actually redeems: Extra Shot = 80
  await page.getByRole("button", { name: "Extra Shot" }).click();
  await expect(page.locator(".balance")).toHaveText("45");
  await expect(toast).toContainText("Extra Shot redeemed");
  // Undo is offered for 10 s, then the toast stays without it
  await expect(undo).toBeVisible();
  await page.clock.fastForward(10_000);
  await expect(undo).toHaveCount(0);
  await expect(toast).toHaveText("Extra Shot redeemed");

  // a bill over the shop's cap (default $1,000.00): said inline as it's typed,
  // and no points preview the server would refuse
  await bill.fill("5000");
  await expect(page.getByText("Over this shop's limit of $1,000.00", { exact: false })).toBeVisible();
  await expect(page.getByText(/= 50000 pts/)).toHaveCount(0);
  await bill.fill("");
  await expect(page.getByText(/Over this shop's limit/)).toHaveCount(0);

  // a big bill (half the default 1000 cap or more) asks first and credits nothing
  await bill.fill("600");
  await add.click();
  await expect(page.getByText("Big bill: $600.00 will credit +6000 pts. Is that right?")).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0); // the old "redeemed" toast is gone
  await expect(page.locator(".balance")).toHaveText("45");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/Big bill/)).toHaveCount(0);
  await expect(page.locator(".balance")).toHaveText("45");
  await add.click();
  await page.getByRole("button", { name: "Add +6000 pts" }).click();
  await expect(page.locator(".balance")).toHaveText("6045");
  await expect(toast).toContainText("+6000 pts");
  await expect(coffee).toBeEnabled();

  // a mis-tapped bill is taken back with Undo, once
  await undo.click();
  await expect(page.locator(".balance")).toHaveText("45");
  await expect(toast).toHaveText("Undone: +6000 pts");
  await expect(undo).toHaveCount(0);
  await expect(coffee).toContainText("needs 300 · has 45");
});

test("owner sets a happy hour in /settings → /scan shows it and earns double", async ({ page }, info) => {
  const h = fx.happy[info.project.name];
  // today on the merchant's clock (the default zone); a run across local
  // midnight, or at 23:59, falls outside the window — rerun
  const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(new Date());

  await apiLogin(page, h.owner);
  await page.goto("/settings");
  await page.getByRole("button", { name: "2× points" }).click();
  await page.getByRole("checkbox", { name: today, exact: true }).check();
  await page.getByLabel("From").fill("00:00");
  await page.getByLabel("Until").fill("23:59");
  await expect(page.getByText(/Cards will say 2× points .*12 am–11:59 pm/)).toBeVisible();
  await page.getByRole("button", { name: "Save happy hour" }).click();
  await expect(page.locator(".toast.ok")).toContainText("Happy hour saved: 2× points");

  await apiLogin(page, h.cashier);
  await page.goto("/scan");
  await expect(page.getByText("Happy hour 2× points")).toBeVisible();
  await page.getByPlaceholder("serial…").fill(h.card.serial);
  await page.getByPlaceholder("serial…").press("Enter");
  await expect(page.getByText("Happy hour 2× points")).toBeVisible();
  await page.getByPlaceholder("bill amount").fill("10");
  await expect(page.getByText("= 200 pts (10× rate, happy hour 2×)")).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".balance")).toHaveText("200");
  await expect(page.locator(".toast.ok")).toContainText("+200 pts");
});

test("cashier sent back from an owner page sees why", async ({ page }) => {
  await apiLogin(page, fx.cashier);
  await page.goto("/scan?denied=1");
  await expect(page.locator(".toast.bad")).toHaveText("That page is for owners");
});
