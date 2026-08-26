import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./global-setup.ts",
  timeout: 30_000,
  workers: 1,
  ...(process.env.CI ? { maxFailures: 1 } : {}),
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["line"]] : "list",
  use: {
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
});
