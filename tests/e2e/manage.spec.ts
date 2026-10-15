import { test, expect, fx } from "./helpers";

// The creator's "Manage as owner": from the /admin merchant page into that
// shop's owner dashboard as its 42nights support login, and back. Both
// projects use the same shop; the second one's click reuses the row.
test("admin: Manage as owner opens the shop's dashboard under a 42nights support banner", async ({ page }) => {
  const r = await page.request.post("/api/admin/login", { data: { password: process.env.E2E_ADMIN_PW } });
  expect(r.status()).toBe(200);
  await page.goto(`/admin/merchants/${fx.merchantId}`);
  await page.getByRole("button", { name: "Manage as owner" }).click();
  await page.waitForURL("**/dashboard");

  const banner = page.getByRole("note");
  await expect(banner).toContainText(`42nights support — managing Test e2e ${fx.run}`);
  await expect(page.locator(".kpi").filter({ has: page.locator(".k", { hasText: /^Customers$/ }) })).toBeVisible(); // the owner's dashboard
  await expect(page.locator(".staff-user")).toHaveText(`42nights-${fx.slug}`);

  // the admin cookie survived the switch
  await banner.getByRole("link", { name: "Back to admin" }).click();
  await page.waitForURL(`**/admin/merchants/${fx.merchantId}`);
  await expect(page.getByRole("button", { name: "Manage as owner" })).toBeVisible();
});
