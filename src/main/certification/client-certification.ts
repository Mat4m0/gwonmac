/**
 * Converts isolated semantic-verifier results into the client preparation
 * contract. Historic exact rows never enter this launch-authority boundary.
 */
import type { ClientCertification } from "./client-module.js";
import type { LocalClientVerification } from "./local-client-verifier.js";

export type { ClientCertification } from "./client-module.js";

/**
 * Convert a proof made by the isolated local verifier into the one canonical
 * launch decision. A partial proof deliberately preserves template saving
 * while leaving enhancement tools disabled.
 */
export function certificationFromLocalVerification(
  verification: LocalClientVerification,
): ClientCertification {
  return {
    templateSaveBuild: verification.templateSaveBuild,
    enhancementBuild: verification.enhancementBuild,
  };
}
