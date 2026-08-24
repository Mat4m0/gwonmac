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
  COMPANION_KERNEL_EXPORT_VALUES,
  COMPANION_KERNEL_IMPORTS,
  COMPANION_KERNEL_SIGNATURES,
  validateCompanionKernelContract,
} from "../../scripts/companion-kernel-contract.mjs";
import {
  COMPANION_CURSOR_BYTES,
  COMPANION_PARTY_BYTES,
  COMPANION_SNAPSHOT_BYTES,
  COMPANION_TOOLBOX_BYTES,
} from "../../src/renderer/companion-snapshot.ts";
import { COMPANION_PLAY_REGION_BYTES } from "../../src/renderer/companion-play-region-snapshot.ts";
import { ENHANCEMENT_CONFIG_WORD_COUNT } from "../../src/shared/enhancement-contracts.ts";
import {
  COMPANION_KERNEL_HASH_BINDING,
  COMPANION_KERNEL_HASH_PLACEHOLDER,
  companionKernelSha256,
  sealCompanionKernelBuild,
  verifySealedCompanionLoader,
} from "../../scripts/seal-companion-kernel.mjs";
import { companionKernelFixture } from "../helpers/companion-kernel-fixture.ts";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

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
  it("states the exact reviewed import and function vocabulary once", () => {
    assert.deepEqual(COMPANION_KERNEL_IMPORTS, [
      "env.__indirect_function_table:table",
      "env.__memory_base:global",
      "env.__stack_pointer:global",
      "env.__table_base:global",
      "env.memory:memory",
    ]);
    assert.deepEqual(COMPANION_KERNEL_SIGNATURES, [
      { name: "companion_init", typeIndex: 0 },
      { name: "companion_dispatch", typeIndex: 1 },
      { name: "companion_cursor_event_count", typeIndex: 2 },
      { name: "companion_abi", typeIndex: 2 },
      { name: "companion_config_bytes", typeIndex: 2 },
      { name: "companion_snapshot_bytes", typeIndex: 2 },
      { name: "companion_cursor_bytes", typeIndex: 2 },
      { name: "companion_toolbox_bytes", typeIndex: 2 },
      { name: "companion_party_bytes", typeIndex: 2 },
      { name: "companion_skill_slot_bytes", typeIndex: 2 },
      { name: "companion_skill_cooldown_bytes", typeIndex: 2 },
      { name: "companion_play_region_bytes", typeIndex: 2 },
    ]);
  });

  it("accepts exactly the fixed side-module surface", () => {
    const bytes = companionKernelFixture();
    assert.equal(WebAssembly.validate(bytes), true);
    assert.doesNotThrow(() => validateCompanionKernelContract(bytes));
  });

  it("rejects invalid Wasm, a start function, and a changed dylink footprint", () => {
    assert.throws(
      () => validateCompanionKernelContract(Uint8Array.of(0, 1, 2)),
      /invalid WebAssembly/,
    );
    const start = companionKernelFixture({ start: true });
    assert.equal(WebAssembly.validate(start), true);
    assert.throws(
      () => validateCompanionKernelContract(start),
      /must not contain a start function/,
    );
    const dylink = companionKernelFixture({ wrongDylink: true });
    assert.equal(WebAssembly.validate(dylink), true);
    assert.throws(
      () => validateCompanionKernelContract(dylink),
      /dylink\.0 footprint is invalid/,
    );
  });

  it("rejects extra imports and exports rather than allow-listing by prefix", () => {
    assert.throws(
      () => validateCompanionKernelContract(companionKernelFixture({ extraImport: true })),
      /import surface is invalid/,
    );
    assert.throws(
      () => validateCompanionKernelContract(companionKernelFixture({ extraExport: true })),
      /export surface is invalid/,
    );
  });

  it("rejects a named export with the wrong exact function type", () => {
    const bytes = companionKernelFixture({ wrongSignature: true });
    assert.equal(WebAssembly.validate(bytes), true);
    assert.throws(
      () => validateCompanionKernelContract(bytes),
      /exports have invalid function types/,
    );
  });

  // `verify-companion-kernel.mjs` asks the built kernel what its regions are
  // and compares the answers to these constants. It needs a built artifact, so
  // it is not part of `pnpm check` and nothing ran it for two ABI moves — it
  // was still asserting ABI 6 and a 196-byte config against a kernel that had
  // gone to 7 and 296. Nothing there could have caught that; the numbers had no
  // second holder. Here they do: every one is checked against the decoder or
  // the contract that has to agree with it, inside the suite that always runs.
  it("states region sizes the decoder and the config ABI already fix", () => {
    assert.deepEqual(COMPANION_KERNEL_EXPORT_VALUES, {
      companion_abi: COMPANION_KERNEL_EXPORT_VALUES.companion_abi,
      companion_config_bytes: ENHANCEMENT_CONFIG_WORD_COUNT * 4,
      companion_snapshot_bytes: COMPANION_SNAPSHOT_BYTES,
      companion_cursor_bytes: COMPANION_CURSOR_BYTES,
      companion_toolbox_bytes: COMPANION_TOOLBOX_BYTES,
      companion_party_bytes: COMPANION_PARTY_BYTES,
      companion_skill_slot_bytes: COMPANION_KERNEL_EXPORT_VALUES.companion_skill_slot_bytes,
      companion_skill_cooldown_bytes:
        COMPANION_KERNEL_EXPORT_VALUES.companion_skill_cooldown_bytes,
      companion_play_region_bytes: COMPANION_PLAY_REGION_BYTES,
    });
    // One export per value, so a region added to the kernel cannot be left
    // unverified by forgetting to state its size.
    assert.deepEqual(
      Object.keys(COMPANION_KERNEL_EXPORT_VALUES).sort(),
      COMPANION_KERNEL_SIGNATURES
        .map(({ name }) => name)
        .filter((name) => name.endsWith("_bytes") || name === "companion_abi")
        .sort(),
    );
  });

  it("rejects active data writes outside the declared private footprint", () => {
    const bytes = companionKernelFixture({ outOfFootprintData: true });
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
    const bytes = companionKernelFixture();
    writeFileSync(files.candidate, bytes);
    writeFileSync(files.renderer, rendererSource);

    const sha256 = sealCompanionKernelBuild({
      candidatePath: files.candidate,
      artifactPath: files.artifact,
      loaderPath: files.renderer,
    });

    assert.equal(existsSync(files.candidate), false);
    assert.deepEqual(new Uint8Array(readFileSync(files.artifact)), bytes);
    assert.equal(sha256, companionKernelSha256(bytes));
    const renderer = readFileSync(files.renderer, "utf8");
    verifySealedCompanionLoader(renderer, sha256);
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
        loaderPath: files.renderer,
      }),
      /invalid WebAssembly/,
    );
    assert.equal(existsSync(files.artifact), false);
    assert.equal(readFileSync(files.renderer, "utf8"), rendererSource);
  });

  it("removes the artifact and restores the renderer if final publication fails", () => {
    const files = workspace();
    const bytes = companionKernelFixture();
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
        loaderPath: files.renderer,
      }),
      /ENOENT/,
    );
    assert.equal(existsSync(unavailableArtifact), false);
    assert.equal(existsSync(files.candidate), true);
    assert.equal(readFileSync(files.renderer, "utf8"), rendererSource);
  });
});
