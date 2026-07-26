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
import type { KnownToolboxBuild } from "./toolbox-builds.js";
import {
  TOOLBOX_TRANSFORM_ABI,
  transformToolboxWasm,
} from "./toolbox-transform.js";

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
      toolboxBuild: KnownToolboxBuild;
    };

export interface ClientModulePreparationFailure {
  readonly stage: "template-save" | "toolbox";
  readonly error: unknown;
}

export interface PreparedClientModule {
  readonly wasmPath: string;
  readonly state: ClientCompatibilityState;
  readonly toolboxBuild: KnownToolboxBuild | null;
  readonly failure: ClientModulePreparationFailure | null;
}

export interface PrepareClientModuleOptions {
  readonly officialWasmPath: string;
  readonly officialSha256: string;
  readonly certification: ClientCertification;
  readonly toolboxRequested: boolean;
  readonly compatibilityCacheRoot: string;
  readonly toolboxCacheRoot: string;
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

function toolboxCache(
  build: KnownToolboxBuild,
  cacheRoot: string,
): DerivedWasmCache {
  return {
    inputSha256: build.sha256,
    cacheRoot,
    transformAbi: TOOLBOX_TRANSFORM_ABI,
    buildFingerprint: buildFingerprint(build),
    // The kernel is built from source, so its output is verified against the
    // hash recorded during atomic publication rather than a source constant.
    expectedOutputSha256: null,
  };
}

export async function inspectToolboxCache(
  build: KnownToolboxBuild,
  cacheRoot: string,
): Promise<"valid" | "missing-or-invalid"> {
  return inspectDerivedWasmCache(toolboxCache(build, cacheRoot));
}

async function discardUnsupportedCaches(
  compatibilityCacheRoot: string,
  toolboxCacheRoot: string,
): Promise<ClientModulePreparationFailure | null> {
  const [compatibility, toolbox] = await Promise.allSettled([
    discardDerivedWasm(compatibilityCacheRoot),
    discardDerivedWasm(toolboxCacheRoot),
  ]);
  if (compatibility.status === "rejected") {
    return { stage: "template-save", error: compatibility.reason };
  }
  return toolbox.status === "rejected"
    ? { stage: "toolbox", error: toolbox.reason }
    : null;
}

async function discardToolboxCache(
  cacheRoot: string,
): Promise<ClientModulePreparationFailure | null> {
  try {
    await discardDerivedWasm(cacheRoot);
    return null;
  } catch (error) {
    return { stage: "toolbox", error };
  }
}

/**
 * Select and prepare the one client module this launch serves.
 *
 * The chain is fixed: official -> template-save -> optional Toolbox. Unknown
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
    toolboxRequested,
    compatibilityCacheRoot,
    toolboxCacheRoot,
  } = options;

  if (certification.state === "uncertified") {
    return {
      wasmPath: officialWasmPath,
      state: "uncertified",
      toolboxBuild: null,
      failure: await discardUnsupportedCaches(
        compatibilityCacheRoot,
        toolboxCacheRoot,
      ),
    };
  }

  const templateSaveBuild = certification.templateSaveBuild;
  if (templateSaveBuild.sha256 !== officialSha256) {
    await discardUnsupportedCaches(compatibilityCacheRoot, toolboxCacheRoot);
    return {
      wasmPath: officialWasmPath,
      state: "uncertified",
      toolboxBuild: null,
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
    // The Toolbox input cannot exist if its required floor failed. Keep the
    // compatibility cache's last good entry, but remove every Toolbox entry.
    await discardDerivedWasm(toolboxCacheRoot).catch(() => undefined);
    return {
      wasmPath: officialWasmPath,
      state: "uncertified",
      toolboxBuild: null,
      failure: { stage: "template-save", error },
    };
  }

  if (certification.state === "template-only") {
    return {
      wasmPath: templateSaveWasm,
      state: "template-only",
      toolboxBuild: null,
      failure: await discardToolboxCache(toolboxCacheRoot),
    };
  }

  const toolboxBuild = certification.toolboxBuild;
  if (toolboxBuild.sha256 !== templateSaveBuild.outputSha256) {
    await discardDerivedWasm(toolboxCacheRoot).catch(() => undefined);
    return {
      wasmPath: templateSaveWasm,
      state: "template-only",
      toolboxBuild: null,
      failure: {
        stage: "toolbox",
        error: new Error("Toolbox certification does not match template-save output"),
      },
    };
  }

  if (!toolboxRequested) {
    return {
      wasmPath: templateSaveWasm,
      state: "certified",
      toolboxBuild: null,
      failure: await discardToolboxCache(toolboxCacheRoot),
    };
  }

  try {
    return {
      wasmPath: await prepareDerivedWasm(
        templateSaveWasm,
        toolboxCache(toolboxBuild, toolboxCacheRoot),
        (base) => transformToolboxWasm(base, toolboxBuild),
      ),
      state: "certified",
      toolboxBuild,
      failure: null,
    };
  } catch (error) {
    return {
      wasmPath: templateSaveWasm,
      state: "certified",
      toolboxBuild: null,
      failure: { stage: "toolbox", error },
    };
  }
}
