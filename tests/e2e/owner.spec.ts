import { test, expect, fx, apiLogin } from "./helpers";
import { formatPhone } from "../../src/lib/format";

test("owner /dashboard renders the KPI row", async ({ page }) => {
  await apiLogin(page, fx.owner);
  await page.goto("/dashboard");
  for (const k of ["Members", "Active · 30d", "Points issued", "Points redeemed", "Repeat rate"])
    await expect(page.locator(".kpi", { hasText: k })).toBeVisible();
  // global setup created 3 cards for this merchant (enroll.spec may add more)
  const members = await page.locator(".kpi", { hasText: "Members" }).locator(".v").innerText();
  expect(Number(members)).toBeGreaterThanOrEqual(3);
});

test("owner /customers search finds a customer by name and by phone", async ({ page }) => {
  const c = fx.searchCard;
  await apiLogin(page, fx.owner);
  await page.goto("/customers");
  const search = page.getByPlaceholder("search name / phone…");
  const row = page.locator(`a[href="/customers/${c.serial}"]`);

  await search.fill(c.name);
  await expect(row).toContainText(c.name);
  await expect(page.getByText("1 member", { exact: true })).toBeVisible();

  // stored "+1555…", shown to staff as "(555) …-…" (F7)
  await search.fill(c.phone!);
  await expect(row).toContainText(formatPhone(c.phone));

  await row.click();
  await page.waitForURL(`**/customers/${c.serial}`);
  await expect(page.getByText(c.name)).toBeVisible();
  await expect(page.getByText(`points · ${formatPhone(c.phone)}`)).toBeVisible();
});

test("cashier opening /dashboard is redirected to /scan?denied=1", async ({ page }) => {
  await apiLogin(page, fx.cashier);
  await page.goto("/dashboard");
  // denied=1 lets /scan tell the cashier why they landed there
  await expect(page).toHaveURL(/\/scan\?denied=1$/);
});

test("logged-out /dashboard is redirected to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("owner: Enter in the new-tag box makes the tag and tags this customer", async ({ page }, info) => {
  const label = `e2e-${info.project.name}`;
  await apiLogin(page, fx.owner);
  await page.goto(`/customers/${fx.searchCard.serial}`);
  await page.getByPlaceholder("new tag…").fill(label);
  await page.getByPlaceholder("new tag…").press("Enter");
  await expect(page.getByRole("button", { name: `${label} ✕` })).toBeVisible();
  await expect(page.getByPlaceholder("new tag…")).toHaveValue("");
});

test("owner deactivates a card with a reason, /scan shows it deactivated, then reactivates it", async ({ page }, info) => {
  const card = fx.voidCards[info.project.name];
  await apiLogin(page, fx.owner);
  await page.goto(`/customers/${card.serial}`);
  await page.getByRole("button", { name: "Deactivate card" }).click();
  const yes = page.getByRole("button", { name: "Yes, deactivate" });
  await expect(yes).toBeDisabled(); // a reason is required
  await page.getByRole("radio", { name: "Customer asked" }).click();
  await yes.click();
  await expect(page.getByText("Card deactivated", { exact: true })).toBeVisible();
  await expect(page.getByText(/Customer asked\. No points can be added or used/)).toBeVisible();
  // nothing left on the page that would change the balance or re-send the card
  await expect(page.getByLabel("Points to add or remove")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send card to phone" })).toHaveCount(0);

  // the counter sees it as deactivated: no rewards, no bill box
  await page.goto("/scan");
  await page.getByPlaceholder("serial…").fill(card.serial);
  await page.getByPlaceholder("serial…").press("Enter");
  await expect(page.getByText("This card is deactivated.")).toBeVisible();
  await expect(page.getByPlaceholder("bill amount")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Free Coffee/ })).toHaveCount(0);

  await page.goto(`/customers/${card.serial}`);
  await page.getByRole("button", { name: "Reactivate card" }).click();
  await expect(page.getByRole("button", { name: "Deactivate card" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send card to phone" })).toBeVisible();
});

test("owner removes a cashier through an inline confirm that names them", async ({ page }, info) => {
  const username = `t-${fx.run}-rm-${info.project.name}`;
  await apiLogin(page, fx.owner);
  expect((await page.request.post("/api/merchant/staff", { data: { username, password: `pw-${fx.run}` } })).status()).toBe(200);
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await page.goto("/staff");
  const name = page.getByText(username, { exact: true });
  const member = page.locator(".card.stack > div").filter({ has: name });
  const confirm = member.locator(".confirm");

  await member.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(confirm).toContainText(`Remove ${username}? They will be signed out and can no longer use /scan.`);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(name).toBeVisible();

  await member.getByRole("button", { name: "Remove", exact: true }).click();
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText(`Removed ${username}.`)).toBeVisible();
  await expect(name).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
