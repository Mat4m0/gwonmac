import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  COMPANION_KERNEL_DYLINK0,
  COMPANION_KERNEL_SIGNATURES,
  validateCompanionKernelContract,
} from "../../scripts/companion-kernel-contract.mjs";
import {
  COMPANION_KERNEL_HASH_BINDING,
  COMPANION_KERNEL_HASH_PLACEHOLDER,
  companionKernelSha256,
  sealCompanionKernelBuild,
  verifySealedCompanionRenderer,
} from "../../scripts/seal-companion-kernel.mjs";

interface FixtureOptions {
  readonly start?: boolean;
  readonly wrongDylink?: boolean;
  readonly extraImport?: boolean;
  readonly extraExport?: boolean;
  readonly outOfFootprintData?: boolean;
  readonly wrongSignature?: boolean;
}

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function uleb(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 0x80);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function name(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [...uleb(bytes.byteLength), ...bytes];
}

function section(id: number, body: readonly number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

function functionType(params: number, result: boolean): number[] {
  return [
    0x60,
    ...uleb(params),
    ...Array.from({ length: params }, () => 0x7f),
    ...(result ? [1, 0x7f] : [0]),
  ];
}

function importEntry(
  field: string,
  kind: number,
  descriptor: readonly number[],
): number[] {
  return [...name("env"), ...name(field), kind, ...descriptor];
}

function fixture(options: FixtureOptions = {}): Uint8Array<ArrayBuffer> {
  const signatures = COMPANION_KERNEL_SIGNATURES.map(
    ({ name: exportName, typeIndex }, functionIndex) => ({
      exportName,
      typeIndex,
      functionIndex,
    }),
  );
  const startFunction = signatures.length;
  const types = [
    functionType(9, true),
    functionType(6, false),
    functionType(0, true),
    functionType(0, false),
  ];
  const dylink = [...COMPANION_KERNEL_DYLINK0];
  if (options.wrongDylink) dylink[2] = (dylink[2] ?? 0) ^ 1;
  const imports = [
    importEntry("__indirect_function_table", 1, [0x70, 0, 0]),
    importEntry("__memory_base", 3, [0x7f, 0]),
    importEntry("__stack_pointer", 3, [0x7f, 1]),
    importEntry("__table_base", 3, [0x7f, 0]),
    importEntry("memory", 2, [0, 1]),
    ...(options.extraImport
      ? [importEntry("unexpected", 3, [0x7f, 0])]
      : []),
  ];
  const functionTypes = signatures.map(({ typeIndex }) => typeIndex);
  if (options.wrongSignature) functionTypes[0] = 2;
  if (options.start) functionTypes.push(3);
  const exports = signatures.map(({ exportName, functionIndex }) => [
    ...name(exportName),
    0,
    ...uleb(functionIndex),
  ]);
  if (options.extraExport) {
    exports.push([...name("unexpected"), 0, ...uleb(0)]);
  }
  const bodies = signatures.map(({ typeIndex }) =>
    typeIndex === 1
      ? [0, 0x0b]
      : [0, 0x41, 0, 0x0b],
  );
  if (options.start) bodies.push([0, 0x0b]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(0, [...name("dylink.0"), ...dylink]),
    ...section(1, [...uleb(types.length), ...types.flat()]),
    ...section(2, [...uleb(imports.length), ...imports.flat()]),
    ...section(3, [...uleb(functionTypes.length), ...functionTypes]),
    ...section(7, [...uleb(exports.length), ...exports.flat()]),
    ...(options.start ? section(8, uleb(startFunction)) : []),
    ...section(10, [
      ...uleb(bodies.length),
      ...bodies.flatMap((body) => [...uleb(body.length), ...body]),
    ]),
    ...(options.outOfFootprintData
      ? section(11, [1, 0, 0x41, 0, 0x0b, 1, 0xa5])
      : []),
  ]);
}

function workspace(): {
  readonly root: string;
  readonly candidate: string;
  readonly artifact: string;
  readonly renderer: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "gw-kernel-seal-"));
  roots.push(root);
  return {
    root,
    candidate: path.join(root, "candidate.wasm"),
    artifact: path.join(root, "companion-kernel.wasm"),
    renderer: path.join(root, "enhancements.js"),
  };
}

const rendererSource = [
  "async function load(kernelBytes, kernelSha256) {",
  "  const kernelModule = await WebAssembly.compile(kernelBytes);",
  "  return kernelModule;",
  "}",
  "",
].join("\n");

