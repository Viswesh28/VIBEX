import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: process.env.VIBEX_TEST_URL || "http://127.0.0.1:8000",
    headless: true,
    launchOptions: { args: ["--no-sandbox"] },
    viewport: { width: 393, height: 851 },
  },
  reporter: "list",
  outputDir: ".cache/test-results",
});
