// P0.3: files that ESLint used to skip entirely are linted again. An ignore
// entry is invisible in a green `pnpm lint`, so it needs its own assertion.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: root });

test("ESLint covers the packaging config and the website TypeScript sources", async () => {
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

test("the website .vue sources are still unlinted, which P0.3 deferred", async () => {
  // Not an approval: a green suite must not read as coverage the repository
  // does not have. `vue-eslint-parser` and `eslint-plugin-vue` are absent, and
  // the TypeScript parser fails on every SFC. When that decision is taken this
  // test goes red and forces the claim above to be widened.
  const sfcs = execFileSync("git", ["ls-files", "--", "apps/website/**/*.vue"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  assert.ok(sfcs.length > 0, "expected the website to still have .vue sources");
  for (const file of sfcs) {
    assert.equal(
      await eslint.isPathIgnored(path.join(root, file)),
      true,
      `${file} is linted now — widen the coverage assertion above`,
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
