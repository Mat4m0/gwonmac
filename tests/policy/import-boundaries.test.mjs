// Architecture policy, executed rather than asserted about: run the
// repository's real ESLint config over source that crosses each boundary
// eslint.config.js pins, and check the crossing is actually rejected. Every
// probe spells the crossing a different way, because one file has more than one
// name: `../paths.js`, `../../main/paths.js` and `../../../src/main/paths.js`
// all resolve to src/main/paths.ts.
//
// One boundary cannot be executed: the nine apps/website `.vue` SFCs match no
// ESLint configuration (P0.3 deferred the Vue parser), so the last test scans
// their text instead and says so in its name.
//
// The only override is turning off typescript-eslint's project service, which
// otherwise refuses a path that has no file behind it. The boundary rules
// (no-restricted-imports, no-restricted-syntax) are purely syntactic, so
// nothing under test depends on type information — and this keeps the test from
// writing throwaway files into src/.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    what: "src/main/core dynamically imports upward from src/main",
    file: "src/main/core/probe.ts",
    source: 'export const probe = async () => import("../paths.js");\n',
  },
  {
    what: "src/main/core dynamically imports upward, spelled through src/main",
    file: "src/main/core/probe.ts",
    source: 'export const probe = async () => import("../../main/paths.js");\n',
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
    what: "apps/website imports src/shared",
    file: "apps/website/app/probe.ts",
    source:
      'import { EXTERNAL_URLS } from "../../../../src/shared/contracts";\nexport const probe = EXTERNAL_URLS;\n',
  },
];

/** @param {{ file: string, source: string }} probe */
async function lint(probe) {
  const [result] = await eslint.lintText(probe.source, {
    filePath: path.join(root, probe.file),
  });
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

test("scanned, not linted: no apps/website .vue file names src/main, renderer or preload", () => {
  // ESLint has no configuration that matches .vue, so this boundary is the one
  // P0.2 rule a lint rule cannot hold. Reading the text is weaker than running
  // the rule; it is here so the claim is checked by something rather than
  // nothing until P0.3's Vue parser decision lands.
  const sfcs = execFileSync("git", ["ls-files", "--", "apps/website/**/*.vue"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  assert.ok(sfcs.length > 0, "expected the website to still have .vue sources");

  const crossings = sfcs.filter((file) =>
    /(?:^|["'/])(?:\.\.|src)\/(?:main|renderer|preload)\//m.test(
      readFileSync(path.join(root, file), "utf8"),
    ),
  );
  assert.deepEqual(crossings, []);
});
