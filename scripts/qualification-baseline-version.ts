import { parseReleaseVersion } from "../src/shared/release.js";

/** Select the immediate older Stable build used by installed update proofs. */
export function qualificationBaselineVersion(version: string): string {
  const parsed = parseReleaseVersion(version);
  if (!parsed || parsed.channel !== "stable" || parsed.patch === 0) {
    throw new Error(
      "installed update qualification requires a stable version with patch > 0",
    );
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch - 1}`;
}
