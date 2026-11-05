import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the web build in a browser (docs/testing.md): the Vite
 * dev server serves fake.html, where src/lib/platform/fake stands in for the
 * native shell, so no Rust, add-on, account or network is involved.
 *
 * POLAR_E2E_CHROMIUM=<path> runs the Chromium projects with that browser
 * instead of Playwright's own download (and leaves WebKit out), for machines
 * where `playwright install` can't fetch browsers.
 */
const chromium = process.env.POLAR_E2E_CHROMIUM;
const PORT = 5199;
const launchOptions = chromium ? { executablePath: chromium, args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server"] } : {};

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions,
  },
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/fake.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop", testIgnore: /(tv|phone)\.spec/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", testMatch: /phone\.spec/, use: { ...devices["Pixel 7"] } },
    { name: "tv", testMatch: /tv\.spec/, use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
    ...(chromium
      ? []
      : [{ name: "desktop-webkit", testIgnore: /(tv|phone)\.spec/, use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } }]),
  ],
});
