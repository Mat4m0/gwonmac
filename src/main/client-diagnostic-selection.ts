/**
 * Selection of untouched client artifacts for profiles that prohibit every
 * transform, including the requested 4 GB transform.
 */
import {
  WASM_HEAP_CAP_BYTES,
  type ClientTransforms,
  type DiagnosticProfile,
  type ExtendedMemoryRuntimeStatus,
} from "../shared/contracts.js";
import { diagnosticProfilePolicy } from "../shared/diagnostic-profile.js";
import { clientArtifactPath, type GamePaths } from "./core/paths.js";
import { logEvent } from "./diagnostics.js";

export interface DiagnosticClientSelection {
  wasmPath: string;
  jsPath: string;
  compatibility: null;
  extendedMemory: ExtendedMemoryRuntimeStatus;
  transforms: ClientTransforms;
}

export function selectOfficialDiagnosticClient(options: Readonly<{
  paths: GamePaths;
  profile: DiagnosticProfile;
  extendedMemoryEnabled: boolean;
}>): DiagnosticClientSelection | null {
  if (!diagnosticProfilePolicy(options.profile).officialClient) return null;

  const extendedMemory: ExtendedMemoryRuntimeStatus = options.extendedMemoryEnabled
    ? {
        requestedAtLaunch: true,
        status: "unavailable",
        effectiveCapBytes: WASM_HEAP_CAP_BYTES,
        fallbackReason: "diagnostic-profile",
      }
    : {
        requestedAtLaunch: false,
        status: "standard",
        effectiveCapBytes: WASM_HEAP_CAP_BYTES,
        fallbackReason: null,
      };
  logEvent({
    k: "wasm.extendedMemory",
    mode: options.extendedMemoryEnabled ? "unavailable" : "disabled",
    requested: options.extendedMemoryEnabled,
    profile: "none",
    capBytes: extendedMemory.effectiveCapBytes,
    fallbackReason: options.extendedMemoryEnabled ? "diagnostic-profile" : "none",
  });
  return {
    wasmPath: clientArtifactPath(options.paths.artifacts, "Gw.jspi.wasm"),
    jsPath: clientArtifactPath(options.paths.artifacts, "Gw.jspi.js"),
    compatibility: null,
    extendedMemory,
    transforms: { templateSave: false, nativeDoubleClick: false },
  };
}