describe("companion kernel build contract", () => {
  it("accepts exactly the fixed side-module surface", () => {
    const bytes = fixture();
    assert.equal(WebAssembly.validate(bytes), true);
    assert.doesNotThrow(() => validateCompanionKernelContract(bytes));
  });

  it("rejects invalid Wasm, a start function, and a changed dylink footprint", () => {
    assert.throws(
      () => validateCompanionKernelContract(Uint8Array.of(0, 1, 2)),
      /invalid WebAssembly/,
    );
    const start = fixture({ start: true });
    assert.equal(WebAssembly.validate(start), true);
    assert.throws(
      () => validateCompanionKernelContract(start),
      /must not contain a start function/,
    );
    const dylink = fixture({ wrongDylink: true });
    assert.equal(WebAssembly.validate(dylink), true);
    assert.throws(
      () => validateCompanionKernelContract(dylink),
      /dylink\.0 footprint is invalid/,
    );
  });

  it("rejects extra imports and exports rather than allow-listing by prefix", () => {
    assert.throws(
      () => validateCompanionKernelContract(fixture({ extraImport: true })),
      /import surface is invalid/,
    );
    assert.throws(
      () => validateCompanionKernelContract(fixture({ extraExport: true })),
      /export surface is invalid/,
    );
  });

  it("rejects a named export with the wrong exact function type", () => {
    const bytes = fixture({ wrongSignature: true });
    assert.equal(WebAssembly.validate(bytes), true);
    assert.throws(
      () => validateCompanionKernelContract(bytes),
      /exports have invalid function types/,
    );
  });

  it("rejects active data writes outside the declared private footprint", () => {
    const bytes = fixture({ outOfFootprintData: true });
    assert.equal(WebAssembly.validate(bytes), true);
    assert.throws(
      () => validateCompanionKernelContract(bytes),
      /active data writes outside its dylink\.0 footprint/,
    );
  });
});

describe("companion kernel build seal", () => {
  it("publishes validated bytes and checks their sealed hash before compile", () => {
    const files = workspace();
    const bytes = fixture();
    writeFileSync(files.candidate, bytes);
    writeFileSync(files.renderer, rendererSource);

    const sha256 = sealCompanionKernelBuild({
      candidatePath: files.candidate,
      artifactPath: files.artifact,
      rendererPath: files.renderer,
    });

    assert.equal(existsSync(files.candidate), false);
    assert.deepEqual(new Uint8Array(readFileSync(files.artifact)), bytes);
    assert.equal(sha256, companionKernelSha256(bytes));
    const renderer = readFileSync(files.renderer, "utf8");
    verifySealedCompanionRenderer(renderer, sha256);
    assert.match(
      renderer,
      new RegExp(`const ${COMPANION_KERNEL_HASH_BINDING} = "${sha256}";`),
    );
    assert.equal(renderer.includes(COMPANION_KERNEL_HASH_PLACEHOLDER), false);
    assert.ok(
      renderer.indexOf(`kernelSha256 !== ${COMPANION_KERNEL_HASH_BINDING}`)
      < renderer.indexOf("WebAssembly.compile(kernelBytes)"),
    );
  });

  it("removes a stale artifact without rewriting when validation fails", () => {
    const files = workspace();
    writeFileSync(files.candidate, Uint8Array.of(0, 1, 2));
    writeFileSync(files.artifact, Uint8Array.of(3, 4, 5));
    writeFileSync(files.renderer, rendererSource);

    assert.throws(
      () => sealCompanionKernelBuild({
        candidatePath: files.candidate,
        artifactPath: files.artifact,
        rendererPath: files.renderer,
      }),
      /invalid WebAssembly/,
    );
    assert.equal(existsSync(files.artifact), false);
    assert.equal(readFileSync(files.renderer, "utf8"), rendererSource);
  });

  it("removes the artifact and restores the renderer if final publication fails", () => {
    const files = workspace();
    const bytes = fixture();
    const unavailableArtifact = path.join(
      files.root,
      "missing",
      "companion-kernel.wasm",
    );
    writeFileSync(files.candidate, bytes);
    writeFileSync(files.renderer, rendererSource);

    assert.throws(
      () => sealCompanionKernelBuild({
        candidatePath: files.candidate,
        artifactPath: unavailableArtifact,
        rendererPath: files.renderer,
      }),
      /ENOENT/,
    );
    assert.equal(existsSync(unavailableArtifact), false);
    assert.equal(existsSync(files.candidate), true);
    assert.equal(readFileSync(files.renderer, "utf8"), rendererSource);
  });
});
