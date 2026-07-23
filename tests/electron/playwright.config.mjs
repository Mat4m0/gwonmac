import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs/,
  timeout: 30_000,
  workers: 1,
});
