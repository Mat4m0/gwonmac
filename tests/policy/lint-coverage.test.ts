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

test("ESLint covers the packaging config and representative app sources", async () => {
  for (const file of [
    "forge.config.ts",
    "apps/website/nuxt.config.ts",
    "apps/website/app/composables/useTracking.ts",
    "apps/website/app/pages/index.vue",
    "apps/tools/vite.config.ts",
    "apps/tools/src/ToolsApp.vue",
  ]) {
    assert.equal(
      await eslint.isPathIgnored(path.join(root, file)),
      false,
      `${file} is excluded from linting`,
    );
  }
});

test("every app .vue source is linted, not just the ones named above", async () => {
  // P0.3 resolved: vue-eslint-parser and eslint-plugin-vue are installed, so the
  // SFCs are parsed. This enumerates them from git rather than a literal list,
  // because a new page added outside the config's glob would otherwise be
  // unlinted and invisible in a green `pnpm lint`.
  const sfcs = execFileSync("git", ["ls-files", "--", "apps/**/*.vue"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  assert.ok(sfcs.length > 0, "expected the apps to still have .vue sources");
  for (const file of sfcs) {
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
