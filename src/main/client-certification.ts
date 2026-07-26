import type { ClientCertification } from "./core/client-module.js";
import {
  findTemplateSaveBuild,
  type KnownTemplateSaveBuild,
} from "./core/template-save-compat.js";
import {
  findEnhancementBuild,
  type KnownEnhancementBuild,
} from "./core/enhancement-builds.js";

/**
 * Which of the three certification states an ArenaNet client build is in.
 *
 * The two transforms are chained but keyed by **different** hashes:
 * template-save by the official build's hash, Enhancement by the hash of what the
 * template-save transform *produces*. Certification can therefore succeed at
 * step one and fail at step two — templates saved, cursor gone — and that is
 * the normal intermediate during a recertification, because the transform that
 * breaks saving gets fixed before the one that draws a pointer.
 *
 * Before this module the two answers were two independent gauges that nothing
 * composed, so the intermediate state had no name and no user-facing sentence.
 * This is the single owner: every consumer (the launcher notice, the settings
 * status, the diagnostics gauges, and `enhancements:doctor`) asks here.
 */
export type { ClientCertification } from "./core/client-module.js";

/**
 * The two lookups the chain composes. Injectable because the shipped tables
 * hold exactly one certified build today, so `template-only` is unreachable
 * with real data until a recertification lands — and an unreachable state is
 * exactly the one that rots untested.
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
  if (!templateSave) return { state: "uncertified" };
  const enhancementBuild = tables.enhancement(templateSave.outputSha256);
  return enhancementBuild
    ? {
        state: "certified",
        templateSaveBuild: templateSave,
        enhancementBuild,
      }
    : {
        state: "template-only",
        templateSaveBuild: templateSave,
      };
}
