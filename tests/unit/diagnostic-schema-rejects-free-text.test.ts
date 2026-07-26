// P2.2, executed rather than asserted about. The claim is "adding a `string`
// field to any diagnostic event fails `tsc`", so this runs the real TypeScript
// compiler over the real schema source with that field added, and checks the
// compile fails *for the right reason* — a diagnostic that is merely a broken
// probe would pass a bare "did it error" check.
//
// The probe is the true schema.ts text with one edit, overlaid at the true
// path, so its relative imports resolve and every guard in the file is the one
// under test. That the unedited file compiles is proved by `pnpm typecheck`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schemaPath = path.join(root, "src/main/diagnostics/schema.ts");
const schemaSource = readFileSync(schemaPath, "utf8");

// One real event, used as the place to graft each rejected field onto.
const ANCHOR = `| { k: "proxy.requestFailed"; route: ProxyRoute; code: ErrorCode }`;

// What both guards in schema.ts report when they stop holding.
const GUARD_FIRED = "not assignable to type 'never'";

function compilerOptions(): ts.CompilerOptions {
  const raw = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(raw.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, root);
  return {
    ...parsed.options,
    noEmit: true,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
  };
}

const options = compilerOptions();

function compile(source: string): string[] {
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (name) => (path.resolve(name) === schemaPath ? source : readFile(name));
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    path.resolve(name) === schemaPath
      ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([schemaPath], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
}

function withField(field: string): string {
  assert.ok(schemaSource.includes(ANCHOR), "the anchor event moved; update this probe");
  return schemaSource.replace(ANCHOR, ANCHOR.replace(" }", `; ${field} }`));
}

function assertRejected(field: string): void {
  const errors = compile(withField(field));
  assert.ok(
    errors.some((message) => message.includes(GUARD_FIRED)),
    `\`${field}\` did not trip the schema guard. Compiler said: ${
      errors.length ? errors.join(" | ") : "nothing at all"
    }`,
  );
}

describe("the closed diagnostics schema", () => {
  it("stops compiling once an event has an open string field", () => {
    assertRejected("message: string");
  });

  it("rejects a string field under any other name", () => {
    // The guard is a property of the type, not of the field being called
    // `message`. `reason`, `label`, `notice` are all prose.
    for (const name of ["reason", "label", "notice", "detailPath"]) {
      assertRejected(`${name}: string`);
    }
  });

  it("rejects an optional string field", () => {
    assertRejected("message?: string");
  });

  it("rejects a string widened by a union with a literal", () => {
    // `"timeout" | string` collapses to `string`, which is how an open field
    // reaches a schema by accident rather than on purpose.
    assertRejected('reason: "timeout" | string');
  });

  it("rejects text nested inside an object field", () => {
    assertRejected("detail: { message: string }");
  });

  it("rejects an array of strings", () => {
    assertRejected("names: string[]");
  });

  it("still accepts the field kinds the schema is built from", () => {
    // The guard has to admit what diagnostics legitimately carry, or producers
    // would route around it. A closed union, a number, a boolean and a Digest
    // must all survive.
    assert.deepEqual(
      compile(withField("phase: AppPhase; count: number; retried: boolean; digest: Digest")),
      [],
    );
  });
});
