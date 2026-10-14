import type { Page } from "@playwright/test";
import { test, expect, fx, field } from "./helpers";

// Enrollment: POST /api/enroll returns { cardUrl } (a signed 1-hour link); the
// page then either opens that link (Apple devices → Wallet sheet / download) or
// shows it as a QR (everything else), or asks in-app browsers to open Safari.

async function submitEnroll(page: Page, name: string) {
  await page.goto(`/enroll/${fx.slug}`);
  await expect(page.getByText("Get your loyalty card in Apple Wallet")).toBeVisible();
  await field(page, "Name").fill(name);
  await field(page, "Phone").fill("+1555" + Math.floor(1e6 + Math.random() * 9e6));
  const enrolled = page.waitForResponse(
    (r) => r.url().endsWith("/api/enroll") && r.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Get my card" }).click();
  return enrolled;
}

test("enrolling returns a signed card link that serves the .pkpass", async ({ page, request }, info) => {
  const res = await submitEnroll(page, `Enroll ${info.project.name}`);
  expect(res.status()).toBe(200);
  const { cardUrl } = await res.json();
  expect(cardUrl).toContain("/api/enroll?card=");

  const card = await request.get(cardUrl);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("application/vnd.apple.pkpass");
  expect(card.headers()["content-disposition"]).toMatch(/filename="loyalty-[\w-]+\.pkpass"/);
  const zip = await card.body(); // the signed pass bundle: a zip holding pass.json
  expect(zip.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
  expect(zip.includes("pass.json")).toBe(true);
});

test("iPhone opens the card in Wallet and shows the ready screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Apple-device flow");
  const download = page.waitForEvent("download"); // Chromium's stand-in for the Wallet sheet
  await submitEnroll(page, "Enroll iPhone");
  expect((await download).suggestedFilename()).toMatch(/^loyalty-[\w-]+\.pkpass$/);
  await expect(page.getByText("Your card is ready")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open my card again" })).toBeVisible();
});

test("other devices get a QR to open the card on an iPhone", async ({ page, isMobile }) => {
  test.skip(isMobile, "non-Apple flow");
  await submitEnroll(page, "Enroll desktop");
  await expect(page.getByText("Now add it on your iPhone")).toBeVisible();
  await expect(page.getByAltText("QR code that opens your card in Apple Wallet on an iPhone")).toBeVisible();
});

test("empty form shows inline errors and sends nothing", async ({ page }) => {
  await page.goto(`/enroll/${fx.slug}`);
  let posted = false;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/enroll") && r.method() === "POST") posted = true;
  });
  await page.getByRole("button", { name: "Get my card" }).click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await expect(page.getByText("Enter your phone number.")).toBeVisible();
  expect(posted).toBe(false);
});

test.describe("inside Instagram's in-app browser", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0",
  });

  test("asks to open Safari instead of a dead Wallet download", async ({ page }) => {
    await submitEnroll(page, "Enroll Instagram");
    await expect(page.getByText("Open your card in Safari")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy my card link" })).toBeVisible();
  });
});
