import { defineConfig } from "@playwright/test";

export default defineConfig({
  // A suite may clear only its own output, never other local evidence or profiles.
  outputDir: "../../test-results/electron",
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./global-setup.ts",
  // Every game launch runs the full local client check (3-4.5 s on an M-series
  // Mac, several times that on a loaded CI runner), and some specs launch twice.
  timeout: 60_000,
  workers: 1,
  ...(process.env.CI ? { maxFailures: 1 } : {}),
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["line"]] : "list",
  use: {
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
});
