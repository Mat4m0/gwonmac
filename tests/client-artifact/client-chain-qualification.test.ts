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
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "../../src/main/certification/local-client-verifier.js";
import {
  deriveNativeDoubleClickBuild,
  isDerivedNativeDoubleClickBuild,
  rewriteNativeDoubleClickWasm,
} from "../../src/main/certification/native-double-click.js";
import { rewriteExtendedMemoryWasm } from
  "../../src/main/certification/extended-memory.js";
import { rewriteTemplateSaveWasm } from
  "../../src/main/certification/template-save-compat.js";
import {
  enhancementCapabilityProfile,
  RELEASE_ENHANCEMENT_CAPABILITIES,
} from "../../src/shared/enhancement-contracts.js";

const sha256 = (bytes: Uint8Array): string =>
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
    const prepare = async (): Promise<PreparedClientModule> => prepareClientModule({
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
      nativeDoubleClickCacheRoot: join(cacheRoot, "double-click"),
      extendedMemoryCacheRoot: join(cacheRoot, "memory"),
      extendedMemoryEnabled: false,
    }, async ({ wasmPath, inputSha256 }) => {
      const input = new Uint8Array(await readFile(wasmPath));
      assert.equal(sha256(input), inputSha256);
      return deriveNativeDoubleClickBuild(input);
    });
    try {
      const prepared = await prepare();
      assert.equal(prepared.failure, null);
      assert.equal(prepared.nativeDoubleClick, true);
      assert.deepEqual(prepared.effectiveCapabilities, capabilities);
      assert.equal(sha256(await readFile(prepared.wasmPath)), prepared.wasmSha256);

      // A matching directory name is not authority. The production cache must
      // reject and reproduce a corrupted final derivative from its exact input.
      await writeFile(prepared.wasmPath, "stale release qualification cache");
      const rebuilt = await prepare();
      assert.equal(rebuilt.failure, null);
      assert.equal(rebuilt.nativeDoubleClick, true);
      assert.equal(rebuilt.wasmSha256, prepared.wasmSha256);
      assert.equal(sha256(await readFile(rebuilt.wasmPath)), rebuilt.wasmSha256);
    } finally {
      await rm(cacheRoot, { recursive: true, force: true });
    }
  }
});
