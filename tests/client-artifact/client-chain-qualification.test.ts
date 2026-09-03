/** Exact real-client qualification for both shipped transform profiles. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareClientModule, type PreparedClientModule } from
  "../../src/main/certification/client-module.js";
import {
  enhancementOutputSha256,
} from "../../src/main/certification/enhancement-builds.js";
import { transformEnhancementWasm } from
  "../../src/main/certification/enhancement-transform.js";
import { deriveFriendObserverCertificate } from
  "../../src/main/certification/friend-observer-certificate.js";
import { deriveFriendObserverBuild } from
  "../../src/main/certification/friend-observer-transform.js";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "../../src/main/certification/local-client-verifier.js";
import {
  deriveNativeDoubleClickBuild,
  isDerivedNativeDoubleClickBuild,
  rewriteNativeDoubleClickWasm,
} from "../../src/main/certification/native-double-click.js";
import { deriveCartographySpikeBuild } from
  "../../src/main/certification/cartography-spike-verifier.js";
import {
  deriveExtendedMemoryStructuralProof,
  rewriteExtendedMemoryWasm,
} from
  "../../src/main/certification/extended-memory.js";
import { rewriteTemplateSaveWasm } from
  "../../src/main/certification/template-save-compat.js";
import {
  enhancementCapabilityProfile,
  RELEASE_ENHANCEMENT_CAPABILITIES,
} from "../../src/shared/enhancement-contracts.js";

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

test("every shipped runtime profile reproduces the real client chain", async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  const glue = process.env.GW_CLIENT_JS;
  assert.ok(artifact, "GW_CLIENT_WASM must name the real Gw.jspi.wasm artifact");
  assert.ok(glue, "GW_CLIENT_JS must name the matching real Gw.jspi.js artifact");
  const official = new Uint8Array(await readFile(artifact));
  const verified = verifyLocalClientBytes(official);
  assert.equal(isLocalClientVerification(verified, sha256(official)), true);
  const templateBuild = verified.templateSaveBuild;
  assert.ok(templateBuild, "the real client must pass file compatibility proof");
  const template = rewriteTemplateSaveWasm(official, templateBuild);
  assert.ok(
    deriveFriendObserverCertificate(template),
    "friend observation must prove against the template-save predecessor",
  );
  const enhancementBuild = verified.enhancementBuild;
  assert.ok(enhancementBuild, "the file output must pass feature proof");
  const templateDoubleClick = deriveNativeDoubleClickBuild(template);
  assert.ok(templateDoubleClick, "the complete native input route must prove");
  assert.equal(
    isDerivedNativeDoubleClickBuild(templateDoubleClick, sha256(template)),
    true,
  );
  rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(template));
  for (const [launch, capabilities] of Object.entries(
    RELEASE_ENHANCEMENT_CAPABILITIES,
  )) {
    const profile = enhancementCapabilityProfile(capabilities);
    assert.ok(profile, `${launch} release capabilities must form a profile`);
    const profileVerification = verifyLocalClientBytes(official, capabilities);
    const profileBuild = profileVerification.enhancementBuild;
    assert.ok(profileBuild, `profile ${profile} must prove independently`);
    const enhanced = transformEnhancementWasm(template, profileBuild, capabilities);
    assert.ok(
      deriveFriendObserverCertificate(enhanced),
      `friend observation must prove against the ${profile} predecessor`,
    );
    assert.equal(
      sha256(enhanced),
      enhancementOutputSha256(profileBuild, capabilities),
    );
    const doubleClick = deriveNativeDoubleClickBuild(enhanced);
    assert.equal(
      isDerivedNativeDoubleClickBuild(doubleClick, sha256(enhanced)),
      true,
      `profile ${profile} must independently prove native double-click`,
    );
    rewriteExtendedMemoryWasm(rewriteNativeDoubleClickWasm(enhanced));

    const cacheRoot = await mkdtemp(join(tmpdir(), `gwonmac-${launch}-chain-`));
    const prepare = async (friendProof = true): Promise<PreparedClientModule> => prepareClientModule({
      officialWasmPath: artifact,
      officialJsPath: glue,
      officialSha256: sha256(official),
      certification: {
        templateSaveBuild: profileVerification.templateSaveBuild,
        enhancementBuild: profileBuild,
      },
      enhancementCapabilities: capabilities,
      compatibilityCacheRoot: join(cacheRoot, "file"),
      enhancementCacheRoot: join(cacheRoot, "enhancement"),
      friendObserver: {
        cacheRoot: join(cacheRoot, "friends"),
        verifyLocally: async ({ wasmPath, inputSha256 }) => {
          const input = new Uint8Array(await readFile(wasmPath));
          assert.equal(sha256(input), inputSha256);
          return friendProof ? deriveFriendObserverBuild(input) : null;
        },
      },
      cartographySpike: {
        cacheRoot: join(cacheRoot, "cartography"),
        verifyLocally: async ({ wasmPath, inputSha256 }) => {
          const input = new Uint8Array(await readFile(wasmPath));
          assert.equal(sha256(input), inputSha256);
          return deriveCartographySpikeBuild(input);
        },
      },
      nativeDoubleClickCacheRoot: join(cacheRoot, "double-click"),
      extendedMemoryCacheRoot: join(cacheRoot, "memory"),
      extendedMemoryEnabled: true,
    }, async ({ wasmPath, inputSha256 }) => {
      const input = new Uint8Array(await readFile(wasmPath));
      assert.equal(sha256(input), inputSha256);
      return deriveNativeDoubleClickBuild(input);
    }, async ({ jsPath, jsInputSha256, wasmPath, wasmInputSha256 }) => {
      const [jsInput, wasmInput] = await Promise.all([
        readFile(jsPath, "utf8"),
        readFile(wasmPath),
      ]);
      assert.equal(sha256(jsInput), jsInputSha256);
      assert.equal(sha256(wasmInput), wasmInputSha256);
      return deriveExtendedMemoryStructuralProof(jsInput, wasmInput);
    });
    try {
      const prepared = await prepare();
      assert.equal(prepared.failure, null);
      assert.equal(prepared.friendObserver.status, capabilities.travelAction ? "active" : "disabled");
      assert.deepEqual(prepared.cartography, { status: "active" });
      assert.equal(prepared.nativeDoubleClick, true);
      assert.equal(prepared.extendedMemory.status, "active");
      assert.deepEqual(prepared.effectiveCapabilities, capabilities);
      assert.equal(sha256(await readFile(prepared.wasmPath)), prepared.wasmSha256);

      // A matching directory name is not authority. The production cache must
      // reject and reproduce a corrupted final derivative from its exact input.
      await writeFile(prepared.wasmPath, "stale release qualification cache");
      const rebuilt = await prepare();
      assert.equal(rebuilt.failure, null);
      assert.deepEqual(rebuilt.cartography, { status: "active" });
      assert.equal(rebuilt.nativeDoubleClick, true);
      assert.equal(rebuilt.extendedMemory.status, "active");
      assert.equal(rebuilt.wasmSha256, prepared.wasmSha256);
      assert.equal(sha256(await readFile(rebuilt.wasmPath)), rebuilt.wasmSha256);
      if (capabilities.travelAction) {
        const refused = await prepare(false);
        assert.equal(refused.friendObserver.status, "unavailable");
        assert.equal(refused.failure, null);
        assert.deepEqual(refused.effectiveCapabilities, capabilities);
        assert.equal(refused.nativeDoubleClick, true);
        assert.equal(refused.extendedMemory.status, "active");
      }
    } finally {
      await rm(cacheRoot, { recursive: true, force: true });
    }
  }
});
