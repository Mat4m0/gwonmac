// Architecture policy, executed rather than asserted about: run the
// repository's real ESLint config over source that crosses each boundary
// eslint.config.js pins, and check the crossing is actually rejected. Every
// probe spells the crossing a different way, because one file has more than one
// name: `../paths.js`, `../../main/paths.js` and `../../../src/main/paths.js`
// all resolve to src/main/paths.ts.
//
// Every boundary is executed, including the nine apps/website `.vue` SFCs:
// P0.3 added vue-eslint-parser, so the rule runs on them rather than a weaker
// text scan standing in for it.
//
// The only override is turning off typescript-eslint's project service, which
// otherwise refuses a path that has no file behind it. The boundary rules
// (no-restricted-imports, no-restricted-syntax) are purely syntactic, so
// nothing under test depends on type information — and this keeps the test from
// writing throwaway files into src/.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      files: ["**/*.ts"],
      languageOptions: { parserOptions: { projectService: false, project: false } },
    },
  ],
});

const BOUNDARY_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

const REJECTED = [
  {
    what: "src/main/core imports electron",
    file: "src/main/core/probe.ts",
    source: 'import { app } from "electron";\nexport const probe = app;\n',
  },
  {
    what: "src/main/core type-imports electron",
    file: "src/main/core/probe.ts",
    source: 'import type { App } from "electron";\nexport type Probe = App;\n',
  },
  {
    what: "src/main/core dynamically imports electron",
    file: "src/main/core/probe.ts",
    source: 'export const probe = async () => import("electron");\n',
  },
  {
    what: "src/main/core imports a submodule of electron",
    file: "src/main/core/probe.ts",
    source: 'import { app } from "electron/main";\nexport const probe = app;\n',
  },
  {
    what: "src/main/core requires electron through createRequire",
    file: "src/main/core/probe.ts",
    source:
      'import { createRequire } from "node:module";\nexport const probe = createRequire(import.meta.url)("electron");\n',
  },
  {
    what: "src/main/core requires electron through an aliased createRequire binding",
    // The rule used to key on the callee, so `createRequire(url)("electron")`
    // and the binding literally named `require` were rejected while any other
    // name for the same function was not.
    file: "src/main/core/probe.ts",
    source:
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const probe = load("electron");\n',
  },
  {
    what: "src/main/core dynamically imports electron, spelled with a template literal",
    file: "src/main/core/probe.ts",
    source: "export const probe = async () => import(`electron`);\n",
  },
  {
    what: "src/main/core imports upward from src/main",
    file: "src/main/core/probe.ts",
    source:
      'import { userDataDir } from "../paths.js";\nexport const probe = userDataDir;\n',
  },
  {
    what: "src/main/core imports upward from src/main, spelled through src/main",
    file: "src/main/core/probe.ts",
    source:
      'import { userDataDir } from "../../main/paths.js";\nexport const probe = userDataDir;\n',
  },
  {
    what: "src/main/core imports upward from src/main, spelled from the repository root",
    file: "src/main/core/probe.ts",
    source:
      'import { userDataDir } from "../../../src/main/paths.js";\nexport const probe = userDataDir;\n',
  },
  {
    what: "a subdirectory of src/main/core imports upward from src/main",
    file: "src/main/core/sub/probe.ts",
    source:
      'import { userDataDir } from "../../paths.js";\nexport const probe = userDataDir;\n',
  },
  {
    what: "src/main/core imports upward through a subdirectory of src/main",
    // src/main has no subdirectory but core today. The rule pins "does not
    // climb out of core", not "does not name one of today's files", so the day
    // src/main/services/ appears this must already be rejected.
    file: "src/main/core/probe.ts",
    source:
      'import { registry } from "../services/registry.js";\nexport const probe = registry;\n',
  },
  {
    what: "src/main/core dynamically imports upward from src/main",
    file: "src/main/core/probe.ts",
    source: 'export const probe = async () => import("../paths.js");\n',
  },
  {
    what: "src/main/core dynamically imports upward through a subdirectory of src/main",
    file: "src/main/core/probe.ts",
    source: 'export const probe = async () => import("../services/registry.js");\n',
  },
  {
    what: "src/main/core dynamically imports upward, spelled through src/main",
    file: "src/main/core/probe.ts",
    source: 'export const probe = async () => import("../../main/paths.js");\n',
  },
  {
    what: "src/main/core dynamically imports upward, spelled with a template literal",
    file: "src/main/core/probe.ts",
    source: "export const probe = async () => import(`../paths.js`);\n",
  },
  {
    what: "src/main/core requires upward through createRequire",
    // The require-flavoured selectors were wired to the Electron pattern only,
    // so this crossing was reported by nothing but an unrelated stylistic rule.
    file: "src/main/core/probe.ts",
    source:
      'import { createRequire } from "node:module";\nexport const probe = createRequire(import.meta.url)("../paths.js");\n',
  },
  {
    what: "src/main/core imports one level up into a sibling of src/main/core named shared",
    // src/shared is `../../shared/` from core and deeper from its
    // subdirectories. A single `../shared/` is src/main/shared — upward.
    file: "src/main/core/probe.ts",
    source: 'import { log } from "../shared/log.js";\nexport const probe = log;\n',
  },
  {
    what: "src/renderer imports src/main",
    file: "src/renderer/probe.js",
    source:
      'import { userDataDir } from "../main/paths.js";\nexport const probe = userDataDir;\n',
  },
  {
    what: "a subdirectory of src/renderer imports src/main",
    file: "src/renderer/sub/probe.js",
    source:
      'import { userDataDir } from "../../main/paths.js";\nexport const probe = userDataDir;\n',
  },
  {
    what: "a src/renderer TypeScript declaration imports src/main",
    file: "src/renderer/probe.d.ts",
    source: 'import type { UserDataDir } from "../main/paths.js";\nexport type Probe = UserDataDir;\n',
  },
  {
    what: "a src/renderer module imports src/main",
    file: "src/renderer/probe.mjs",
    source:
      'import { userDataDir } from "../main/paths.js";\nexport const probe = userDataDir;\n',
  },
  {
    what: "src/renderer dynamically imports src/main",
    file: "src/renderer/probe.js",
    source: 'export const probe = async () => import("../main/paths.js");\n',
  },
  {
    what: "src/renderer dynamically imports src/main, spelled with a template literal",
    file: "src/renderer/probe.js",
    source: "export const probe = async () => import(`../main/paths.js`);\n",
  },
  {
    what: "src/renderer requires src/main through createRequire",
    file: "src/renderer/probe.js",
    source:
      'import { createRequire } from "node:module";\nexport const probe = createRequire(import.meta.url)("../main/paths.js");\n',
  },
  {
    what: "an apps/website .vue SFC imports src/main",
    file: "apps/website/app/pages/probe.vue",
    source:
      '<script setup lang="ts">\nimport { userDataDir } from "../../../../src/main/paths";\nconst probe = userDataDir;\n</script>\n<template><div>{{ probe }}</div></template>\n',
  },
  {
    what: "an apps/website .vue SFC dynamically imports src/renderer",
    file: "apps/website/app/pages/probe.vue",
    source:
      '<script setup lang="ts">\nconst probe = () => import("../../../../src/renderer/harness.js");\n</script>\n<template><div @click="probe" /></template>\n',
  },
  {
    what: "apps/website imports src/main",
    file: "apps/website/app/probe.ts",
    source:
      'import { userDataDir } from "../../../../src/main/paths";\nexport const probe = userDataDir;\n',
  },
  {
    what: "apps/website dynamically imports src/main",
    file: "apps/website/app/probe.ts",
    source: 'export const probe = async () => import("../../../../src/main/paths");\n',
  },
  {
    what: "apps/website dynamically imports src/main, spelled with a template literal",
    file: "apps/website/app/probe.ts",
    source: "export const probe = async () => import(`../../../../src/main/paths`);\n",
  },
  {
    what: "apps/website requires src/main through createRequire",
    file: "apps/website/app/probe.ts",
    source:
      'import { createRequire } from "node:module";\nexport const probe = createRequire(import.meta.url)("../../../../src/main/paths");\n',
  },
  {
    what: "apps/website imports developer tooling under src/tools",
    // "only src/shared" is the boundary; main, renderer and preload were the
    // only names spelled out, so src/tools/** crossed it with lint green.
    file: "apps/website/app/probe.ts",
    source:
      'import { validate } from "../../../../src/tools/diagnostics/validate";\nexport const probe = validate;\n',
  },
  {
    what: "the Tools UI imports renderer implementation",
    file: "apps/tools/src/probe.ts",
    source:
      'import { installToolsHost } from "../../../src/renderer/tools-host.js";\nexport const probe = installToolsHost;\n',
  },
  {
    what: "a Tools UI component imports main-process implementation",
    file: "apps/tools/src/Probe.vue",
    source:
      '<script setup lang="ts">\nimport { gamePaths } from "../../../src/main/paths.js";\nconst probe = gamePaths;\n</script>\n<template><div>{{ probe }}</div></template>\n',
  },
  {
    what: "an apps/website .vue SFC imports developer tooling under src/tools",
    file: "apps/website/app/pages/probe.vue",
    source:
      '<script setup lang="ts">\nimport { validate } from "../../../../src/tools/diagnostics/validate";\nconst probe = validate;\n</script>\n<template><div>{{ probe }}</div></template>\n',
  },
];

