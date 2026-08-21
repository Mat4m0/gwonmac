// Main-process modules execute under Electron's Node loader. A runtime import
// cycle can therefore expose a binding before its module has initialized, and
// a broad facade import can quietly pull unrelated lifecycle owners into one
// strongly connected component. Type-only imports are erased and do not form
// runtime edges.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(root, "src/main");

function mainSources(at = sourceRoot): string[] {
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(at, entry.name);
    if (entry.isDirectory()) return mainSources(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")
      ? [full]
      : [];
  });
}

function importClauseHasRuntimeValue(clause: ts.ImportClause | undefined): boolean {
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  if (clause.namedBindings === undefined) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationHasRuntimeValue(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (node.exportClause === undefined) return true;
  if (ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function runtimeSpecifiers(sourceText: string, file = "main.ts"): string[] {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const add = (specifier: ts.Expression) => {
    if (ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
      found.push(specifier.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node)
      && importClauseHasRuntimeValue(node.importClause)
    ) {
      add(node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier !== undefined
      && exportDeclarationHasRuntimeValue(node)
    ) {
      add(node.moduleSpecifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolvedSource(importer: string, specifier: string): string | null {
  const target = path.resolve(path.dirname(importer), specifier);
  const candidates = specifier.endsWith(".js")
    ? [target.replace(/\.js$/u, ".ts")]
    : [target, `${target}.ts`, path.join(target, "index.ts")];
  return candidates.find((candidate) =>
    candidate.startsWith(`${sourceRoot}${path.sep}`)
    && existsSync(candidate)) ?? null;
}

function runtimeGraph(): ReadonlyMap<string, readonly string[]> {
  const sources = mainSources();
  const graph = new Map<string, readonly string[]>();
  for (const file of sources) {
    graph.set(file, runtimeSpecifiers(readFileSync(file, "utf8"), file)
      .flatMap((specifier) => {
      const resolved = resolvedSource(file, specifier);
      return resolved === null ? [] : [resolved];
      }));
  }
  return graph;
}

function firstCycle(
  graph: ReadonlyMap<string, readonly string[]>,
): readonly string[] | null {
  const complete = new Set<string>();
  const active = new Map<string, number>();
  const stack: string[] = [];

  const visit = (node: string): readonly string[] | null => {
    if (complete.has(node)) return null;
    const activeIndex = active.get(node);
    if (activeIndex !== undefined) return [...stack.slice(activeIndex), node];

    active.set(node, stack.length);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    active.delete(node);
    complete.add(node);
    return null;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle !== null) return cycle;
  }
  return null;
}

test("main-process runtime imports are acyclic", () => {
  const graph = runtimeGraph();
  assert.ok(graph.size > 100, "the runtime graph includes the main process");
  const edgeCount = [...graph.values()].reduce(
    (total, dependencies) => total + dependencies.length,
    0,
  );
  assert.ok(
    edgeCount > graph.size,
    "the runtime graph parses and resolves real local imports",
  );
  const cycle = firstCycle(graph)?.map((file) => path.relative(root, file));
  assert.equal(cycle, undefined, cycle?.join(" → "));
});

test("the graph check distinguishes runtime cycles from erased type edges", () => {
  const cycle = new Map([
    ["a", ["b"]],
    ["b", ["c"]],
    ["c", ["a"]],
  ]);
  assert.deepEqual(firstCycle(cycle), ["a", "b", "c", "a"]);

  const typeOnly = runtimeSpecifiers(`
    import type { A } from "./a.js";
    import { type B } from "./b.js";
    export type { C } from "./c.js";
    export { type D } from "./d.js";
  `);
  assert.deepEqual(typeOnly, []);
});
