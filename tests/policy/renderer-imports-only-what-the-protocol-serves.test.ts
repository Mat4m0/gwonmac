// The renderer is served over `gw://app/`, and the protocol hands out exactly
// two modules from `src/shared` — `RENDERER_SHARED_MODULES` in protocol.ts,
// with a comment that calls itself "deliberately not a generic build/shared
// route". Everything else under `src/shared` is compiled but unreachable.
//
// So a renderer module that imports one of them *at run time* produces a 404 at
// launch, and the 404 is not for the module it names: the whole enhancement
// installer fails to load, the client comes up with no companion, and the
// console says "Failed to fetch dynamically imported module". Nothing in
// `pnpm check` sees it, because every one of those imports type-checks
// perfectly — the file exists, it is just never served.
//
// That happened. `enhancements.ts` grew `import { liveParty } from
// "../shared/builds/live-party.js"` and the app stopped opening.
//
// Type-only imports are fine and are the normal way to name a shared shape:
// they are erased before anything is fetched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The allowlist, read from the route that enforces it rather than restated. */
function servedModules(): ReadonlySet<string> {
  const source = readFileSync(
    path.join(root, "src/main/protocol.ts"),
    "utf8",
  );
  const block = /const RENDERER_SHARED_MODULES = new Set\(\[([^\]]*)\]\)/u
    .exec(source);
  assert.ok(block, "protocol.ts no longer declares RENDERER_SHARED_MODULES");
  const names = [...block[1]!.matchAll(/"([^"]+)"/gu)].map((match) => match[1]!);
  assert.ok(names.length > 0, "the allowlist parsed as empty");
  return new Set(names);
}

function rendererSources(): readonly string[] {
  const directory = path.join(root, "src/renderer");
  const walk = (at: string): string[] =>
    readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  return walk(directory);
}

/**
 * Every `from "../shared/…"` in `source`, paired with whether the statement is
 * type-only.
 *
 * A statement counts as type-only when it opens `import type` or `export type`.
 * `import { type A }` with every specifier inline-typed is also erased, and is
 * reported here as a value import anyway — the fix is to hoist the `type` to
 * the statement, which is what the rest of this repository already does and is
 * clearer at a glance than counting specifiers.
 */
function sharedImports(source: string): readonly {
  module: string;
  typeOnly: boolean;
}[] {
  const found: { module: string; typeOnly: boolean }[] = [];
  const pattern = /(^|\n)\s*(import|export)(\s+type)?\b[^;]*?from\s*"(\.\.\/)+shared\/([^"]+)"/gu;
  for (const match of source.matchAll(pattern)) {
    found.push({ module: match[5]!, typeOnly: match[3] !== undefined });
  }
  return found;
}

test("the renderer imports nothing from src/shared the protocol will not serve", () => {
  const served = servedModules();
  const offences: string[] = [];
  for (const file of rendererSources()) {
    // Declaration files describe types and emit nothing to fetch.
    if (file.endsWith(".d.ts")) continue;
    const relative = path.relative(root, file);
    for (const { module, typeOnly } of sharedImports(readFileSync(file, "utf8"))) {
      if (typeOnly || served.has(module)) continue;
      offences.push(`${relative} imports shared/${module} at run time`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    "these resolve to a 404 at launch and take the whole module graph with them; "
    + `the protocol serves only ${[...served].join(", ")}`,
  );
});

test("the guard is looking at something, and can tell the two apart", () => {
  // A test that silently matched nothing would pass forever. This pins both
  // halves: the allowlisted value import that must stay legal, and the shape
  // that broke the app.
  const legal = sharedImports(
    'import {\n  SKILL_ICON_ROUTE,\n} from "../shared/contracts.js";\n',
  );
  assert.deepEqual(legal, [{ module: "contracts.js", typeOnly: false }]);

  const erased = sharedImports(
    'import type { RendererMilestone } from "../shared/diagnostics.js";\n',
  );
  assert.deepEqual(erased, [{ module: "diagnostics.js", typeOnly: true }]);

  const broke = sharedImports(
    'import { liveParty } from "../shared/builds/live-party.js";\n',
  );
  assert.deepEqual(broke, [{ module: "builds/live-party.js", typeOnly: false }]);
  assert.equal(servedModules().has("builds/live-party.js"), false);

  // And the sweep reaches real files rather than an empty directory.
  assert.ok(rendererSources().length > 20);
});
