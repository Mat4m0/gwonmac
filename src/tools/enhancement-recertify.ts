/**
 * `pnpm enhancements:recertify`: derives a candidate Enhancement build entry
 * from a client this repository does not yet know, and prints the evidence
 * behind it.
 *
 * It proposes; a human certifies. The output is a draft table entry plus the
 * structural findings that produced it, and every output hash is obtained by
 * actually running the transform rather than by prediction. Nothing here edits
 * the shipped tables — an entry becomes certified when a person reads the
 * evidence and commits it.
 *
 * It recovers indices, not semantics. What the hooked functions mean still has
 * to be re-measured; `internal/upstream/recertify.md` owns that work.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  type EnhancementCapabilityProfile,
} from "../shared/contracts.js";
import {
  inspectEnhancementCandidate,
  transformEnhancementWasm,
  type EnhancementCandidateReport,
} from "../main/core/enhancement-transform.js";
import {
  ENHANCEMENT_BUILDS,
  enhancementOutputSha256,
  findEnhancementBuild,
  type EnhancementOutputHashes,
} from "../main/core/enhancement-builds.js";
import {
  inspectEnhancementStructuralEvidence,
  type EnhancementStructuralEvidenceReport,
  type PlayerChatMessageAnchors,
} from "./enhancement-structural-evidence.js";
import { defaultGuildWarsProfile } from "./enhancement-doctor.js";
import {
  preparePostTemplateSaveModule,
  type PostTemplateSaveModule,
  type TemplateSaveResolution,
} from "../main/core/template-save-verifier.js";

interface EnhancementRecertificationFailure {
  readonly officialSha256: string;
  readonly templateSaveApplied: false;
  readonly templateSaveResolution: "underivable" | "transform-failed";
  readonly candidateInspected: false;
  readonly structuralEvidence: null;
  readonly derivedOutputSha256: null;
  readonly bundleVerified: false;
  readonly bundleFailure: string;
}

interface EnhancementRecertificationSuccess
  extends EnhancementCandidateReport {
  readonly officialSha256: string;
  readonly templateSaveApplied: true;
  readonly templateSaveResolution: TemplateSaveResolution;
  readonly candidateInspected: true;
  readonly structuralEvidence: EnhancementStructuralEvidenceReport;
  readonly derivedOutputSha256: EnhancementOutputHashes | null;
  readonly bundleVerified: boolean;
  readonly bundleFailure: string | null;
}

export type EnhancementRecertificationReport =
  | EnhancementRecertificationFailure
  | EnhancementRecertificationSuccess;

function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "template-save transform failed";
}

/** Inspect only the post-template module that the application would serve. */
export function recertifyEnhancementBytes(
  official: Uint8Array,
  messageAnchors: PlayerChatMessageAnchors,
): EnhancementRecertificationReport {
  const officialSha256 = createHash("sha256").update(official).digest("hex");
  let postTemplate: PostTemplateSaveModule | null;
  try {
    postTemplate = preparePostTemplateSaveModule(official);
  } catch (error) {
    return {
      officialSha256,
      templateSaveApplied: false,
      templateSaveResolution: "transform-failed",
      candidateInspected: false,
      structuralEvidence: null,
      derivedOutputSha256: null,
      bundleVerified: false,
      bundleFailure: `template-save transform failed: ${failureMessage(error)}`,
    };
  }
  if (!postTemplate) {
    return {
      officialSha256,
      templateSaveApplied: false,
      templateSaveResolution: "underivable",
      candidateInspected: false,
      structuralEvidence: null,
      derivedOutputSha256: null,
      bundleVerified: false,
      bundleFailure:
        "template-save structure could not be verified; enhancement candidate was not inspected",
    };
  }

  const report = inspectEnhancementCandidate(postTemplate.bytes);
  const structuralEvidence = inspectEnhancementStructuralEvidence(
    postTemplate.bytes,
    messageAnchors,
  );
  return finishPostTemplateEnhancementReport(
    officialSha256,
    postTemplate.bytes,
    postTemplate.resolution,
    report,
    structuralEvidence,
  );
}

