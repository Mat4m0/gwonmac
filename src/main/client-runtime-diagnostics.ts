/**
 * The effective client state included in diagnostics exports, derived from
 * the one active generation rather than from saved player intent.
 */
import type {
  DiagnosticProfile,
  RuntimeDiagnosticState,
} from "../shared/contracts.js";
import type { EnhancementCapabilities } from "../shared/enhancement-contracts.js";
import { diagnosticProfilePolicy } from "../shared/diagnostic-profile.js";
import type { ActiveClient } from "./active-client.js";
import { clientArtifactPath, type GamePaths } from "./core/paths.js";
import { sha256File } from "./core/derived-wasm.js";

export async function readClientRuntimeDiagnosticState(options: Readonly<{
  active: ActiveClient | null;
  paths: GamePaths;
  diagnosticProfile: DiagnosticProfile;
  extendedMemoryEnabled: boolean;
  enhancementCapabilities: EnhancementCapabilities;
}>): Promise<RuntimeDiagnosticState> {
  const {
    active,
    paths,
    diagnosticProfile,
    extendedMemoryEnabled,
    enhancementCapabilities,
  } = options;
  if (!active) {
    return {
      status: "preparing",
      diagnosticProfile,
      extendedMemoryRequested: extendedMemoryEnabled,
      enhancementCapabilitiesRequested: enhancementCapabilities,
    };
  }

  const officialWasmPath = clientArtifactPath(paths.artifacts, "Gw.jspi.wasm");
  const officialJsPath = clientArtifactPath(paths.artifacts, "Gw.jspi.js");
  const [selectedWasmSha256, selectedJsSha256, officialJsSha256] = await Promise.all([
    sha256File(active.wasmPath).catch(() => null),
    sha256File(active.jsPath).catch(() => null),
    sha256File(officialJsPath).catch(() => null),
  ]);
  const untouched = active.wasmPath === officialWasmPath
    && active.jsPath === officialJsPath;
  const policy = diagnosticProfilePolicy(diagnosticProfile);

  return {
    status: "active",
    generation: active.generation,
    diagnosticProfile,
    presentationPath: policy.presentationPath === "direct"
      ? "direct-canvas"
      : "offscreen-imagebitmap",
    artifactKind: untouched ? "official" : "derived",
    officialWasmSha256: active.compatibility?.clientSha256
      ?? (untouched ? selectedWasmSha256 : null),
    officialJsSha256,
    selectedWasmSha256,
    selectedJsSha256,
    extendedMemoryRequested: extendedMemoryEnabled,
    extendedMemoryEffective: active.extendedMemory,
    enhancementCapabilitiesRequested: enhancementCapabilities,
    enhancementFeaturesEffective: active.compatibility?.features ?? null,
    transforms: active.transforms,
    observers: {
      heapGrowth: true,
      textureCalls: policy.glOverrides,
      glProgramCache: policy.glOverrides,
    },
    snapshot: {
      size: active.store.size,
      chunkSize: active.store.chunkSize,
      chunkCount: active.store.hashes.length,
    },
  };
}
