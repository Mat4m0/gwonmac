/**
 * Chooses the one WebAssembly module a launch serves, and owns the rule that
 * the choice is a chain and not a menu: official then template-save then
 * optional Enhancement, each stage taking the previous stage's output as its
 * input.
 *
 * A derived module is served only when its whole ancestry is certified against
 * the exact official hash in hand. Every refusal degrades by one step and
 * deletes the cache entries it may no longer serve, so a derivative can never
 * be handed to a client it was not derived from. The compatibility state
 * returned here is the state the rest of the app reports; nothing recomputes
 * it downstream.
 */
import {
  enhancementCapabilityProfile,
  enhancementCapabilitiesCover,
  enhancementCapabilitiesForProfile,
  enhancementCapabilitiesRequested,
  ENHANCEMENT_CAPABILITY_FIELDS,
  intersectEnhancementCapabilities,
  NO_ENHANCEMENT_CAPABILITIES,
  ENHANCEMENT_TRANSFORM_ABI,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import type { RequiredFeatureStatus } from "../../shared/contracts.js";
import {
  buildFingerprint,
  type DerivedWasmCache,
  discardDerivedWasm,
  inspectDerivedWasmCache,
  prepareDerivedWasm,
  sha256File,
} from "../core/derived-wasm.js";
import {
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_TRANSFORM_ABI,
  type KnownTemplateSaveBuild,
} from "./template-save-compat.js";
import {
  enhancementOutputSha256,
  enhancementProfilesForBuild,
  supportedEnhancementCapabilities,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import { transformEnhancementWasm } from "./enhancement-transform.js";
import {
  nativeDoubleClickOutputSha256,
  NATIVE_DOUBLE_CLICK_TRANSFORM_ABI,
  rewriteWithBuild,
  type NativeDoubleClickBuild,
} from "./native-double-click.js";
import {
  EXTENDED_MEMORY_MAX_BYTES,
  prepareExtendedMemoryArtifacts,
  type ExtendedMemoryProfile,
  type ExtendedMemoryStructuralProof,
} from "./extended-memory.js";

/**
 * The exact records matched while certifying the official client hash. The
 * preparation path consumes these records directly; it never looks either
 * build up again.
 */
export interface ClientCertification {
  readonly templateSaveBuild: KnownTemplateSaveBuild | null;
  readonly enhancementBuild: KnownEnhancementBuild | null;
}

export interface ClientModulePreparationFailure {
  readonly stage:
    | "template-save"
    | "enhancement"
    | "native-double-click";
  readonly error: unknown;
}

interface PreparedWasmClientModule {
  readonly wasmPath: string;
  /** Authoritative output hash of the last certified stage, never re-derived from the cache. */
  readonly wasmSha256: string;
  readonly gameFileSaving: RequiredFeatureStatus;
  readonly enhancementBuild: KnownEnhancementBuild | null;
  readonly requestedCapabilities: EnhancementCapabilities;
  readonly effectiveCapabilities: EnhancementCapabilities;
  readonly failure: ClientModulePreparationFailure | null;
  /**
   * Whether the served module carries the client's own mouse double-click
   * flag. False means native double-click is unavailable, so this is the
   * renderer's switch and not merely a report.
   */
  readonly nativeDoubleClick: boolean;
}

function productCapabilityCount(capabilities: EnhancementCapabilities): number {
  return ENHANCEMENT_CAPABILITY_FIELDS.reduce(
    (count, field) => count
      + Number(field !== "playRegionObservation" && capabilities[field]),
    0,
  );
}

/** Largest safe profiles first; read-only observations win ties over commands. */
function enhancementCandidates(
  build: KnownEnhancementBuild,
  requested: EnhancementCapabilities,
): EnhancementCapabilities[] {
  const maximum = intersectEnhancementCapabilities(
    requested,
    supportedEnhancementCapabilities(build),
  );
  return enhancementProfilesForBuild(build)
    .flatMap((profile) => {
      const capabilities = enhancementCapabilitiesForProfile(profile);
      return capabilities ? [capabilities] : [];
    })
    .filter((candidate) =>
      enhancementCapabilitiesCover(maximum, candidate)
      && enhancementOutputSha256(build, candidate) !== null)
    .sort((left, right) =>
      productCapabilityCount(right) - productCapabilityCount(left)
      || Number(left.teamApply) - Number(right.teamApply));
}

export type ExtendedMemoryMode =
  | { readonly status: "disabled" }
  | {
      readonly status: "active";
      readonly profile: ExtendedMemoryProfile;
      readonly effectiveCapBytes: typeof EXTENDED_MEMORY_MAX_BYTES;
    }
  | {
      readonly status: "unavailable";
      readonly reason: "unsupported-client";
    }
  | {
      readonly status: "unavailable";
      readonly reason: "preparation-failed";
      readonly error: unknown;
    };

export interface PreparedClientModule extends PreparedWasmClientModule {
  readonly jsPath: string;
  readonly extendedMemory: ExtendedMemoryMode;
}

export interface PrepareClientModuleOptions {
  readonly officialWasmPath: string;
  readonly officialJsPath: string;
  readonly officialSha256: string;
  readonly certification: ClientCertification;
  readonly enhancementCapabilities: EnhancementCapabilities;
  readonly compatibilityCacheRoot: string;
  readonly enhancementCacheRoot: string;
  readonly nativeDoubleClickCacheRoot: string;
  readonly extendedMemoryCacheRoot: string;
  readonly extendedMemoryEnabled: boolean;
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
  capabilities: EnhancementCapabilities,
  cacheRoot: string,
): DerivedWasmCache {
  const expectedOutputSha256 = enhancementOutputSha256(build, capabilities);
  if (expectedOutputSha256 === null) {
    throw new Error("Enhancement capability profile has no certified output");
  }
  const capabilityIdentity = {
    nativeCursor: capabilities.nativeCursor,
    targetObservation: capabilities.targetObservation,
    partyObservation: capabilities.partyObservation,
    teamApply: capabilities.teamApply,
    travelAction: capabilities.travelAction,
    xunlaiAction: capabilities.xunlaiAction,
    chatAliases: capabilities.chatAliases,
    skillSlotGeometry: capabilities.skillSlotGeometry,
    skillCooldownObservation: capabilities.skillCooldownObservation,
    playRegionObservation: capabilities.playRegionObservation,
    preGameControls: capabilities.preGameControls,
  };
  return {
    inputSha256: build.sha256,
    cacheRoot,
    transformAbi: ENHANCEMENT_TRANSFORM_ABI,
    // One cache root owns one derivative. Capabilities are the identity, not
    // their derived hooks: cursor-only and cursor+target use the same entry
    // points but must never share config or a manifest.
    buildFingerprint: buildFingerprint({ build, capabilities: capabilityIdentity }),
    expectedOutputSha256,
  };
}

export async function inspectEnhancementCache(
  build: KnownEnhancementBuild,
  capabilities: EnhancementCapabilities,
  cacheRoot: string,
): Promise<"valid" | "missing-or-invalid"> {
  return inspectDerivedWasmCache(
    enhancementCache(build, capabilities, cacheRoot),
  );
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
 * The last stage, applied to whatever the chain above settled on.
 *
 * It is deliberately not part of the certification *state*: a module it cannot
 * derive is served exactly as the previous stage produced it. The official
 * client remains playable, but no synthetic input path is substituted.
 */
async function withNativeDoubleClick(
  prepared: PreparedWasmClientModule,
  cacheRoot: string,
  verifyLocally: (options: {
    wasmPath: string;
    inputSha256: string;
  }) => Promise<NativeDoubleClickBuild | null>,
): Promise<PreparedWasmClientModule> {
  try {
    const inputSha256 = await sha256File(prepared.wasmPath);
    if (inputSha256 !== prepared.wasmSha256) {
      throw new Error("prepared client cache no longer matches its certified hash");
    }
    const build = await verifyLocally({
      wasmPath: prepared.wasmPath,
      inputSha256,
    });
    const expectedOutputSha256 = build
      ? nativeDoubleClickOutputSha256(build, inputSha256)
      : null;
    if (!build || expectedOutputSha256 === null) {
      await discardDerivedWasm(cacheRoot).catch(() => undefined);
      return prepared;
    }
    return {
      ...prepared,
      wasmPath: await prepareDerivedWasm(
        prepared.wasmPath,
        {
          inputSha256,
          cacheRoot,
          transformAbi: NATIVE_DOUBLE_CLICK_TRANSFORM_ABI,
          buildFingerprint: buildFingerprint(build),
          expectedOutputSha256,
        },
        (base) => rewriteWithBuild(base, build),
      ),
      wasmSha256: expectedOutputSha256,
      nativeDoubleClick: true,
    };
  } catch (error) {
    return {
      ...prepared,
      failure: prepared.failure ?? { stage: "native-double-click", error },
    };
  }
}

export async function prepareClientModule(
  options: PrepareClientModuleOptions,
  verifyNativeDoubleClick: (options: {
    wasmPath: string;
    inputSha256: string;
  }) => Promise<NativeDoubleClickBuild | null> = async () => null,
  verifyExtendedMemory: (options: {
    jsPath: string;
    jsInputSha256: string;
    wasmPath: string;
    wasmInputSha256: string;
  }) => Promise<ExtendedMemoryStructuralProof | null> = async () => null,
): Promise<PreparedClientModule> {
  const prepared = await withNativeDoubleClick(
    await prepareCertifiedChain(options),
    options.nativeDoubleClickCacheRoot,
    verifyNativeDoubleClick,
  );
  if (!options.extendedMemoryEnabled) {
    return {
      ...prepared,
      jsPath: options.officialJsPath,
      extendedMemory: { status: "disabled" },
    };
  }
  try {
    const extended = await prepareExtendedMemoryArtifacts(
      options.officialJsPath,
      options.officialWasmPath,
      prepared.wasmPath,
      prepared.wasmSha256,
      enhancementCapabilityProfile(prepared.effectiveCapabilities) ?? "off",
      options.extendedMemoryCacheRoot,
      verifyExtendedMemory,
    );
    return extended
      ? {
          ...prepared,
          jsPath: extended.jsPath,
          wasmPath: extended.wasmPath,
          wasmSha256: extended.wasmSha256,
          extendedMemory: {
            status: "active",
            profile: extended.profile,
            effectiveCapBytes: EXTENDED_MEMORY_MAX_BYTES,
          },
        }
      : {
          ...prepared,
          jsPath: options.officialJsPath,
          extendedMemory: {
            status: "unavailable",
            reason: "unsupported-client",
          },
        };
  } catch (error) {
    return {
      ...prepared,
      jsPath: options.officialJsPath,
      extendedMemory: {
        status: "unavailable",
        reason: "preparation-failed",
        error,
      },
    };
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
async function prepareCertifiedChain(
  options: PrepareClientModuleOptions,
): Promise<PreparedWasmClientModule> {
  const {
    officialWasmPath,
    officialSha256,
    certification,
    enhancementCapabilities,
    compatibilityCacheRoot,
    enhancementCacheRoot,
  } = options;

  const requestedCapabilities = enhancementCapabilities;
  const templateSaveBuild = certification.templateSaveBuild;
  if (templateSaveBuild === null) {
    return {
      wasmPath: officialWasmPath,
      wasmSha256: officialSha256,
      gameFileSaving: { status: "unavailable", reason: "game-update" },
      enhancementBuild: null,
      requestedCapabilities,
      effectiveCapabilities: NO_ENHANCEMENT_CAPABILITIES,
      nativeDoubleClick: false,
      failure: await discardUnsupportedCaches(
        compatibilityCacheRoot,
        enhancementCacheRoot,
      ),
    };
  }

  if (templateSaveBuild.sha256 !== officialSha256) {
    await discardUnsupportedCaches(compatibilityCacheRoot, enhancementCacheRoot);
    return {
      wasmPath: officialWasmPath,
      wasmSha256: officialSha256,
      gameFileSaving: { status: "unavailable", reason: "preparation-failed" },
      enhancementBuild: null,
      requestedCapabilities,
      effectiveCapabilities: NO_ENHANCEMENT_CAPABILITIES,
      nativeDoubleClick: false,
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
      wasmSha256: officialSha256,
      gameFileSaving: { status: "unavailable", reason: "preparation-failed" },
      enhancementBuild: null,
      requestedCapabilities,
      effectiveCapabilities: NO_ENHANCEMENT_CAPABILITIES,
      nativeDoubleClick: false,
      failure: { stage: "template-save", error },
    };
  }

  const enhancementBuild = certification.enhancementBuild;
  if (enhancementBuild === null) {
    return {
      wasmPath: templateSaveWasm,
      wasmSha256: templateSaveBuild.outputSha256,
      gameFileSaving: { status: "available" },
      enhancementBuild: null,
      requestedCapabilities,
      effectiveCapabilities: NO_ENHANCEMENT_CAPABILITIES,
      nativeDoubleClick: false,
      failure: await discardEnhancementCache(enhancementCacheRoot),
    };
  }

  if (enhancementBuild.sha256 !== templateSaveBuild.outputSha256) {
    await discardDerivedWasm(enhancementCacheRoot).catch(() => undefined);
    return {
      wasmPath: templateSaveWasm,
      wasmSha256: templateSaveBuild.outputSha256,
      gameFileSaving: { status: "available" },
      enhancementBuild: null,
      requestedCapabilities,
      effectiveCapabilities: NO_ENHANCEMENT_CAPABILITIES,
      nativeDoubleClick: false,
      failure: {
        stage: "enhancement",
        error: new Error("Enhancement certification does not match template-save output"),
      },
    };
  }

  if (!enhancementCapabilitiesRequested(enhancementCapabilities)) {
    return {
      wasmPath: templateSaveWasm,
      wasmSha256: templateSaveBuild.outputSha256,
      gameFileSaving: { status: "available" },
      enhancementBuild: null,
      requestedCapabilities,
      effectiveCapabilities: NO_ENHANCEMENT_CAPABILITIES,
      nativeDoubleClick: false,
      failure: await discardEnhancementCache(enhancementCacheRoot),
    };
  }

  let firstFailure: unknown = null;
  for (const candidate of enhancementCandidates(
    enhancementBuild,
    enhancementCapabilities,
  )) {
    try {
      const cache = enhancementCache(enhancementBuild, candidate, enhancementCacheRoot);
      return {
        wasmPath: await prepareDerivedWasm(
          templateSaveWasm,
          cache,
          (base) => transformEnhancementWasm(base, enhancementBuild, candidate),
        ),
        wasmSha256: cache.expectedOutputSha256,
        gameFileSaving: { status: "available" },
        enhancementBuild,
        requestedCapabilities,
        effectiveCapabilities: candidate,
        nativeDoubleClick: false,
        failure: firstFailure === null
          ? null
          : { stage: "enhancement", error: firstFailure },
      };
    } catch (error) {
      firstFailure ??= error;
    }
  }
  return {
    wasmPath: templateSaveWasm,
    wasmSha256: templateSaveBuild.outputSha256,
    gameFileSaving: { status: "available" },
    enhancementBuild,
    requestedCapabilities,
    effectiveCapabilities: NO_ENHANCEMENT_CAPABILITIES,
    nativeDoubleClick: false,
    failure: firstFailure === null
      ? null
      : { stage: "enhancement", error: firstFailure },
  };
}
