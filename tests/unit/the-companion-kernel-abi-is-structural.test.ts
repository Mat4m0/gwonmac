import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeSource = readFileSync(
  path.join(repoRoot, "src/renderer/enhancements.ts"),
  "utf8",
);
const verifierSource = readFileSync(
  path.join(repoRoot, "scripts/verify-companion-kernel.mjs"),
  "utf8",
);
const contractSource = readFileSync(
  path.join(repoRoot, "scripts/companion-kernel-contract.mjs"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

const exactSignatures = [
  ["companion_init", 0],
  ["companion_dispatch", 1],
  ["companion_cursor_event_count", 2],
  ["companion_abi", 2],
  ["companion_config_bytes", 2],
  ["companion_snapshot_bytes", 2],
  ["companion_cursor_bytes", 2],
  ["companion_toolbox_bytes", 2],
  ["companion_party_bytes", 2],
] as const;

function signatureTable(
  source: string,
  startMarker: string,
  endMarker: string,
): [string, number][] {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return [...source.slice(start, end).matchAll(
    /\{ name: "([^"]+)", typeIndex: (\d+) \}/g,
  )].map((match) => [match[1]!, Number(match[2])]);
}

function functionTypes(source: string): [number, boolean][] {
  return [...source.matchAll(/i32FunctionType\((\d+), (true|false)\)/g)]
    .map((match) => [Number(match[1]), match[2] === "true"]);
}

function packageScript(name: string): string {
  const script = packageJson.scripts[name];
  assert.ok(script, `missing package script ${name}`);
  return script;
}

describe("the companion kernel ABI is structurally verified", () => {
  it("pins every export to the same Wasm type in the runtime and build contract", () => {
    assert.deepEqual(
      signatureTable(
        runtimeSource,
        "const COMPANION_SIGNATURES = [",
        "] as const;",
      ),
      exactSignatures,
    );
    assert.deepEqual(
      signatureTable(
        contractSource,
        "export const COMPANION_KERNEL_SIGNATURES = Object.freeze([",
        "]);",
      ),
      exactSignatures,
    );
    assert.match(
      verifierSource,
      /validateCompanionKernelContract,/,
    );
    assert.doesNotMatch(verifierSource, /const companionSignatures = \[/);
  });

  it("pins init, dispatch, and scalar exports to their exact function shapes", () => {
    for (const source of [runtimeSource, contractSource]) {
      assert.deepEqual(functionTypes(source), [
        // init takes five region pointer/size pairs and the feature word.
        [11, true],
        [6, false],
        [0, true],
      ]);
    }
  });

  it("does not use JavaScript arity as ABI evidence", () => {
    assert.doesNotMatch(runtimeSource, /kernel[A-Za-z]+\.length/);
    assert.doesNotMatch(
      verifierSource,
      /exportedFunction\([^)]*\)\.length/,
    );
  });

  it("rejects extra runtime exports before instantiating into game memory", () => {
    assert.match(runtimeSource, /WebAssembly\.Module\.exports\(kernelModule\)/);
    assert.match(
      runtimeSource,
      /Companion kernel export surface is invalid/,
    );
  });

  it("keeps raw memory observations out of the developer runtime", () => {
    assert.doesNotMatch(runtimeSource, /readObservation/);
    assert.match(runtimeSource, /program === "target-observer"/);
  });
});

describe("the canonical gate verifies the built companion kernel", () => {
  it("runs the verifier directly after the existing build", () => {
    const commands = packageScript("verify").split(" && ");
    const build = commands.indexOf("pnpm build");
    assert.notEqual(build, -1);
    assert.equal(
      commands[build + 1],
      "node scripts/verify-companion-kernel.mjs",
    );
    assert.equal(commands.includes("pnpm enhancements:kernel:verify"), false);
  });

  it("keeps the standalone developer command self-contained", () => {
    assert.equal(
      packageScript("enhancements:kernel:verify"),
      "pnpm build && node scripts/verify-companion-kernel.mjs",
    );
  });

  it("rebuilds with the canonical producer recipe", () => {
    assert.match(
      verifierSource,
      /companionKernelRustcArgs\(rebuilt\)/,
    );
    assert.doesNotMatch(verifierSource, /opt-level=s/);
  });
});
