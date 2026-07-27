// P0b.6: a source file that is an input to no tsconfig project is checked by
// nothing, and a green `pnpm typecheck` says the same thing either way. That
// silence is what let `forge.config.ts`, `eslint.config.js` and 41 test files
// sit outside every project unnoticed, so the coverage needs its own assertion
// rather than being inferred from the checker exiting zero.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The projects `pnpm typecheck` runs. Every source file in scope must be an
// input to one of them.
const PROJECTS = ["tsconfig.json", "tsconfig.renderer.json", "tsconfig.tests.json"];

// `apps/website` is checked by its own Nuxt project and its own path-filtered
// workflow; `tools/` and `gwkey.py` are Python. What remains is the application,
// its tests, its build scripts, and the two root tool configurations.
const IN_SCOPE = /^(src|tests|scripts)\/|^[^/]+$/u;
const SOURCE = /\.(?:m|c)?[jt]sx?$/u;

// Files deliberately outside every project, each with the reason it is not a
// gap. This list may only shrink: a file that becomes checked fails the
// staleness assertion below, and a new source file that escapes fails the
// coverage assertion, so growing it is always a deliberate, reviewed edit.
//
// It is empty. Phase 4 emptied it by widening `tsconfig.tests.json`'s include
// to name every remaining extension under `tests` and `scripts`, which enrolled
// the last holdouts — `scripts/ts-hook.mjs` and `scripts/ts-resolve.mjs`, which
// stay JavaScript because they install the loader everything else resolves
// through and so cannot be resolved through it themselves.
const KNOWN_UNCHECKED: { reason: string; files: string[] }[] = [];

const excused = new Map(
  KNOWN_UNCHECKED.flatMap(({ reason, files }) => files.map((file) => [file, reason])),
);

// Enumerated from git rather than from a literal list, because a script or test
// added tomorrow is exactly the file this test exists to catch. Untracked files
// that are not ignored count too, so the escape is caught in the working tree
// that created it rather than one commit later.
const sources = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => SOURCE.test(file) && IN_SCOPE.test(file))
  .filter((file) => existsSync(path.join(root, file)));

// TypeScript's own view of each project, never the include globs expanded by
// hand: a file can match a glob and still be dropped, as `scripts/macos-version.mjs`
// was while `scripts/macos-version.d.mts` sat beside it. The program is what
// adds the files no glob names — the `src/**/*.ts` the tests import.
//
// Membership is not checking, so `skipLibCheck` is subtracted here. It is
// indiscriminate: it silences errors inside this repository's own declaration
// files as readily as inside node_modules. A declaration whose only project
// skips it is an input that nothing checks, which is the gap this test exists
// to make loud rather than a form of coverage.
const checked = new Set(
  PROJECTS.flatMap((project) => {
    const file = path.join(root, project);
    const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
    assert.equal(error, undefined, `${project} could not be read`);
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, file);
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
    });
    return program
      .getSourceFiles()
      .filter((source) => !(parsed.options.skipLibCheck && source.isDeclarationFile))
      .map((source) => source.fileName);
  }),
);

const isChecked = (file: string) => checked.has(path.join(root, file));

test("every source file the repository owns is an input to a tsconfig project", () => {
  const escaped = sources.filter((file) => !isChecked(file) && !excused.has(file));
  assert.deepEqual(
    escaped,
    [],
    `${escaped.length} source file(s) are checked by no project and carry no ` +
      `KNOWN_UNCHECKED reason: ${escaped.join(", ")}`,
  );
});

test("every KNOWN_UNCHECKED entry still names a file that is still unchecked", () => {
  const stale = [...excused.keys()].filter(
    (file) => !sources.includes(file) || isChecked(file),
  );
  assert.deepEqual(
    stale,
    [],
    `KNOWN_UNCHECKED is out of date; delete these entries: ${stale.join(", ")}`,
  );
});

// A declaration beside its own implementation is the failure the coverage
// assertion above cannot explain on its own: TypeScript prefers the declaration,
// drops the implementation, and the file that actually runs is checked by
// nothing. `scripts/preload-injected-constants.mts` is not this — it declares
// globals the preload generator injects and has no implementation — so the rule
// is about the pairing, not about declaration files as such.
const IMPLEMENTATIONS = new Map([
  [".d.mts", [".mts", ".mjs"]],
  [".d.cts", [".cts", ".cjs"]],
  [".d.ts", [".ts", ".tsx", ".js", ".jsx"]],
]);

test("no hand-written declaration shadows the implementation it describes", () => {
  const shadows = [];
  for (const file of sources) {
    for (const [suffix, implementations] of IMPLEMENTATIONS) {
      if (!file.endsWith(suffix)) continue;
      const base = file.slice(0, -suffix.length);
      for (const extension of implementations) {
        const implementation = base + extension;
        if (sources.includes(implementation)) {
          shadows.push(`${file} shadows ${implementation}`);
        }
      }
      break;
    }
  }
  assert.deepEqual(shadows, []);
});
