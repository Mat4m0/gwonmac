import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const START = "<!-- gwonmac-verification:start -->";
const END = "<!-- gwonmac-verification:end -->";
const PENDING = "Pending";

export interface MachineVerification {
  workflowUrl: string;
  targetCommit: string;
  applicationVersion: string;
  bundleVersion: string;
  checksums: readonly string[];
}

export interface ManualVerification {
  status: "Pending" | "Passed";
  testedAt: string;
  macModel: string;
  memory: string;
  macOSVersion: string;
  arenaNetSha256: string;
  dmgResult: "Pending" | "Passed" | "Not required — no packaging-sensitive change";
}

export interface VerificationRecord {
  machine: MachineVerification;
  manual: ManualVerification;
}

const pendingManual = (): ManualVerification => ({
  status: "Pending",
  testedAt: PENDING,
  macModel: PENDING,
  memory: PENDING,
  macOSVersion: PENDING,
  arenaNetSha256: PENDING,
  dmgResult: "Pending",
});

function oneLine(label: string, value: string): string {
  if (!value || /[\r\n`]/u.test(value)) {
    throw new Error(`${label} must be one non-empty Markdown-safe line`);
  }
  return value;
}

export function checksumDigest(rows: readonly string[]): string {
  return createHash("sha256").update(`${rows.join("\n")}\n`).digest("hex");
}

export function renderVerificationRecord(record: VerificationRecord): string {
  const { machine, manual } = record;
  const rows = machine.checksums.map((row) => oneLine("checksum row", row));
  if (rows.length === 0) throw new Error("verification needs checksum rows");
  return [
    START,
    "## Verification",
    "",
    `- Status: \`${oneLine("status", manual.status)}\``,
    `- Workflow: ${oneLine("workflow URL", machine.workflowUrl)}`,
    `- Target commit: \`${oneLine("target commit", machine.targetCommit)}\``,
    `- Application version: \`${oneLine("application version", machine.applicationVersion)}\``,
    `- macOS bundle version: \`${oneLine("bundle version", machine.bundleVersion)}\``,
    `- Checksum file SHA-256: \`${checksumDigest(rows)}\``,
    `- Tested at: \`${oneLine("test timestamp", manual.testedAt)}\``,
    `- Mac model: \`${oneLine("Mac model", manual.macModel)}\``,
    `- Memory: \`${oneLine("memory", manual.memory)}\``,
    `- macOS: \`${oneLine("macOS version", manual.macOSVersion)}\``,
    `- ArenaNet client SHA-256: \`${oneLine("ArenaNet SHA-256", manual.arenaNetSha256)}\``,
    `- DMG: \`${oneLine("DMG result", manual.dmgResult)}\``,
    "",
    "### Checksums",
    "",
    "```text",
    ...rows,
    "```",
    END,
  ].join("\n");
}

function markers(body: string): { start: number; end: number } | null {
  const starts = [...body.matchAll(new RegExp(START, "gu"))];
  const ends = [...body.matchAll(new RegExp(END, "gu"))];
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error("release notes must contain at most one complete Verification block");
  }
  const start = starts[0]!.index;
  const end = ends[0]!.index + END.length;
  if (end <= start) throw new Error("Verification block markers are out of order");
  return { start, end };
}

function field(block: string, label: string): string {
  const match = block.match(new RegExp(`^- ${label}: (?:\\x60([^\\x60]+)\\x60|(https://\\S+))$`, "mu"));
  const value = match?.[1] ?? match?.[2];
  if (!value) throw new Error(`Verification block is missing ${label}`);
  return value;
}

