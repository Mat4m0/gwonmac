import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  reporter: "list",
  timeout: 60_000,
  // Stop at the first native failure. Continuing after an Electron worker has
  // lost its process produces teardown cascades that hide the owning assertion.
  maxFailures: process.env.CI ? 1 : 0,
  workers: 1,
});
