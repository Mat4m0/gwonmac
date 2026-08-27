/**
 * One patch-day comparison result for both the local command and CI.
 *
 * This is evidence, not authority. In particular, an `exact` memory or
 * command result never changes the shipped certificate by itself.
 */
import type { EnhancementRecertificationReport } from "./enhancement-recert.js";
import type { inspectTemplateSaveCandidate } from "./template-save-recert.js";
import type {
  LocalClientVerification,
  LocalFeatureVerdict,
} from "../main/certification/local-client-verifier.js";

export type CarryForwardStatus =
  | "exact"
  | "changed"
  | "ambiguous"
  | "not-located";

type TemplateSaveReport = ReturnType<typeof inspectTemplateSaveCandidate>;

export interface CarryForwardReport {
  readonly schemaVersion: 1;
  readonly officialSha256: string;
  readonly generatedAt: string;
  readonly capabilities: {
    readonly gameFileSaving: CarryForwardStatus;
    readonly nativeDoubleClick: CarryForwardStatus;
    readonly nativeCursor: CarryForwardStatus;
    readonly targetObservation: CarryForwardStatus;
    readonly partyObservation: CarryForwardStatus;
    readonly teamApply: CarryForwardStatus;
    readonly xunlaiStorage: CarryForwardStatus;
  };
  readonly templateSave: TemplateSaveReport;
  readonly enhancement: EnhancementRecertificationReport;
}

function verdictStatus(
  verdict: LocalFeatureVerdict<keyof NonNullable<
    LocalClientVerification["featureVerdicts"]
  >>,
): CarryForwardStatus {
  switch (verdict.status) {
    case "proved": return "exact";
    case "changed": return "changed";
    case "ambiguous": return "ambiguous";
    case "not-requested": return "not-located";
  }
}

export function createCarryForwardReport(
  verification: LocalClientVerification,
  templateSave: TemplateSaveReport,
  enhancement: EnhancementRecertificationReport,
  nativeDoubleClick: CarryForwardStatus = "not-located",
  generatedAt = new Date().toISOString(),
): CarryForwardReport {
  const gameFileSaving: CarryForwardStatus = verification.fileVerdict === null
    ? "not-located"
    : verification.fileVerdict.status === "proved" ? "exact" : "changed";
  const features = verification.featureVerdicts;
  const feature = (
    name: keyof NonNullable<LocalClientVerification["featureVerdicts"]>,
  ): CarryForwardStatus => features === null
    ? "not-located"
    : verdictStatus(features[name]);

  return {
    schemaVersion: 1,
    officialSha256: verification.officialSha256,
    generatedAt,
    capabilities: {
      gameFileSaving,
      nativeDoubleClick,
      nativeCursor: feature("nativeCursor"),
      targetObservation: feature("targetObservation"),
      partyObservation: feature("partyObservation"),
      teamApply: feature("teamApply"),
      xunlaiStorage: feature("xunlaiAction"),
    },
    templateSave,
    enhancement,
  };
}

const LABELS: Readonly<Record<keyof CarryForwardReport["capabilities"], string>> = {
  gameFileSaving: "Guild Wars file saving",
  nativeDoubleClick: "Native double-click repair",
  nativeCursor: "Guild Wars cursor",
  targetObservation: "Target observation",
  partyObservation: "Party observation",
  teamApply: "Apply team",
  xunlaiStorage: "Xunlai storage",
};

export function formatCarryForwardMarkdown(report: CarryForwardReport): string {
  const rows = Object.entries(report.capabilities).map(
    ([feature, status]) =>
      `| ${LABELS[feature as keyof typeof LABELS]} | ${status} |`,
  );
  return [
    "## Guild Wars patch comparison",
    "",
    `- SHA-256: \`${report.officialSha256}\``,
    `- Generated: ${report.generatedAt}`,
    "",
    "| Capability | Result |",
    "| --- | --- |",
    ...rows,
    "",
    "`exact` is review evidence. It does not authorize memory reads or Apply team on a new build.",
    "",
  ].join("\n");
}
