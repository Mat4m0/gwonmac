/**
 * The two exact lookups in the client transformation chain.
 *
 * The transforms are keyed by **different** hashes:
 * template-save by the official build's hash, Enhancement by the hash of what the
 * template-save transform *produces*. Certification can therefore succeed at
 * step one and fail at step two — templates saved, cursor gone — and that is
 * the normal intermediate during a recertification, because the transform that
 * breaks saving gets fixed before the one that draws a pointer.
 *
 * Effective per-feature status is produced after preparation in client-runtime;
 * this file owns only the canonical exact-build lookups.
 */
import type { ClientCertification } from "./client-module.js";
import {
  findTemplateSaveBuild,
  type KnownTemplateSaveBuild,
} from "./template-save-compat.js";
import {
  findEnhancementBuild,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import type { LocalClientVerification } from "./local-client-verifier.js";
import {
  enhancementCapabilitiesRequested,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";

export type { ClientCertification } from "./client-module.js";

/**
 * The two lookups the chain composes. Injectable so the intermediate
 * template-save-only case remains directly testable.
 */
export interface CertifiedBuildTables {
  templateSave: (sha256: string) => KnownTemplateSaveBuild | null;
  enhancement: (sha256: string) => KnownEnhancementBuild | null;
}

const SHIPPED_TABLES: CertifiedBuildTables = {
  templateSave: findTemplateSaveBuild,
  enhancement: findEnhancementBuild,
};

export function certifyClientBuild(
  officialSha256: string,
  tables: CertifiedBuildTables = SHIPPED_TABLES,
): ClientCertification {
  const templateSave = tables.templateSave(officialSha256);
  if (!templateSave) {
    return { templateSaveBuild: null, enhancementBuild: null };
  }
  return {
    templateSaveBuild: templateSave,
    enhancementBuild: tables.enhancement(templateSave.outputSha256),
  };
}

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

/** Unknown proof is derived only when its result can affect this launch. */
export function shouldVerifyClientLocally(
  certification: ClientCertification,
  capabilities: EnhancementCapabilities,
): boolean {
  return certification.templateSaveBuild === null
    || (
      certification.enhancementBuild === null
      && enhancementCapabilitiesRequested(capabilities)
    );
}
