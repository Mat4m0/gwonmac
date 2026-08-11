import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_UPDATE_TRACK,
  UPDATE_TRACKS,
  compareReleaseVersions,
  formatReleaseVersion,
  isPrerelease,
  isReleaseEligibleForTrack,
  parseReleaseVersion,
  releaseMetadataMatchesStage,
  type ReleaseVersion,
} from "../../src/shared/release.ts";

function parsed(value: string): ReleaseVersion {
  const version = parseReleaseVersion(value);
  assert.ok(version, `expected ${value} to parse`);
  return version;
}

describe("release version parsing", () => {
  it("accepts every shape the release workflow publishes, tagged or not", () => {
    assert.deepEqual(parseReleaseVersion("2026.7.0"), {
      major: 2026,
      minor: 7,
      patch: 0,
      channel: "stable",
      sequence: 0,
    });
    assert.deepEqual(parseReleaseVersion("v0.0.1-alpha.1"), {
      major: 0,
      minor: 0,
      patch: 1,
      channel: "alpha",
      sequence: 1,
    });
    assert.deepEqual(
      parseReleaseVersion("2026.8.0-beta.12"),
      parseReleaseVersion("v2026.8.0-beta.12"),
    );
    assert.equal(parsed("1.2.3-rc.0").channel, "rc");
  });

  it("rejects 2026.07.01 and every other non-SemVer numeric identifier", () => {
    // Leading zeroes are invalid SemVer. Accepting them means npm refuses the
    // package.json later, and comparison silently reads 07 as 7 meanwhile.
    assert.equal(parseReleaseVersion("2026.07.01"), null);
    assert.equal(parseReleaseVersion("2026.7.01"), null);
    assert.equal(parseReleaseVersion("01.2.3"), null);
    assert.equal(parseReleaseVersion("1.2.3-alpha.01"), null);
  });

  it("rejects anything that is not exactly a published release shape", () => {
    for (const value of [
      "",
      "v",
      "1.2",
      "1.2.3.4",
      "1.2.3-alpha",
      "1.2.3-alpha.x",
      "1.2.3-dev.1",
      "1.2.3-alpha.1.2",
      "1.2.3+build.5",
      "V1.2.3",
      " 1.2.3",
      "1.2.3 ",
      "1.2.3\n",
      "-1.2.3",
      "latest",
      "vv1.2.3",
    ]) {
      assert.equal(
        parseReleaseVersion(value),
        null,
        `expected ${JSON.stringify(value)} to be rejected`,
      );
    }
  });

  it("rejects digit runs too long to compare exactly", () => {
    // Number("99999999999999999999") is finite but inexact, so two distinct
    // versions would compare equal rather than fail to parse.
    assert.equal(parseReleaseVersion("99999999999999999999.0.0"), null);
    assert.equal(parseReleaseVersion("1.2.3-rc.99999999999999999999"), null);
    assert.ok(parseReleaseVersion("9007199254740991.0.0"));
  });

  it("round-trips through canonical text without the tag prefix", () => {
    for (const value of ["0.0.0", "2026.7.1", "1.2.3-alpha.1", "9.9.9-rc.30"]) {
      assert.equal(formatReleaseVersion(parsed(value)), value);
      assert.equal(formatReleaseVersion(parsed(`v${value}`)), value);
      assert.deepEqual(parsed(formatReleaseVersion(parsed(value))), parsed(value));
    }
  });
});

describe("release version ordering", () => {
  it("orders numerically first, then prerelease before its own release", () => {
    const ascending = [
      "0.0.1-alpha.1",
      "0.0.1-alpha.2",
      "0.0.1-beta.1",
      "0.0.1-rc.1",
      "0.0.1",
      "0.0.2",
      "0.1.0",
      "1.0.0",
      "2026.7.0-alpha.1",
      "2026.7.0",
      "2026.7.1",
      "2026.8.0",
      "2027.1.0",
    ];
    const shuffled = [...ascending].reverse();
    const sorted = shuffled
      .map(parsed)
      .sort(compareReleaseVersions)
      .map(formatReleaseVersion);

    assert.deepEqual(sorted, ascending);
  });

  it("does not read a prerelease as equal to the release it leads to", () => {
    // The superseded parser split on "." and parseInt'ed, so "3-alpha" became
    // 3 and 1.2.3-alpha.1 tied with 1.2.3.
    assert.ok(compareReleaseVersions(parsed("1.2.3-alpha.1"), parsed("1.2.3")) < 0);
    assert.ok(compareReleaseVersions(parsed("1.2.3"), parsed("1.2.3-rc.9")) > 0);
    assert.equal(
      compareReleaseVersions(parsed("v1.2.3-rc.9"), parsed("1.2.3-rc.9")),
      0,
    );
  });

  it("reports which versions are prereleases", () => {
    assert.equal(isPrerelease(parsed("2026.7.0")), false);
    assert.equal(isPrerelease(parsed("2026.7.0-alpha.1")), true);
    assert.equal(isPrerelease(parsed("2026.7.0-beta.1")), true);
    assert.equal(isPrerelease(parsed("2026.7.0-rc.1")), true);
  });
});

describe("public release tracks", () => {
  it("keeps Stable as the default and never makes alpha public", () => {
    assert.deepEqual(UPDATE_TRACKS, ["stable", "beta"]);
    assert.equal(DEFAULT_UPDATE_TRACK, "stable");
    const eligibility = (version: string, track: "stable" | "beta") =>
      isReleaseEligibleForTrack(parsed(version), track);
    assert.equal(eligibility("1.0.0-alpha.1", "beta"), false);
    assert.equal(eligibility("1.0.0-beta.1", "stable"), false);
    assert.equal(eligibility("1.0.0-rc.1", "stable"), false);
    assert.equal(eligibility("1.0.0", "stable"), true);
    assert.equal(eligibility("1.0.0-beta.1", "beta"), true);
    assert.equal(eligibility("1.0.0-rc.1", "beta"), true);
    assert.equal(eligibility("1.0.0", "beta"), true);
  });

  it("requires GitHub prerelease metadata to match the tag", () => {
    assert.equal(releaseMetadataMatchesStage(parsed("1.0.0"), false), true);
    assert.equal(releaseMetadataMatchesStage(parsed("1.0.0"), true), false);
    assert.equal(releaseMetadataMatchesStage(parsed("1.0.0-beta.1"), true), true);
    assert.equal(releaseMetadataMatchesStage(parsed("1.0.0-beta.1"), false), false);
  });
});
