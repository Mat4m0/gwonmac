/**
 * Small boundary projections shared by client selection and rollback paths.
 * They turn verified runtime facts into closed diagnostics values.
 */
import type {
  OptionalFeatureStatus,
  RuntimeEnhancementVerification,
} from "../shared/contracts.js";
import { ENHANCEMENT_CAPABILITY_FIELDS } from "../shared/enhancement-contracts.js";
import { isDigest, type Digest } from "../shared/digest.js";
import type { LocalFeatureVerdicts } from
  "./certification/local-client-verification-contract.js";

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

/** Retain one bounded, closed verdict per capability for the active generation. */
export function runtimeFeatureVerdicts(
  verdicts: LocalFeatureVerdicts | null,
): RuntimeEnhancementVerification["featureVerdicts"] {
  if (!verdicts) return null;
  return Object.freeze(Object.fromEntries(
    ENHANCEMENT_CAPABILITY_FIELDS.map((feature) => {
      const verdict = verdicts[feature];
      return [feature, Object.freeze({
        status: verdict.status === "not-requested" ? "off" : verdict.status,
        invariant: "invariant" in verdict ? verdict.invariant : null,
        candidates: verdict.status === "ambiguous" ? verdict.candidates : null,
      })];
    }),
  )) as RuntimeEnhancementVerification["featureVerdicts"];
}