export function parseVerificationRecord(body: string): VerificationRecord | null {
  const location = markers(body);
  if (!location) return null;
  const block = body.slice(location.start, location.end);
  const checksumMatch = block.match(/### Checksums\n\n```text\n([\s\S]*?)\n```/u);
  if (!checksumMatch) throw new Error("Verification block has no checksum section");
  const checksums = checksumMatch[1]!.split("\n").filter(Boolean);
  const status = field(block, "Status");
  const dmgResult = field(block, "DMG");
  if (status !== "Pending" && status !== "Passed") {
    throw new Error(`unknown verification status ${status}`);
  }
  if (
    dmgResult !== "Pending"
    && dmgResult !== "Passed"
    && dmgResult !== "Not required — no packaging-sensitive change"
  ) {
    throw new Error(`unknown DMG result ${dmgResult}`);
  }
  const record: VerificationRecord = {
    machine: {
      workflowUrl: field(block, "Workflow"),
      targetCommit: field(block, "Target commit"),
      applicationVersion: field(block, "Application version"),
      bundleVersion: field(block, "macOS bundle version"),
      checksums,
    },
    manual: {
      status,
      testedAt: field(block, "Tested at"),
      macModel: field(block, "Mac model"),
      memory: field(block, "Memory"),
      macOSVersion: field(block, "macOS"),
      arenaNetSha256: field(block, "ArenaNet client SHA-256"),
      dmgResult,
    },
  };
  if (field(block, "Checksum file SHA-256") !== checksumDigest(checksums)) {
    throw new Error("Verification checksum digest does not match its rows");
  }
  return record;
}

function sameAssets(a: MachineVerification, b: MachineVerification): boolean {
  return a.targetCommit === b.targetCommit
    && a.applicationVersion === b.applicationVersion
    && a.bundleVersion === b.bundleVersion
    && checksumDigest(a.checksums) === checksumDigest(b.checksums);
}

function sameMachine(a: MachineVerification, b: MachineVerification): boolean {
  return sameAssets(a, b) && a.workflowUrl === b.workflowUrl;
}

export function replaceVerificationRecord(
  body: string,
  record: VerificationRecord,
): string {
  const location = markers(body);
  const rendered = renderVerificationRecord(record);
  if (!location) return `${body.trimEnd()}\n\n${rendered}\n`;
  return `${body.slice(0, location.start)}${rendered}${body.slice(location.end)}`;
}

export function stageVerificationRecord(
  body: string,
  machine: MachineVerification,
): string {
  const existing = parseVerificationRecord(body);
  if (existing?.manual.status === "Passed") {
    if (!sameMachine(existing.machine, machine)) {
      throw new Error("refusing to overwrite passed verification for different assets");
    }
    return body;
  }
  return replaceVerificationRecord(body, { machine, manual: pendingManual() });
}

export function assertPublishableVerification(
  body: string,
  machine: MachineVerification,
): void {
  const record = parseVerificationRecord(body);
  if (!record || !sameMachine(record.machine, machine)) {
    throw new Error("Verification record does not belong to these exact release assets");
  }
  if (record.manual.status !== "Passed") {
    throw new Error("exact-draft gameplay verification is still Pending");
  }
  for (const [name, value] of Object.entries(record.manual)) {
    if (value === PENDING) throw new Error(`manual verification field ${name} is Pending`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record.manual.testedAt)) {
    throw new Error("manual verification timestamp is not canonical UTC");
  }
  if (!/^[0-9a-f]{64}$/u.test(record.manual.arenaNetSha256)) {
    throw new Error("ArenaNet client SHA-256 is not a digest");
  }
}

function machineFromArgs(args: readonly string[]): MachineVerification {
  const [checksumsPath, workflowUrl, targetCommit, applicationVersion, bundleVersion] = args;
  if (!checksumsPath || !workflowUrl || !targetCommit || !applicationVersion || !bundleVersion) {
    throw new Error("missing Verification machine-evidence argument");
  }
  return {
    workflowUrl,
    targetCommit,
    applicationVersion,
    bundleVersion,
    checksums: readFileSync(checksumsPath, "utf8").trimEnd().split(/\r?\n/u),
  };
}

function main(): void {
  const [operation, bodyPath, ...args] = process.argv.slice(2);
  if (!operation || !bodyPath) {
    throw new Error("usage: release-verification-record <stage|publish|workflow-url> ...");
  }
  const body = readFileSync(bodyPath, "utf8");
  if (operation === "stage") {
    const outputPath = args.at(-1);
    if (!outputPath) throw new Error("stage needs an output path");
    writeFileSync(outputPath, stageVerificationRecord(body, machineFromArgs(args.slice(0, -1))));
  } else if (operation === "publish") {
    assertPublishableVerification(body, machineFromArgs(args));
  } else if (operation === "workflow-url") {
    const record = parseVerificationRecord(body);
    if (!record) throw new Error("release notes have no Verification record");
    process.stdout.write(record.machine.workflowUrl);
  } else {
    throw new Error(`unknown operation ${operation}`);
  }
}

if (process.argv[1]?.endsWith("release-verification-record.ts")) main();
