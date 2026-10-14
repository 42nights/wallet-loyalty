import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, fx, field } from "./helpers";

async function submitEnroll(page: Page, name: string) {
  await page.goto(`/enroll/${fx.slug}`);
  await expect(page.getByText("Get your loyalty card in Apple Wallet")).toBeVisible();
  await field(page, "Name").fill(name);
  await field(page, "Phone").fill("+1555" + Math.floor(1e6 + Math.random() * 9e6));
  const enrolled = page.waitForResponse(
    (r) => r.url().endsWith("/api/enroll") && r.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Add to Apple Wallet" }).click();
  return enrolled;
}

test("enroll form renders and submitting returns a .pkpass", async ({ page, isMobile }, info) => {
  // The form turns the response into a blob and navigates to it: on desktop
  // Chromium that is a file download.
  const download = isMobile ? null : page.waitForEvent("download");
  const res = await submitEnroll(page, `Enroll ${info.project.name}`);

  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/vnd.apple.pkpass");
  expect(res.headers()["content-disposition"]).toMatch(/filename="loyalty-[\w-]+\.pkpass"/);
  if (download) {
    // the downloaded file is the signed pass bundle (a zip holding pass.json)
    const file = readFileSync((await (await download).path())!);
    expect(file.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
    expect(file.includes("pass.json")).toBe(true);
  }
});

test("desktop download is saved with a .pkpass filename", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop download behaviour only");
  // KNOWN BUG (reported, src/ not owned by the test lane): EnrollForm navigates
  // to a blob: URL, which drops the response's Content-Disposition filename, so
  // Chromium saves the card as "<blob-uuid>" with no extension. When EnrollForm
  // is fixed this test starts passing and test.fail() turns it red — delete the
  // test.fail line then.
  test.fail(true, "EnrollForm blob: navigation loses the .pkpass filename");
  const download = page.waitForEvent("download");
  await submitEnroll(page, "Enroll filename");
  expect((await download).suggestedFilename()).toMatch(/\.pkpass$/);
});
