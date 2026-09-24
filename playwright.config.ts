import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const port = process.env.PLAYWRIGHT_PORT;
if (!baseURL || !port || !process.env.DATABASE_URL) throw new Error("Use npm run test:keyboard to run Playwright with an isolated database");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL, channel: "chrome", trace: "retain-on-failure" },
  webServer: { command: `npm run dev -- --webpack -p ${port}`, url: baseURL, reuseExistingServer: false, timeout: 120_000 },
});
