/**
 * Small boundary projections shared by client selection and rollback paths.
 * They turn verified runtime facts into closed diagnostics values.
 */
import type { OptionalFeatureStatus } from "../shared/contracts.js";
import { isDigest, type Digest } from "../shared/digest.js";

/** Convert a verified client fingerprint into the diagnostics schema safely. */
export function diagnosticDigest(
  value: string | null | undefined,
): Digest | null {
  return typeof value === "string" && isDigest(value) ? value : null;
}

/** Explain why one requested enhancement did or did not reach the renderer. */
export function optionalFeatureStatus(
  requested: boolean,
  effective: boolean,
  supported: boolean,
  preparationFailed: boolean,
): OptionalFeatureStatus {
  if (!requested) return { status: "off" };
  if (effective) return { status: "available" };
  return {
    status: "unavailable",
    reason: supported && preparationFailed
      ? "preparation-failed"
      : "game-update",
  };
}
