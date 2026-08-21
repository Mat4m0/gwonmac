/**
 * Executable renderer build invariants. The HTML entry scripts must stay
 * classic for Emscripten's global `var Module`, while their dynamic imports
 * must resolve inside the renderer tree the package actually ships.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const renderer = path.join(root, "build/renderer");
const index = readFileSync(path.join(renderer, "index.html"), "utf8");
const classicEntries = [...index.matchAll(/<script\s+src="([^"]+\.js)"><\/script>/gu)]
  .map((match) => match[1]!);

test("the built launcher entries stay classic scripts in their declared order", () => {
  assert.deepEqual(classicEntries, [
    "diagnostics.js",
    "commands.js",
    "loading.js",
    "harness.js",
    "settings.js",
  ]);
  for (const entry of classicEntries) {
    const source = ts.createSourceFile(
      entry,
      readFileSync(path.join(renderer, entry), "utf8"),
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    );
    assert.equal(ts.isExternalModule(source), false, `${entry} became an ES module`);
  }
});

test("the built harness keeps Emscripten's Module binding global", () => {
  const source = ts.createSourceFile(
    "harness.js",
    readFileSync(path.join(renderer, "harness.js"), "utf8"),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const moduleDeclaration = source.statements.find(
    (statement) => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name)
          && declaration.name.text === "Module",
      ),
  );
  assert.ok(
    moduleDeclaration && ts.isVariableStatement(moduleDeclaration),
    "harness.js has no top-level Module declaration",
  );
  assert.equal(
    (moduleDeclaration.declarationList.flags & ts.NodeFlags.BlockScoped) === 0,
    true,
    "Module must remain var, not const or let",
  );
});

test("shared renderer runtime modules belong to the renderer output", () => {
  assert.equal(existsSync(path.join(renderer, "shared/contracts.js")), true);
  assert.equal(existsSync(path.join(root, "build/shared/contracts.js")), true);
});
