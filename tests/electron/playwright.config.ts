import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { developmentElectronExecutable } from "../../scripts/electron-layout.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const requiredInputs = [
  path.join(root, "build/main/main.js"),
  path.join(root, "build/preload/preload.cjs"),
  path.join(root, "build/renderer/index.html"),
  developmentElectronExecutable(root),
];
const missingInputs = requiredInputs.filter((input) => !existsSync(input));
if (missingInputs.length > 0) {
  throw new Error(
    [
      "Electron test prerequisites are missing; run pnpm build after pnpm install.",
      ...missingInputs.map((input) => `- ${path.relative(root, input)}`),
    ].join("\n"),
  );
}

export default defineConfig({
  testDir: ".",
  outputDir: path.join(root, "test-results/electron-stable"),
  testMatch: /.*\.spec\.ts$/,
  testIgnore: /faults\/.*\.spec\.ts$/,
  reporter: "list",
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Stop at the first native failure. Continuing after an Electron worker has
  // lost its process produces teardown cascades that hide the owning assertion.
  maxFailures: process.env.CI ? 1 : 0,
  workers: 1,
});
