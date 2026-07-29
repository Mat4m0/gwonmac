import { macOSBundleVersions } from "./macos-version.js";
import {
  formatReleaseVersion,
  parseReleaseVersion,
} from "../src/shared/release.js";

export interface PlatformPackageVersions {
  readonly canonical: string;
  readonly macOS: {
    readonly appVersion: string;
    readonly buildVersion: string;
  };
  readonly squirrel: string;
  readonly debian: string;
}

export function platformPackageVersions(
  version: string,
): PlatformPackageVersions {
  const parsed = parseReleaseVersion(version);
  if (!parsed || formatReleaseVersion(parsed) !== version) {
    throw new Error("package version is not a canonical release version");
  }
  const canonical = formatReleaseVersion(parsed);
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return {
    canonical,
    macOS: macOSBundleVersions(canonical),
    squirrel: canonical,
    debian: parsed.channel === "stable"
      ? core
      : `${core}~${parsed.channel}.${parsed.sequence}`,
  };
}
