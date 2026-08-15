/**
 * One patch-day comparison result for both the local command and CI.
 *
 * This is evidence, not authority. In particular, an `exact` memory or
 * command result never changes the shipped certificate by itself.
 */
import {
  findEnhancementBuild,
  type KnownEnhancementBuild,
} from "../main/certification/enhancement-builds.js";
import type { EnhancementRecertificationReport } from "./enhancement-recert.js";
import type { inspectTemplateSaveCandidate } from "./template-save-recert.js";

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
  /** Canonical facts are embedded only for an already certified exact build. */
  readonly canonicalCertificate: KnownEnhancementBuild | null;
}

function evidenceStatus(
  enhancement: EnhancementRecertificationReport,
  feature: "cursor" | "target" | "party" | "commands" | "storage",
): CarryForwardStatus {
  if (enhancement.bundleVerified) return "exact";
  if (!enhancement.candidateInspected) return "not-located";

  const evidence = enhancement.structuralEvidence;
  if (feature === "cursor") {
    if (evidence.cursor.status === "ambiguous") return "ambiguous";
    return evidence.cursor.status === "candidate" ? "changed" : "not-located";
  }
  if (feature === "party") {
    if (evidence.playerChatUi.status === "ambiguous") return "ambiguous";
    return evidence.playerChatUi.status === "candidate"
      ? "changed"
      : "not-located";
  }

  // No locator exists for these facts yet. Inspectability is not location.
  return "not-located";
}

export function createCarryForwardReport(
  templateSave: TemplateSaveReport,
  enhancement: EnhancementRecertificationReport,
  nativeDoubleClick: CarryForwardStatus = "not-located",
  generatedAt = new Date().toISOString(),
): CarryForwardReport {
  const canonicalCertificate = enhancement.candidateInspected
    ? findEnhancementBuild(enhancement.sha256)
    : null;
  const gameFileSaving: CarryForwardStatus =
    templateSave.status === "certified" || templateSave.status === "derived"
      ? "exact"
      : "not-located";

  return {
    schemaVersion: 1,
    officialSha256: enhancement.officialSha256,
    generatedAt,
    capabilities: {
      gameFileSaving,
      nativeDoubleClick,
      nativeCursor: evidenceStatus(enhancement, "cursor"),
      targetObservation: evidenceStatus(enhancement, "target"),
      partyObservation: evidenceStatus(enhancement, "party"),
      teamApply: evidenceStatus(enhancement, "commands"),
      xunlaiStorage: evidenceStatus(enhancement, "storage"),
    },
    templateSave,
    enhancement,
    canonicalCertificate,
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
