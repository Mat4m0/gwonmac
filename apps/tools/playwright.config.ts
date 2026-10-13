import { defineConfig } from "@playwright/test";

// HUB_E2E_PORT lets parallel runs (one per worker) use their own fixture server.
const port = process.env.HUB_E2E_PORT ?? "4179";

export default defineConfig({
  // A suite may clear only its own output, never other local evidence or profiles.
  outputDir: "../../test-results/tools-e2e",
  testDir: "./tests",
  timeout: 20_000,
  // Timing budgets need one browser worker without competing test workloads.
  workers: 1,
  fullyParallel: true,
  ...(process.env.CI ? { maxFailures: 1 } : {}),
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    colorScheme: "dark",
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
