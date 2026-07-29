import {
  formatReleaseVersion,
  parseReleaseVersion,
} from "./release.js";
import type {
  ReleaseArchitecture,
  ReleaseFormat,
  ReleasePlatform,
  ReleaseTarget,
} from "./release-targets.js";

const SIGNING_POSTURES = [
  "adhoc",
  "developer-id-notarized",
  "unsigned-preview",
  "authenticode",
  "linux-attested",
] as const;

export type ArtifactSigningPosture = (typeof SIGNING_POSTURES)[number];

export interface ArtifactManifestV1 {
  readonly formatVersion: 1;
  readonly sourceCommit: string;
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly targetId: string;
  readonly platform: ReleasePlatform;
  readonly arch: ReleaseArchitecture;
  readonly format: ReleaseFormat;
  readonly filename: string;
  readonly sha256: string;
  readonly signing: ArtifactSigningPosture;
  readonly ciRunUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
  pattern: RegExp,
): string {
  const value = record[field];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`artifact manifest ${field} is invalid`);
  }
  return value;
}

function ciRunUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("artifact manifest ciRunUrl is invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("artifact manifest ciRunUrl is invalid");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "github.com"
    || !/^\/[^/]+\/[^/]+\/actions\/runs\/[1-9][0-9]*$/u.test(parsed.pathname)
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new Error("artifact manifest ciRunUrl is invalid");
  }
  return parsed.href;
}

function signingPosture(value: unknown): ArtifactSigningPosture {
  if (
    typeof value !== "string"
    || !SIGNING_POSTURES.includes(value as ArtifactSigningPosture)
  ) {
    throw new Error("artifact manifest signing is invalid");
  }
  return value as ArtifactSigningPosture;
}

export function parseArtifactManifest(value: unknown): ArtifactManifestV1 {
  if (!isRecord(value) || value.formatVersion !== 1) {
    throw new Error("artifact manifest is invalid");
  }
  const expectedKeys = [
    "appVersion",
    "arch",
    "ciRunUrl",
    "electronVersion",
    "filename",
    "format",
    "formatVersion",
    "platform",
    "sha256",
    "signing",
    "sourceCommit",
    "targetId",
  ];
  if (
    Object.keys(value).sort().join("\0")
    !== expectedKeys.sort().join("\0")
  ) {
    throw new Error("artifact manifest fields are invalid");
  }

  const appVersion = requiredString(
    value,
    "appVersion",
    /^[1-9][0-9]{3}\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:alpha|beta|rc)\.[1-9][0-9]*)?$/u,
  );
  const parsedVersion = parseReleaseVersion(appVersion);
  if (!parsedVersion || formatReleaseVersion(parsedVersion) !== appVersion) {
    throw new Error("artifact manifest appVersion is invalid");
  }
  const platform = requiredString(
    value,
    "platform",
    /^(?:darwin|win32|linux)$/u,
  ) as ReleasePlatform;
  const arch = requiredString(
    value,
    "arch",
    /^(?:arm64|x64)$/u,
  ) as ReleaseArchitecture;
  const format = requiredString(
    value,
    "format",
    /^(?:zip|squirrel|deb)$/u,
  ) as ReleaseFormat;
  const signing = signingPosture(value.signing);

  return Object.freeze({
    formatVersion: 1,
    sourceCommit: requiredString(value, "sourceCommit", /^[0-9a-f]{40}$/u),
    appVersion,
    electronVersion: requiredString(
      value,
      "electronVersion",
      /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u,
    ),
    targetId: requiredString(value, "targetId", /^[a-z][a-z0-9-]{2,31}$/u),
    platform,
    arch,
    format,
    filename: requiredString(value, "filename", /^[^/\\\r\n]+$/u),
    sha256: requiredString(value, "sha256", /^[0-9a-f]{64}$/u),
    signing,
    ciRunUrl: ciRunUrl(value.ciRunUrl),
  });
}

export function signingPostureForPreview(
  target: ReleaseTarget,
): ArtifactSigningPosture {
  return target.platform === "darwin" ? "adhoc" : "unsigned-preview";
}
