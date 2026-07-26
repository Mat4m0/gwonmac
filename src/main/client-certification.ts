import type { ClientCompatibilityState } from "../shared/contracts.js";
import {
  findTemplateSaveBuild,
  type KnownTemplateSaveBuild,
} from "./core/template-save-compat.js";
import {
  findToolboxBuild,
  type KnownToolboxBuild,
} from "./core/toolbox-builds.js";

/**
 * Which of the three certification states an ArenaNet client build is in.
 *
 * The two transforms are chained but keyed by **different** hashes:
 * template-save by the official build's hash, Toolbox by the hash of what the
 * template-save transform *produces*. Certification can therefore succeed at
 * step one and fail at step two — templates saved, cursor gone — and that is
 * the normal intermediate during a recertification, because the transform that
 * breaks saving gets fixed before the one that draws a pointer.
 *
 * Before this module the two answers were two independent gauges that nothing
 * composed, so the intermediate state had no name and no user-facing sentence.
 * This is the single owner: every consumer (the launcher notice, the settings
 * status, the diagnostics gauges, and `toolbox:doctor`) asks here.
 */
export type ClientCertification =
  | { state: "uncertified" }
  | { state: "template-only"; templateSaveOutputSha256: string }
  | {
      state: "certified";
      templateSaveOutputSha256: string;
      toolboxBuild: KnownToolboxBuild;
    };

/**
 * The two lookups the chain composes. Injectable because the shipped tables
 * hold exactly one certified build today, so `template-only` is unreachable
 * with real data until a recertification lands — and an unreachable state is
 * exactly the one that rots untested.
 */
export interface CertifiedBuildTables {
  templateSave: (sha256: string) => KnownTemplateSaveBuild | null;
  toolbox: (sha256: string) => KnownToolboxBuild | null;
}

const SHIPPED_TABLES: CertifiedBuildTables = {
  templateSave: findTemplateSaveBuild,
  toolbox: findToolboxBuild,
};

export function certifyClientBuild(
  officialSha256: string,
  tables: CertifiedBuildTables = SHIPPED_TABLES,
): ClientCertification {
  const templateSave = tables.templateSave(officialSha256);
  if (!templateSave) return { state: "uncertified" };
  const toolboxBuild = tables.toolbox(templateSave.outputSha256);
  return toolboxBuild
    ? {
        state: "certified",
        templateSaveOutputSha256: templateSave.outputSha256,
        toolboxBuild,
      }
    : {
        state: "template-only",
        templateSaveOutputSha256: templateSave.outputSha256,
      };
}

/**
 * The hard rule, with no override and no setting that can reach past it: the
 * Toolbox kernel patches `__indirect_function_table` at offsets derived from
 * one specific certified build. Against any other module that is not degraded
 * behaviour, it is unsafe behaviour, so it does not run at all.
 */
export function toolboxMayLoad(state: ClientCompatibilityState): boolean {
  return state === "certified";
}
