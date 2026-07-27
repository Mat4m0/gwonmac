import type { ClientCompatibilityState } from "../../shared/contracts.js";
import {
  buildFingerprint,
  type DerivedWasmCache,
  discardDerivedWasm,
  inspectDerivedWasmCache,
  prepareDerivedWasm,
} from "./derived-wasm.js";
import {
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_TRANSFORM_ABI,
  type KnownTemplateSaveBuild,
} from "./template-save-compat.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import {
  ENHANCEMENT_TRANSFORM_ABI,
  transformEnhancementWasm,
} from "./enhancement-transform.js";

/**
 * The exact records matched while certifying the official client hash. The
 * preparation path consumes these records directly; it never looks either
 * build up again.
 */
export type ClientCertification =
  | { state: "uncertified" }
  | {
      state: "template-only";
      templateSaveBuild: KnownTemplateSaveBuild;
    }
  | {
      state: "certified";
      templateSaveBuild: KnownTemplateSaveBuild;
      enhancementBuild: KnownEnhancementBuild;
    };

export interface ClientModulePreparationFailure {
  readonly stage: "template-save" | "enhancement";
  readonly error: unknown;
}

export interface PreparedClientModule {
  readonly wasmPath: string;
  readonly state: ClientCompatibilityState;
  readonly enhancementBuild: KnownEnhancementBuild | null;
  readonly failure: ClientModulePreparationFailure | null;
}

export interface PrepareClientModuleOptions {
  readonly officialWasmPath: string;
  readonly officialSha256: string;
  readonly certification: ClientCertification;
  readonly enhancementRequested: boolean;
  readonly compatibilityCacheRoot: string;
  readonly enhancementCacheRoot: string;
}

function templateSaveCache(
  build: KnownTemplateSaveBuild,
  cacheRoot: string,
): DerivedWasmCache {
  return {
    inputSha256: build.sha256,
    cacheRoot,
    transformAbi: TEMPLATE_SAVE_TRANSFORM_ABI,
    buildFingerprint: buildFingerprint(build),
    expectedOutputSha256: build.outputSha256,
  };
}

function enhancementCache(
  build: KnownEnhancementBuild,
  cacheRoot: string,
): DerivedWasmCache {
  return {
    inputSha256: build.sha256,
    cacheRoot,
    transformAbi: ENHANCEMENT_TRANSFORM_ABI,
    buildFingerprint: buildFingerprint(build),
    // The kernel is built from source, so its output is verified against the
    // hash recorded during atomic publication rather than a source constant.
    expectedOutputSha256: null,
  };
}

export async function inspectEnhancementCache(
  build: KnownEnhancementBuild,
  cacheRoot: string,
): Promise<"valid" | "missing-or-invalid"> {
  return inspectDerivedWasmCache(enhancementCache(build, cacheRoot));
}

async function discardUnsupportedCaches(
  compatibilityCacheRoot: string,
  enhancementCacheRoot: string,
): Promise<ClientModulePreparationFailure | null> {
  const [compatibility, enhancement] = await Promise.allSettled([
    discardDerivedWasm(compatibilityCacheRoot),
    discardDerivedWasm(enhancementCacheRoot),
  ]);
  if (compatibility.status === "rejected") {
    return { stage: "template-save", error: compatibility.reason };
  }
  return enhancement.status === "rejected"
    ? { stage: "enhancement", error: enhancement.reason }
    : null;
}

async function discardEnhancementCache(
  cacheRoot: string,
): Promise<ClientModulePreparationFailure | null> {
  try {
    await discardDerivedWasm(cacheRoot);
    return null;
  } catch (error) {
    return { stage: "enhancement", error };
  }
}

/**
 * Select and prepare the one client module this launch serves.
 *
 * The chain is fixed: official -> template-save -> optional Enhancement. Unknown
 * and disabled stages delete caches they cannot use. A transform failure is
 * graceful and leaves the last good cache intact, but never serves it for a
 * different input.
 */
export async function prepareClientModule(
  options: PrepareClientModuleOptions,
): Promise<PreparedClientModule> {
  const {
    officialWasmPath,
    officialSha256,
    certification,
    enhancementRequested,
    compatibilityCacheRoot,
    enhancementCacheRoot,
  } = options;

  if (certification.state === "uncertified") {
    return {
      wasmPath: officialWasmPath,
      state: "uncertified",
      enhancementBuild: null,
      failure: await discardUnsupportedCaches(
        compatibilityCacheRoot,
        enhancementCacheRoot,
      ),
    };
  }

  const templateSaveBuild = certification.templateSaveBuild;
  if (templateSaveBuild.sha256 !== officialSha256) {
    await discardUnsupportedCaches(compatibilityCacheRoot, enhancementCacheRoot);
    return {
      wasmPath: officialWasmPath,
      state: "uncertified",
      enhancementBuild: null,
      failure: {
        stage: "template-save",
        error: new Error("template-save certification does not match client hash"),
      },
    };
  }

  let templateSaveWasm: string;
  try {
    templateSaveWasm = await prepareDerivedWasm(
      officialWasmPath,
      templateSaveCache(templateSaveBuild, compatibilityCacheRoot),
      (base) => rewriteTemplateSaveWasm(base, templateSaveBuild),
    );
  } catch (error) {
    // The Enhancement input cannot exist if its required floor failed. Keep the
    // compatibility cache's last good entry, but remove every Enhancement entry.
    await discardDerivedWasm(enhancementCacheRoot).catch(() => undefined);
    return {
      wasmPath: officialWasmPath,
      state: "uncertified",
      enhancementBuild: null,
      failure: { stage: "template-save", error },
    };
  }

  if (certification.state === "template-only") {
    return {
      wasmPath: templateSaveWasm,
      state: "template-only",
      enhancementBuild: null,
      failure: await discardEnhancementCache(enhancementCacheRoot),
    };
  }

  if (!enhancementRequested) {
    return {
      wasmPath: templateSaveWasm,
      state: "certified",
      enhancementBuild: null,
      failure: await discardEnhancementCache(enhancementCacheRoot),
    };
  }

  const enhancementBuild = certification.enhancementBuild;
  if (enhancementBuild.sha256 !== templateSaveBuild.outputSha256) {
    await discardDerivedWasm(enhancementCacheRoot).catch(() => undefined);
    return {
      wasmPath: templateSaveWasm,
      state: "template-only",
      enhancementBuild: null,
      failure: {
        stage: "enhancement",
        error: new Error("Enhancement certification does not match template-save output"),
      },
    };
  }

  try {
    return {
      wasmPath: await prepareDerivedWasm(
        templateSaveWasm,
        enhancementCache(enhancementBuild, enhancementCacheRoot),
        (base) => transformEnhancementWasm(base, enhancementBuild),
      ),
      state: "certified",
      enhancementBuild,
      failure: null,
    };
  } catch (error) {
    return {
      wasmPath: templateSaveWasm,
      state: "certified",
      enhancementBuild: null,
      failure: { stage: "enhancement", error },
    };
  }
}
