import {
  buildFingerprint,
  discardDerivedWasm,
  prepareDerivedWasm,
} from "./derived-wasm.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_TRANSFORM_ABI,
} from "./template-save-compat.js";

/**
 * Produce the module this launch serves. The caller passes the official
 * module's hash because it has already certified the build with it: whether
 * this build is certified is `client-certification.ts`'s answer, not a second
 * boolean returned from here. An uncertified build drops any derived module
 * left behind by the previous one and gets ArenaNet's own.
 */
export async function prepareTemplateSaveClient(
  officialWasmPath: string,
  inputSha256: string,
  cacheRoot: string,
): Promise<string> {
  const build = findTemplateSaveBuild(inputSha256);
  if (!build) {
    await discardDerivedWasm(cacheRoot);
    return officialWasmPath;
  }

  return prepareDerivedWasm(
    officialWasmPath,
    {
      inputSha256,
      cacheRoot,
      transformAbi: TEMPLATE_SAVE_TRANSFORM_ABI,
      buildFingerprint: buildFingerprint(build),
      // The transform's output is pinned in the source, so a cache entry has
      // to match that constant, not just its own metadata.
      expectedOutputSha256: build.outputSha256,
    },
    (base) => rewriteTemplateSaveWasm(base, build),
  );
}
