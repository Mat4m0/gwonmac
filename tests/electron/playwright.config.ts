import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./global-setup.ts",
  timeout: 30_000,
  workers: 1,
  ...(process.env.CI ? { maxFailures: 1 } : {}),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["line"]] : "list",
  use: {
    trace: process.env.CI ? "on-first-retry" : "off",
  },
});
