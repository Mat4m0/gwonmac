import { defineConfig } from "@playwright/test";
import stable from "./playwright.config.js";

const shared = { ...stable };
delete shared.testIgnore;

export default defineConfig({
  ...shared,
  testMatch: /faults\/.*\.spec\.ts$/,
  maxFailures: 1,
  workers: 1,
});
