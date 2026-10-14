import { defineConfig, devices } from "@playwright/test";

// End-to-end suite (npm run test:e2e). Starts its own `next dev` on :3191 and
// runs every spec on a desktop and an iPhone viewport. Fixture merchant/staff/
// cards come from tests/e2e/global-setup.mjs (own fixtures, cleaned up after).
const PORT = 3191;
const BASE = `http://localhost:${PORT}`;
// One id per run, set in the main process and inherited by the workers; global
// setup tags its fixtures with it and cleanup deletes everything carrying it.
process.env.E2E_RUN ??= Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  globalSetup: "./tests/e2e/global-setup.mjs",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    navigationTimeout: 45_000, // first hit of a route compiles it in dev
    // A per-run client IP keeps the IP-keyed enroll rate limit (20/min) from
    // being shared with other suites hitting the same local Postgres.
    extraHTTPHeaders: { "x-forwarded-for": `e2e-${process.env.E2E_RUN}` },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // iPhone 13 viewport, UA, touch and DPR — on Chromium, the browser installed
      // for this repo (the descriptor defaults to WebKit).
      name: "iphone-13",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${BASE}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      APNS_HOST: "https://127.0.0.1:9", // nothing listens: no push can ever leave the machine
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      PUBLIC_BASE_URL: BASE,
    },
  },
});
