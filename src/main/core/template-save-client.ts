import {
  buildFingerprint,
  discardDerivedWasm,
  prepareDerivedWasm,
  sha256File,
} from "./derived-wasm.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_TRANSFORM_ABI,
} from "./template-save-compat.js";

export async function prepareTemplateSaveClient(
  officialWasmPath: string,
  cacheRoot: string,
): Promise<{ wasmPath: string; compatible: boolean }> {
  const inputSha256 = await sha256File(officialWasmPath);
  const build = findTemplateSaveBuild(inputSha256);
  if (!build) {
    await discardDerivedWasm(cacheRoot);
    return { wasmPath: officialWasmPath, compatible: false };
  }

  const wasmPath = await prepareDerivedWasm(
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
  return { wasmPath, compatible: true };
}
