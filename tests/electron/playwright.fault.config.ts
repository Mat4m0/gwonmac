import { defineConfig } from "@playwright/test";
import path from "node:path";
import stable from "./playwright.config.js";

const shared = { ...stable };
delete shared.testIgnore;

export default defineConfig({
  ...shared,
  outputDir: path.join(process.cwd(), "test-results/electron-fault"),
  testMatch: /faults\/.*\.spec\.ts$/,
  reporter: [
    ["list"],
    [
      "./closed-reporter.ts",
      {
        outputFile: path.join(
          process.cwd(),
          "test-results/electron-fault/summary.json",
        ),
      },
    ],
  ],
  maxFailures: 1,
  workers: 1,
});
