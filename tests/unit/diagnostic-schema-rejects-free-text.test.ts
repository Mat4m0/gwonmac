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

// Extend only the type passed to the two bottom-of-file guards. The production
// event union and its recorder functions stay untouched by the probe.
const ANCHOR = "const _noFreeText:";

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

function compile(source: string): readonly ts.Diagnostic[] {
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (name) => (path.resolve(name) === schemaPath ? source : readFile(name));
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    path.resolve(name) === schemaPath
      ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([schemaPath], options, host);
  return ts.getPreEmitDiagnostics(program);
}

type Probe = {
  readonly name: string;
  readonly field: string;
  readonly guard: "free-text" | "scalar";
};

const FORBIDDEN_PROBES: readonly Probe[] = [
  { name: "direct", field: "message: string", guard: "free-text" },
  { name: "reason", field: "reason: string", guard: "free-text" },
  { name: "label", field: "label: string", guard: "free-text" },
  { name: "notice", field: "notice: string", guard: "free-text" },
  { name: "detail_path", field: "detailPath: string", guard: "free-text" },
  { name: "optional", field: "message?: string", guard: "free-text" },
  { name: "widened", field: 'reason: "timeout" | string', guard: "free-text" },
  { name: "nested", field: "detail: { message: string }", guard: "scalar" },
  { name: "array", field: "names: string[]", guard: "scalar" },
];

function withProbes(probes: readonly Probe[]): string {
  assert.ok(schemaSource.includes(ANCHOR), "the schema guards moved; update this probe");
  const declarations = probes.map(({ name, field, guard }) => {
    const type = `Probe_${name}`;
    const condition = guard === "free-text"
      ? `[FreeTextKeys<${type}>] extends [never]`
      : `${type} extends Record<string, DiagnosticScalar | undefined>`;
    return `type ${type} = DiagnosticEvent | { k: "probe_${name}"; ${field} };\n`
      + `const _reject_${name}: ${condition} ? true : never = true;`;
  }).join("\n");
  return schemaSource.replace(ANCHOR, `${declarations}\n\n${ANCHOR}`);
}

function messages(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join(" | ");
}

function evidenceMarkers(
  source: string,
  diagnostics: readonly ts.Diagnostic[],
): string[] {
  return diagnostics.flatMap((diagnostic) => {
    if (diagnostic.file === undefined || diagnostic.start === undefined) return [];
    const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line;
    return source.split("\n")[line]?.match(/_reject_[a-z_]+/gu) ?? [];
  });
}

describe("the closed diagnostics schema", () => {
  it("reports every prohibited field shape in one compiler program", () => {
    const source = withProbes(FORBIDDEN_PROBES);
    const diagnostics = compile(source);
    assert.ok(
      diagnostics.every((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").includes(GUARD_FIRED)),
      `an unrelated compiler error hid the guard evidence: ${messages(diagnostics)}`,
    );
    assert.deepEqual(
      [...new Set(evidenceMarkers(source, diagnostics))].sort(),
      FORBIDDEN_PROBES.map(({ name }) => `_reject_${name}`).sort(),
      `not every prohibited shape tripped its own guard: ${messages(diagnostics)}`,
    );
  });

  it("still accepts the field kinds the schema is built from", () => {
    // The guard has to admit what diagnostics legitimately carry, or producers
    // would route around it. A closed union, a number, a boolean and the
    // neutral shared Digest type must all survive.
    const allowed: readonly Probe[] = [{
      name: "allowed",
      field: 'phase: "startup" | "quit"; count: number; retried: boolean; '
        + 'digest: import("../../shared/digest.js").Digest',
      guard: "free-text",
    }, {
      name: "allowed_scalar",
      field: 'phase: "startup" | "quit"; count: number; retried: boolean; '
        + 'digest: import("../../shared/digest.js").Digest',
      guard: "scalar",
    }];
    assert.deepEqual(compile(withProbes(allowed)), []);
  });
});
