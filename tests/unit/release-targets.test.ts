import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import releaseTargetsJson from "../../release-targets.json" with { type: "json" };
import { platformPackageVersions } from "../../scripts/platform-version.js";
import { releaseTargetMatrix } from "../../scripts/release-matrix.js";
import {
  parseReleaseTargets,
  releaseTargetById,
  releaseTargetFilename,
} from "../../src/shared/release-targets.js";

const canonical = parseReleaseTargets(releaseTargetsJson);

describe("canonical release targets", () => {
  it("owns the exact native target and artifact set", () => {
    assert.deepEqual(
      canonical.targets.map((target) => ({
        id: target.id,
        platform: target.platform,
        arch: target.arch,
        format: target.format,
        availability: target.availability,
      })),
      [
        {
          id: "macos-arm64",
          platform: "darwin",
          arch: "arm64",
          format: "zip",
          availability: "public-preview",
        },
        {
          id: "windows-x64",
          platform: "win32",
          arch: "x64",
          format: "squirrel",
          availability: "ci-preview",
        },
        {
          id: "linux-x64",
          platform: "linux",
          arch: "x64",
          format: "deb",
          availability: "ci-preview",
        },
      ],
    );
    assert.deepEqual(releaseTargetMatrix(canonical), {
      include: [
        {
          targetId: "macos-arm64",
          platform: "darwin",
          arch: "arm64",
          runner: "macos-15",
        },
        {
          targetId: "windows-x64",
          platform: "win32",
          arch: "x64",
          runner: "windows-2022",
        },
        {
          targetId: "linux-x64",
          platform: "linux",
          arch: "x64",
          runner: "ubuntu-24.04",
        },
      ],
    });
  });

  it("renders exact, unambiguous release asset names", () => {
    const version = "2026.7.0-beta.1";
    assert.equal(
      releaseTargetFilename(releaseTargetById(canonical, "macos-arm64"), version),
      "Guild Wars-darwin-arm64-2026.7.0-beta.1.zip",
    );
    assert.equal(
      releaseTargetFilename(releaseTargetById(canonical, "windows-x64"), version),
      "Guild-Wars-2026.7.0-beta.1-Windows-x64-Setup.exe",
    );
    assert.equal(
      releaseTargetFilename(releaseTargetById(canonical, "linux-x64"), version),
      "Guild-Wars-2026.7.0-beta.1-Linux-x64.deb",
    );
  });

  it("rejects duplicate, ambiguous, unknown, and unsupported targets", () => {
    const base = structuredClone(releaseTargetsJson);
    assert.throws(
      () => parseReleaseTargets({
        ...base,
        targets: [...base.targets, base.targets[0]],
      }),
      /duplicate release target id/,
    );
    assert.throws(
      () => parseReleaseTargets({
        ...base,
        targets: base.targets.map((target, index) =>
          index === 1
            ? {
                ...target,
                id: "other",
                platform: "darwin",
                arch: "arm64",
                format: "zip",
                filenameTemplate: "Other-{version}.zip",
              }
            : target),
      }),
      /duplicate release target combination/,
    );
    assert.throws(
      () => parseReleaseTargets({
        ...base,
        targets: [
          base.targets[0],
          {
            ...base.targets[0],
            id: "other-macos",
          },
        ],
      }),
      /ambiguous release target filename/,
    );
    assert.throws(
      () => parseReleaseTargets({
        ...base,
        targets: [{
          ...base.targets[0],
          platform: "freebsd",
        }],
      }),
      /platform is invalid/,
    );
    assert.throws(
      () => parseReleaseTargets({
        ...base,
        targets: [{
          ...base.targets[0],
          platform: "darwin",
          arch: "x64",
        }],
      }),
      /combination is unsupported/,
    );
    assert.throws(
      () => releaseTargetFilename(canonical.targets[0]!, "v2026.7.0"),
      /not canonical/,
    );
  });

  it("derives every platform version from package.json's one value", () => {
    const { version } = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    assert.deepEqual(platformPackageVersions(version), {
      canonical: "2026.7.0-beta.1",
      macOS: {
        appVersion: "2026.7.0",
        buildVersion: "2607.0.31",
      },
      squirrel: "2026.7.0-beta.1",
      debian: "2026.7.0~beta.1",
    });
  });
});