/** Build review evidence from the exact post-template bytes, never a grant. */
export function inspectPostTemplateEnhancementBytes(
  officialSha256: string,
  postTemplate: Uint8Array,
  templateSaveResolution: TemplateSaveResolution,
  messageAnchors: PlayerChatMessageAnchors,
): EnhancementRecertificationSuccess {
  const report = inspectEnhancementCandidate(postTemplate);
  const structuralEvidence = inspectEnhancementStructuralEvidence(
    postTemplate,
    messageAnchors,
  );
  return finishPostTemplateEnhancementReport(
    officialSha256,
    postTemplate,
    templateSaveResolution,
    report,
    structuralEvidence,
  );
}

function finishPostTemplateEnhancementReport(
  officialSha256: string,
  postTemplate: Uint8Array,
  templateSaveResolution: TemplateSaveResolution,
  report: EnhancementCandidateReport,
  structuralEvidence: EnhancementStructuralEvidenceReport,
): EnhancementRecertificationSuccess {
  const certified = findEnhancementBuild(report.sha256);
  let derivedOutputSha256: EnhancementOutputHashes | null = null;
  let bundleVerified = false;
  let bundleFailure: string | null = null;
  if (certified) {
    try {
      const derived = {} as Record<EnhancementCapabilityProfile, string>;
      for (const profile of Object.keys(ENHANCEMENT_CAPABILITY_PROFILES) as
        EnhancementCapabilityProfile[]) {
        const capabilities = ENHANCEMENT_CAPABILITY_PROFILES[profile];
        const output = transformEnhancementWasm(
          postTemplate,
          certified,
          capabilities,
        );
        derived[profile] = createHash("sha256").update(output).digest("hex");
      }
      derivedOutputSha256 = Object.freeze(derived);
      for (const profile of Object.keys(ENHANCEMENT_CAPABILITY_PROFILES) as
        EnhancementCapabilityProfile[]) {
        const expected = enhancementOutputSha256(
          certified,
          ENHANCEMENT_CAPABILITY_PROFILES[profile],
        );
        if (expected === null || derivedOutputSha256[profile] !== expected) {
          throw new Error(
            `derived ${profile} output ${derivedOutputSha256[profile]} is not certified`,
          );
        }
      }
      bundleVerified = true;
    } catch (error) {
      bundleFailure = error instanceof Error ? error.message : "transform failed";
    }
  }
  return {
    officialSha256,
    templateSaveApplied: true,
    templateSaveResolution,
    candidateInspected: true,
    structuralEvidence,
    derivedOutputSha256,
    ...report,
    bundleVerified,
    bundleFailure,
  };
}

function currentMessageAnchors(): PlayerChatMessageAnchors {
  const baseline = ENHANCEMENT_BUILDS.at(-1);
  if (!baseline) {
    throw new Error("enhancement recertification has no semantic baseline");
  }
  return Object.freeze({
    playerChatMessage: baseline.uiDispatcher.playerChatMessage,
    nearbyPlayerMessages: Object.freeze([
      baseline.uiDispatcher.nearbyPlayerMessages[0],
      baseline.uiDispatcher.nearbyPlayerMessages[1],
    ] as [number, number]),
  });
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2)
    .filter((argument) => argument !== "--")
    .filter((argument) => !argument.startsWith("--"));
  if (positional.length > 1) {
    process.stderr.write("usage: enhancements:recertify [path/to/Gw.jspi.wasm]\n");
    process.exitCode = 2;
    return;
  }
  const filename = positional[0] ?? path.join(
    defaultGuildWarsProfile(),
    "game",
    "artifacts",
    "Gw.jspi.wasm",
  );
  const official = await readFile(filename);
  const report = recertifyEnhancementBytes(official, currentMessageAnchors());
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.candidateInspected) process.exitCode = 2;
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
