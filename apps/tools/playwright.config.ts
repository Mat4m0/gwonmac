import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 20_000,
  fullyParallel: true,
  ...(process.env.CI ? { maxFailures: 1 } : {}),
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: "http://127.0.0.1:4179",
    colorScheme: "dark",
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4179",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
