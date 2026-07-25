// P0.3: files that ESLint used to skip entirely are linted again. An ignore
// entry is invisible in a green `pnpm lint`, so it needs its own assertion.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: root });

test("ESLint covers the packaging config and the website sources", async () => {
  for (const file of [
    "forge.config.ts",
    "apps/website/nuxt.config.ts",
    "apps/website/app/composables/useTracking.ts",
  ]) {
    assert.equal(
      await eslint.isPathIgnored(path.join(root, file)),
      false,
      `${file} is excluded from linting`,
    );
  }
});

test("ESLint still skips derived output and developer-only tooling", async () => {
  for (const file of ["build/main/main.js", "out/anything.js", "tools/gw.py"]) {
    assert.equal(
      await eslint.isPathIgnored(path.join(root, file)),
      true,
      `${file} should stay ignored`,
    );
  }
});
