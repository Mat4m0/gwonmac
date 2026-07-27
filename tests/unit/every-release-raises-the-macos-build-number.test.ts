// macOS decides whether an installed copy is older than the one being installed
// by comparing CFBundleVersion component by component. If two releases ever map
// to the same build number — or to a lower one — the app that ships second is
// the one that looks stale, and no part of the UI can correct it.
//
// So this executes scripts/macos-version.ts across a ladder of every release
// this project can cut, in publication order, and demands the build number rise
// at every rung. It also holds the two boundaries the mapping depends on: the
// version this repository is about to release must map at all, and it must be a
// version the app's own parser can compare.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { macOSBundleVersions } from "../../scripts/macos-version.js";
import {
  compareReleaseVersions,
  formatReleaseVersion,
  parseReleaseVersion,
} from "../../src/shared/release.ts";

/** How macOS reads a CFBundleVersion: three numbers, most significant first. */
function compareBundleVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  assert.equal(left.length, 3, `${a} is not three components`);
  assert.equal(right.length, 3, `${b} is not three components`);
  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    if (value !== other) return value - other;
  }
  return 0;
}

// Publication order, oldest first: the prerelease channels of one release, then
// a patch inside the month, then the next month, then the next year.
const LADDER = [
  "2026.7.0-alpha.1",
  "2026.7.0-alpha.2",
  "2026.7.0-beta.1",
  "2026.7.0-rc.1",
  "2026.7.0",
  "2026.7.1-alpha.1",
  "2026.7.1",
  "2026.8.0",
  "2027.1.0",
  "2099.12.99",
];

describe("the macOS build number derived from a release version", () => {
  it("rises at every rung of a release ladder", () => {
    let previous = "1.1.1"; // what the public 0.0.1-alpha.1 build carries.
    for (const version of LADDER) {
      const { buildVersion } = macOSBundleVersions(version);
      assert.ok(
        compareBundleVersions(buildVersion, previous) > 0,
        `${version} -> ${buildVersion} does not exceed ${previous}`,
      );
      previous = buildVersion;
    }
  });

  it("orders releases the same way the app's own comparison does", () => {
    for (const [index, version] of LADDER.entries()) {
      const next = LADDER[index + 1];
      if (next === undefined) break;
      const current = parseReleaseVersion(version);
      const candidate = parseReleaseVersion(next);
      assert.ok(current && candidate, `${version} or ${next} did not parse`);
      assert.ok(
        compareReleaseVersions(candidate, current) > 0,
        `${next} does not follow ${version}`,
      );
    }
  });

  it("maps the calendar and the channel onto Apple's 4/2/2 digits", () => {
    assert.deepEqual(macOSBundleVersions("2026.7.0-alpha.1"), {
      appVersion: "2026.7.0",
      buildVersion: "2607.0.1",
    });
    assert.deepEqual(macOSBundleVersions("2026.7.0-beta.1"), {
      appVersion: "2026.7.0",
      buildVersion: "2607.0.31",
    });
    assert.deepEqual(macOSBundleVersions("2026.7.0-rc.1"), {
      appVersion: "2026.7.0",
      buildVersion: "2607.0.61",
    });
    assert.deepEqual(macOSBundleVersions("2026.7.0"), {
      appVersion: "2026.7.0",
      buildVersion: "2607.0.99",
    });
    assert.deepEqual(macOSBundleVersions("2026.7.1"), {
      appVersion: "2026.7.1",
      buildVersion: "2607.1.99",
    });
    assert.deepEqual(macOSBundleVersions("2026.12.0"), {
      appVersion: "2026.12.0",
      buildVersion: "2612.0.99",
    });
    // Every component stays inside Apple's limits at the far end of the scheme.
    assert.deepEqual(macOSBundleVersions("2099.12.99-rc.29"), {
      appVersion: "2099.12.99",
      buildVersion: "9912.99.89",
    });
  });

  it("refuses anything that is not a calendar release in SemVer syntax", () => {
    for (const version of [
      "2026.07.01", // leading zeroes: not a SemVer version at all
      "2026.7.01",
      "1.2.3", // the old scheme; (year - 2000) would go negative
      "1999.7.0",
      "2100.1.0", // past four digits of release line
      "2026.13.0", // not a month
      "2026.0.0",
      "2026.7.100", // past two digits of patch
      "2026.7.0-alpha.30", // past two digits once the stage is added
      "2026.7.0-alpha", // the workflow always publishes a sequence
      "2026.7.0-dev.1",
      "2026.7.0+20260726",
      "v2026.7.0", // package.json carries the version, not the tag
      "2026.7",
      " 2026.7.0",
      "",
    ]) {
      assert.throws(
        () => macOSBundleVersions(version),
        `${JSON.stringify(version)} was accepted as a release version`,
      );
    }
  });

  it("accepts the version this repository would release right now", () => {
    const { version } = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const { appVersion, buildVersion } = macOSBundleVersions(version);
    assert.ok(
      compareBundleVersions(buildVersion, "1.1.1") > 0,
      `${version} -> ${buildVersion} does not exceed the published alpha`,
    );
    // The same string has to reach the release check, which compares versions
    // with src/shared/release.ts and reports "unknown" for anything it cannot
    // read. A shipped version that fails here makes every install unable to
    // tell whether it is current.
    const parsedVersion = parseReleaseVersion(version);
    assert.ok(parsedVersion, `${version} is not a version the app can compare`);
    assert.equal(formatReleaseVersion(parsedVersion), version);
    assert.equal(
      appVersion,
      `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`,
    );
  });
});
