// The public Core promise is a module-graph boundary, not only a collection of
// runtime if-statements. This test walks static source imports and fails when a
// Core entry can evaluate optional Tools implementation before its dynamic gate.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");

function staticSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (
        clause?.namedBindings
        && ts.isNamedImports(clause.namedBindings)
        && clause.name === undefined
        && clause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) continue;
      if (ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    } else if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function resolveSource(owner: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const emitted = path.resolve(path.dirname(owner), specifier);
  const candidates = [
    emitted.replace(/\.js$/u, ".ts"),
    emitted.replace(/\.js$/u, ".mts"),
    emitted,
    path.join(emitted, "index.ts"),
  ];
  return candidates.find(existsSync) ?? null;
}

function staticClosure(entry: string): ReadonlySet<string> {
  const pending = [path.resolve(root, entry)];
  const visited = new Set<string>();
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of staticSpecifiers(file)) {
      const dependency = resolveSource(file, specifier);
      if (dependency) pending.push(dependency);
    }
  }
  return visited;
}

function assertUnreachable(
  graph: ReadonlySet<string>,
  forbidden: readonly string[],
): void {
  for (const relative of forbidden) {
    assert.equal(
      graph.has(path.resolve(root, relative)),
      false,
      `${relative} is statically reachable from Core`,
    );
  }
}

test("the Core renderer graph cannot evaluate optional Tools implementation", () => {
  const graph = staticClosure("src/renderer/enhancements.ts");
  assertUnreachable(graph, [
    "src/renderer/certified-companion-tools.ts",
    "src/renderer/companion-snapshot.ts",
    "src/renderer/companion-skill-snapshot.ts",
    "src/renderer/enhancement-readout.ts",
    "src/renderer/toolbox-foundation.ts",
    "src/renderer/skill-overlays-installation.ts",
    "src/renderer/companion-policy-source.ts",
    "src/renderer/tools-host.ts",
    "src/renderer/travel-palette.ts",
    "src/renderer/tools-stylesheet.ts",
  ]);
});

test("the Core main graph cannot evaluate optional stores, IPC, or network code", () => {
  const graph = staticClosure("src/main/main.ts");
  assertUnreachable(graph, [
    "src/main/tools-runtime.ts",
    "src/main/tools-ipc.ts",
    "src/main/trade-ipc.ts",
    "src/main/core/trade-chat-service.ts",
    "src/main/core/trade-saved-store.ts",
    "src/main/core/travel-history.ts",
    "src/main/core/build-library-coordinator.ts",
  ]);
});
