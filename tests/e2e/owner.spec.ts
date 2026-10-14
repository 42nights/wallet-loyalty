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
