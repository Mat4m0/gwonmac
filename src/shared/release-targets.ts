import {
  formatReleaseVersion,
  parseReleaseVersion,
} from "./release.js";

const PLATFORMS = ["darwin", "win32", "linux"] as const;
const ARCHITECTURES = ["arm64", "x64"] as const;
const FORMATS = ["zip", "squirrel", "deb"] as const;
const AVAILABILITIES = ["public-preview", "ci-preview"] as const;

export type ReleasePlatform = (typeof PLATFORMS)[number];
export type ReleaseArchitecture = (typeof ARCHITECTURES)[number];
export type ReleaseFormat = (typeof FORMATS)[number];
export type ReleaseAvailability = (typeof AVAILABILITIES)[number];

export interface ReleaseTarget {
  readonly id: string;
  readonly platform: ReleasePlatform;
  readonly arch: ReleaseArchitecture;
  readonly format: ReleaseFormat;
  readonly filenameTemplate: string;
  readonly availability: ReleaseAvailability;
}

export interface ReleaseTargetsDocument {
  readonly formatVersion: 1;
  readonly targets: readonly ReleaseTarget[];
}

const SUPPORTED_COMBINATIONS = new Set([
  "darwin:arm64:zip",
  "win32:x64:squirrel",
  "linux:x64:deb",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`release target ${field} is invalid`);
  }
  return value as T;
}

function targetFilenameTemplate(value: unknown, format: ReleaseFormat): string {
  if (
    typeof value !== "string"
    || value.includes("/")
    || value.includes("\\")
    || value.match(/\{version\}/gu)?.length !== 1
    || value.replace("{version}", "").includes("{")
    || value.replace("{version}", "").includes("}")
  ) {
    throw new Error("release target filenameTemplate is invalid");
  }
  const extension = format === "zip"
    ? ".zip"
    : format === "squirrel"
      ? ".exe"
      : ".deb";
  if (!value.endsWith(extension)) {
    throw new Error(`release target ${format} filename has the wrong extension`);
  }
  return value;
}

function parseTarget(value: unknown): ReleaseTarget {
  if (!isRecord(value)) throw new Error("release target must be an object");
  const keys = Object.keys(value).sort();
  const expected = [
    "arch",
    "availability",
    "filenameTemplate",
    "format",
    "id",
    "platform",
  ];
  if (keys.join("\0") !== expected.sort().join("\0")) {
    throw new Error("release target fields are invalid");
  }
  if (
    typeof value.id !== "string"
    || !/^[a-z][a-z0-9-]{2,31}$/u.test(value.id)
  ) {
    throw new Error("release target id is invalid");
  }
  const platform = oneOf(value.platform, PLATFORMS, "platform");
  const arch = oneOf(value.arch, ARCHITECTURES, "arch");
  const format = oneOf(value.format, FORMATS, "format");
  const availability = oneOf(
    value.availability,
    AVAILABILITIES,
    "availability",
  );
  if (!SUPPORTED_COMBINATIONS.has(`${platform}:${arch}:${format}`)) {
    throw new Error("release target combination is unsupported");
  }
  return Object.freeze({
    id: value.id,
    platform,
    arch,
    format,
    filenameTemplate: targetFilenameTemplate(value.filenameTemplate, format),
    availability,
  });
}

export function releaseTargetFilename(
  target: ReleaseTarget,
  version: string,
): string {
  const parsed = parseReleaseVersion(version);
  if (!parsed || formatReleaseVersion(parsed) !== version) {
    throw new Error("release target version is not canonical");
  }
  return target.filenameTemplate.replace("{version}", version);
}

export function parseReleaseTargets(value: unknown): ReleaseTargetsDocument {
  if (
    !isRecord(value)
    || value.formatVersion !== 1
    || !Array.isArray(value.targets)
    || value.targets.length === 0
  ) {
    throw new Error("release target document is invalid");
  }
  if (
    Object.keys(value).sort().join("\0")
    !== ["formatVersion", "targets"].sort().join("\0")
  ) {
    throw new Error("release target document fields are invalid");
  }
  const targets = value.targets.map(parseTarget);
  const ids = new Set<string>();
  const combinations = new Set<string>();
  const filenames = new Set<string>();
  for (const target of targets) {
    if (ids.has(target.id)) throw new Error("duplicate release target id");
    ids.add(target.id);
    const filename = releaseTargetFilename(target, "2026.7.0-beta.1");
    if (filenames.has(filename.toLowerCase())) {
      throw new Error("ambiguous release target filename");
    }
    filenames.add(filename.toLowerCase());
    const combination = `${target.platform}:${target.arch}:${target.format}`;
    if (combinations.has(combination)) {
      throw new Error("duplicate release target combination");
    }
    combinations.add(combination);
  }
  return Object.freeze({
    formatVersion: 1,
    targets: Object.freeze(targets),
  });
}

export function releaseTargetById(
  document: ReleaseTargetsDocument,
  id: string,
): ReleaseTarget {
  const matches = document.targets.filter((target) => target.id === id);
  if (matches.length !== 1) throw new Error(`unknown release target: ${id}`);
  return matches[0]!;
}