const ALLOWED = [
  {
    what: "src/main/core imports src/shared",
    file: "src/main/core/probe.ts",
    source: 'import { IPC } from "../../shared/contracts.js";\nexport const probe = IPC;\n',
  },
  {
    what: "src/main/core imports a sibling",
    file: "src/main/core/probe.ts",
    source: 'import { parseManifest } from "./manifest.js";\nexport const probe = parseManifest;\n',
  },
  {
    what: "src/main/core dynamically imports a sibling",
    file: "src/main/core/probe.ts",
    source: 'export const probe = async () => import("./manifest.js");\n',
  },
  {
    what: "a subdirectory of src/main/core imports src/shared",
    file: "src/main/core/sub/probe.ts",
    source: 'import { IPC } from "../../../shared/contracts.js";\nexport const probe = IPC;\n',
  },
  {
    what: "src/main/core requires a node builtin through createRequire",
    file: "src/main/core/probe.ts",
    source:
      'import { createRequire } from "node:module";\nexport const probe = createRequire(import.meta.url)("node:fs");\n',
  },
  {
    what: "src/main imports electron",
    file: "src/main/probe.ts",
    source: 'import { app } from "electron";\nexport const probe = app;\n',
  },
  {
    what: "src/renderer imports src/shared",
    file: "src/renderer/probe.js",
    source: 'import { IPC } from "../shared/contracts.js";\nexport const probe = IPC;\n',
  },
  {
    what: "an apps/website .vue SFC imports src/shared",
    file: "apps/website/app/pages/probe.vue",
    source:
      '<script setup lang="ts">\nimport { EXTERNAL_URLS } from "../../../../src/shared/contracts";\nconst probe = EXTERNAL_URLS;\n</script>\n<template><div>{{ probe }}</div></template>\n',
  },
  {
    what: "apps/website imports src/shared",
    file: "apps/website/app/probe.ts",
    source:
      'import { EXTERNAL_URLS } from "../../../../src/shared/contracts";\nexport const probe = EXTERNAL_URLS;\n',
  },
  {
    what: "apps/tools imports src/shared",
    file: "apps/tools/src/probe.ts",
    source:
      'import { EXTERNAL_URLS } from "../../../src/shared/contracts.js";\nexport const probe = EXTERNAL_URLS;\n',
  },
];

async function lint(probe: { file: string; source: string }): Promise<string[]> {
  const [result] = await eslint.lintText(probe.source, {
    filePath: path.join(root, probe.file),
  });
  assert.ok(result, `ESLint reported nothing at all for ${probe.file}`);
  return result.messages.map(
    (message) => message.ruleId ?? `fatal: ${message.message}`,
  );
}

for (const probe of REJECTED) {
  test(`lint rejects: ${probe.what}`, async () => {
    const fired = await lint(probe);
    assert.ok(
      fired.some((ruleId) => BOUNDARY_RULES.has(ruleId)),
      `expected a boundary rule to fire, got ${JSON.stringify(fired)}`,
    );
  });
}

for (const probe of ALLOWED) {
  test(`lint allows: ${probe.what}`, async () => {
    assert.deepEqual(await lint(probe), []);
  });
}

test("the .vue sources these app boundaries cover still exist", () => {
  // If the website ever stops using SFCs, the probes above would pass while
  // proving nothing about any real file.
  const sfcs = execFileSync("git", ["ls-files", "--", "apps/**/*.vue"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  assert.ok(sfcs.length > 0, "expected the apps to still have .vue sources");
});
