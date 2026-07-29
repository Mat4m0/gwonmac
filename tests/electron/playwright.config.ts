import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  // Native CI occasionally loses an Electron process or main-process
  // execution context while creating and destroying real OS windows. Retry
  // once in a fresh worker; deterministic failures still fail the gate twice,
  // while local development remains fail-fast.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
});
