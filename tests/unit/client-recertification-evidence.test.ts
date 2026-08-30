/** The durable patch-day record keeps proof facts and drops locator internals. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createClientRecertificationEvidence } from
  "../../scripts/client-recertification-evidence.js";
import { ENHANCEMENT_CAPABILITY_FIELDS } from
  "../../src/shared/enhancement-contracts.js";
import { LOCAL_FEATURE_INVARIANTS } from
  "../../src/main/certification/local-client-verification-contract.js";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

test("retains bounded generation evidence without paths or raw addresses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gwonmac-client-evidence-"));
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const js = "const client = true;";
  const wasmDigest = sha256(wasm);
  const jsDigest = sha256(js);
  const outputDigest = sha256("output");
  const fileOutputDigest = sha256("file-output");
  const feature601Input = sha256("features-e01-input");
  const feature601DoubleClick = sha256("features-e01-double-click");
  const feature7ffInput = sha256("features-fff-input");
  const feature7ffDoubleClick = sha256("features-fff-double-click");
  const generation = sha256("generation");
  const commit = "a".repeat(40);
  const files = {
    wasm: path.join(root, "Gw.jspi.wasm"),
    js: path.join(root, "Gw.jspi.js"),
    runtime: path.join(root, "runtime.json"),
    qualification: path.join(root, "qualification.json"),
    doubleClick: path.join(root, "double-click.json"),
    extendedMemory: path.join(root, "extended-memory.json"),
  };
  const doubleClick = {
    status: "proved",
    exitCode: 0,
    officialSha256: wasmDigest,
    chains: [{
      profile: "file-compatible",
      inputSha256: fileOutputDigest,
      outputSha256: outputDigest,
    }, {
      profile: "features-e01",
      inputSha256: feature601Input,
      outputSha256: feature601DoubleClick,
      enhancementInputSha256: fileOutputDigest,
    }, {
      profile: "features-fff",
      inputSha256: feature7ffInput,
      outputSha256: feature7ffDoubleClick,
      enhancementInputSha256: fileOutputDigest,
    }],
    completeRouteProved: true,
    callbackFunctionIndex: 2448,
  };
  const extendedMemory = {
    status: "proved",
    exitCode: 0,
    jsInputSha256: jsDigest,
    jsOutputSha256: outputDigest,
    normalizedJsSha256: sha256("normalized"),
    variants: [{
      profile: "off",
      inputSha256: outputDigest,
      outputSha256: outputDigest,
      pointerAddress: 0x1234,
    }, {
      profile: "features-e01",
      inputSha256: feature601DoubleClick,
      outputSha256: outputDigest,
    }, {
      profile: "features-fff",
      inputSha256: feature7ffDoubleClick,
      outputSha256: outputDigest,
    }],
    heapBytes: 3_529_244_672,
    highPointerUnsigned: 2_522_561_552,
    crossed3GiB: true,
    freedBlockReusedWithoutGrowth: true,
  };
  const args = [
    generation,
    files.wasm,
    files.js,
    files.runtime,
    files.qualification,
    files.doubleClick,
    files.extendedMemory,
  ];
  const environment = {
    GITHUB_REPOSITORY: "lupinum-dev/gwonmac",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: commit,
  };
  try {
    await Promise.all([
      writeFile(files.wasm, wasm),
      writeFile(files.js, js),
      writeFile(files.runtime, JSON.stringify({
        officialSha256: wasmDigest,
        verifierAbi: 7,
        fileVerdict: {
          status: "proved",
          inputSha256: wasmDigest,
          verifierAbi: 7,
          outputSha256: fileOutputDigest,
          rawAddress: 0x5a0ee0,
        },
        templateSaving: true,
        features: {
          ...Object.fromEntries(Object.keys(LOCAL_FEATURE_INVARIANTS).map(
            (name) => [name, { status: "proved" }],
          )),
          nativeCursor: {
            status: "proved",
            functionIndex: 2448,
          },
        },
        capabilities: Object.fromEntries(
          ENHANCEMENT_CAPABILITY_FIELDS.map((name) => [name, true]),
        ),
        reasons: [],
        localPath: "/private/client.wasm",
      })),
      writeFile(files.qualification, JSON.stringify({
        status: "proved",
        exitCode: 0,
        officialSha256: wasmDigest,
        log: "must not survive",
      })),
      writeFile(files.doubleClick, JSON.stringify(doubleClick)),
      writeFile(files.extendedMemory, JSON.stringify(extendedMemory)),
    ]);
    const evidence = await createClientRecertificationEvidence(args, environment);
    const serialized = JSON.stringify(evidence);
    assert.equal(evidence.codeGeneration, generation);
    assert.equal(record(evidence.artifacts).wasm !== undefined, true);
    assert.doesNotMatch(
      serialized,
      /rawAddress|functionIndex|pointerAddress|highPointerUnsigned|localPath|private|2522561552/u,
    );
    assert.deepEqual(record(record(evidence.runtime).features).nativeCursor, {
      status: "proved",
    });
    assert.deepEqual(evidence.outcome, {
      status: "ready",
      reason: "all-required-evidence-proved",
    });

    const refusalCases = [{
      doubleClick: {
        ...doubleClick,
        chains: doubleClick.chains.slice(1),
      },
      extendedMemory,
      reason: "base-profile-missing",
    }, {
      doubleClick,
      extendedMemory: {
        ...extendedMemory,
        variants: extendedMemory.variants.slice(1),
      },
      reason: "base-profile-missing",
    }, {
      doubleClick,
      extendedMemory: {
        ...extendedMemory,
        variants: extendedMemory.variants.map((variant) =>
          variant.profile === "features-e01"
            ? { ...variant, inputSha256: sha256("wrong-chain") }
            : variant),
      },
      reason: "transform-chain-mismatch",
    }, {
      doubleClick: {
        ...doubleClick,
        chains: doubleClick.chains.map((chain) =>
          chain.profile === "features-e01"
            ? { ...chain, enhancementInputSha256: sha256("wrong-enhancement-input") }
            : chain),
      },
      extendedMemory,
      reason: "enhancement-input-mismatch",
    }, {
      doubleClick: {
        ...doubleClick,
        chains: doubleClick.chains.map((chain) =>
          chain.profile === "file-compatible"
            ? { ...chain, inputSha256: sha256("wrong-selected-input") }
            : chain),
      },
      extendedMemory,
      reason: "selected-input-mismatch",
    }];
    for (const refusal of refusalCases) {
      await Promise.all([
        writeFile(files.doubleClick, JSON.stringify(refusal.doubleClick)),
        writeFile(files.extendedMemory, JSON.stringify(refusal.extendedMemory)),
      ]);
      const rejected = await createClientRecertificationEvidence(args, environment);
      assert.deepEqual(rejected.outcome, {
        status: "investigation",
        reason: refusal.reason,
      });
    }
    for (const invalidDoubleClick of [{
      ...doubleClick,
      chains: doubleClick.chains.map((chain) =>
        chain.profile === "features-e01"
          ? {
              profile: chain.profile,
              inputSha256: chain.inputSha256,
              outputSha256: chain.outputSha256,
            }
          : chain),
    }, {
      ...doubleClick,
      chains: doubleClick.chains.map((chain) =>
        chain.profile === "file-compatible"
          ? { ...chain, enhancementInputSha256: fileOutputDigest }
          : chain),
    }]) {
      await Promise.all([
        writeFile(files.doubleClick, JSON.stringify(invalidDoubleClick)),
        writeFile(files.extendedMemory, JSON.stringify(extendedMemory)),
      ]);
      const rejected = await createClientRecertificationEvidence(args, environment);
      assert.deepEqual(rejected.nativeDoubleClick, {
        status: "unavailable",
        reason: "evidence-collection-failed",
      });
      assert.deepEqual(rejected.outcome, {
        status: "investigation",
        reason: "evidence-collection-failed",
      });
    }
    await Promise.all([
      writeFile(files.doubleClick, JSON.stringify(doubleClick)),
      writeFile(files.qualification, JSON.stringify({
        status: "proved",
        exitCode: 0,
      })),
    ]);
    const unboundQualification = await createClientRecertificationEvidence(
      args,
      environment,
    );
    assert.deepEqual(unboundQualification.qualification, {
      status: "unavailable",
      reason: "evidence-collection-failed",
    });
    assert.deepEqual(unboundQualification.outcome, {
      status: "investigation",
      reason: "evidence-collection-failed",
    });
    await Promise.all([
      writeFile(files.doubleClick, JSON.stringify(doubleClick)),
      writeFile(files.qualification, JSON.stringify({
        status: "proved",
        exitCode: 0,
        officialSha256: sha256("wrong-official-artifact"),
      })),
    ]);
    await assert.rejects(
      createClientRecertificationEvidence(args, environment),
      /evidence files do not describe the supplied official artifacts/u,
    );
    await writeFile(files.qualification, JSON.stringify({
      status: "proved",
      exitCode: 0,
      officialSha256: wasmDigest,
    }));
    for (const fileVerdict of [{
      status: "refused",
      inputSha256: wasmDigest,
      verifierAbi: 7,
      reason: "template-shape-changed",
    }, {
      status: "proved",
      inputSha256: sha256("wrong-input"),
      outputSha256: outputDigest,
      verifierAbi: 7,
    }, {
      status: "proved",
      inputSha256: wasmDigest,
      outputSha256: outputDigest,
      verifierAbi: 8,
    }]) {
      await Promise.all([
        writeFile(files.runtime, JSON.stringify({
          ...record(evidence.runtime),
          fileVerdict,
          templateSaving: true,
        })),
        writeFile(files.doubleClick, JSON.stringify(doubleClick)),
        writeFile(files.extendedMemory, JSON.stringify(extendedMemory)),
      ]);
      const rejected = await createClientRecertificationEvidence(args, environment);
      assert.deepEqual(rejected.runtime, {
        status: "unavailable",
        reason: "evidence-collection-failed",
      });
      assert.equal(record(rejected.outcome).status, "investigation");
    }
    await writeFile(files.runtime, JSON.stringify({
      ...record(evidence.runtime),
      verifierAbi: 8,
      fileVerdict: {
        ...record(record(evidence.runtime).fileVerdict),
        verifierAbi: 8,
      },
    }));
    const wrongSourceAbi = await createClientRecertificationEvidence(args, environment);
    assert.deepEqual(wrongSourceAbi.runtime, {
      status: "unavailable",
      reason: "evidence-collection-failed",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects poison strings and contradictory proved states", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gwonmac-client-evidence-"));
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const js = "const client = true;";
  const wasmDigest = sha256(wasm);
  const jsDigest = sha256(js);
  const outputDigest = sha256("output");
  const poison = "/Users/private/0x5a0ee0";
  const files = {
    wasm: path.join(root, "Gw.jspi.wasm"),
    js: path.join(root, "Gw.jspi.js"),
    runtime: path.join(root, "runtime.json"),
    qualification: path.join(root, "qualification.json"),
    doubleClick: path.join(root, "double-click.json"),
    extendedMemory: path.join(root, "extended-memory.json"),
  };
  try {
    await Promise.all([
      writeFile(files.wasm, wasm),
      writeFile(files.js, js),
      writeFile(files.runtime, JSON.stringify({
        officialSha256: wasmDigest,
        verifierAbi: 7,
        fileVerdict: null,
        templateSaving: false,
        features: {
          ...Object.fromEntries(Object.keys(LOCAL_FEATURE_INVARIANTS).map(
            (name) => [name, { status: "proved" }],
          )),
          nativeCursor: { status: "proved", invariant: poison },
        },
        capabilities: Object.fromEntries(
          ENHANCEMENT_CAPABILITY_FIELDS.map((name) => [name, true]),
        ),
        reasons: [],
      })),
      writeFile(files.qualification, JSON.stringify({
        status: "proved",
        exitCode: 1,
        officialSha256: wasmDigest,
      })),
      writeFile(files.doubleClick, JSON.stringify({
        status: "proved",
        exitCode: 0,
        officialSha256: wasmDigest,
        chains: [{
          profile: poison,
          inputSha256: wasmDigest,
          outputSha256: outputDigest,
        }],
        completeRouteProved: false,
      })),
      writeFile(files.extendedMemory, JSON.stringify({
        status: "proved",
        exitCode: 0,
        jsInputSha256: jsDigest,
        jsOutputSha256: outputDigest,
        normalizedJsSha256: sha256("normalized"),
        variants: [{
          profile: poison,
          inputSha256: wasmDigest,
          outputSha256: outputDigest,
        }],
        heapBytes: 3_529_244_672,
        crossed3GiB: false,
        freedBlockReusedWithoutGrowth: false,
      })),
    ]);
    const evidence = await createClientRecertificationEvidence([
      sha256("generation"),
      files.wasm,
      files.js,
      files.runtime,
      files.qualification,
      files.doubleClick,
      files.extendedMemory,
    ], {
      GITHUB_REPOSITORY: "lupinum-dev/gwonmac",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: "b".repeat(40),
    });
    const serialized = JSON.stringify(evidence);
    assert.doesNotMatch(serialized, /Users|0x5a0ee0/u);
    for (const section of [
      evidence.runtime,
      evidence.qualification,
      evidence.nativeDoubleClick,
      evidence.extendedMemory,
    ]) {
      assert.deepEqual(section, {
        status: "unavailable",
        reason: "evidence-collection-failed",
      });
    }
    assert.deepEqual(evidence.outcome, {
      status: "investigation",
      reason: "evidence-collection-failed",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retains artifact identities when a detailed evidence tool crashes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gwonmac-client-evidence-"));
  const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const js = "const client = true;";
  const paths = ["runtime", "qualification", "double-click", "extended-memory"]
    .map((name) => path.join(root, `${name}.json`));
  try {
    const wasmPath = path.join(root, "Gw.jspi.wasm");
    const jsPath = path.join(root, "Gw.jspi.js");
    await Promise.all([writeFile(wasmPath, wasm), writeFile(jsPath, js)]);
    const evidence = await createClientRecertificationEvidence([
      sha256("generation"),
      wasmPath,
      jsPath,
      ...paths,
    ], {
      GITHUB_REPOSITORY: "lupinum-dev/gwonmac",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: "c".repeat(40),
    });
    assert.equal(record(record(evidence.artifacts).wasm).sha256, sha256(wasm));
    assert.deepEqual(evidence.runtime, {
      status: "unavailable",
      reason: "evidence-collection-failed",
    });
    assert.doesNotMatch(JSON.stringify(evidence), new RegExp(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
