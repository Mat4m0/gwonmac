import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { releaseManifest } from "../../scripts/release-manifest.ts";
import { parseReleaseManifest } from "../../src/shared/release-manifest.ts";
import {
  releaseAssetUrl,
  releaseDownloadRoot,
  releaseUpdateArtifactName,
} from "../../src/shared/project-identity.ts";

describe("native update release manifest", () => {
  it("contains exactly one immutable release asset", () => {
    const manifest = JSON.parse(releaseManifest({
      version: "2026.7.0-beta.2",
      tag: "v2026.7.0-beta.2",
      zipName: "Guild-Wars-Reforged-2026.7.0-beta.2-macOS-arm64.zip",
      publishedAt: "2026-07-30T12:00:00Z",
    }));
    assert.equal(manifest.version, "2026.7.0-beta.2");
    assert.equal(manifest.tag, "v2026.7.0-beta.2");
    assert.equal(
      manifest.url,
      "https://github.com/Mat4m0/gwonmac/releases/download/v2026.7.0-beta.2/Guild-Wars-Reforged-2026.7.0-beta.2-macOS-arm64.zip",
    );
  });

  it("refuses mismatched tags and non-file ZIP names", () => {
    const base = {
      version: "2026.7.0",
      tag: "v2026.7.0",
      zipName: "Guild-Wars-Reforged-2026.7.0-macOS-arm64.zip",
      publishedAt: "2026-07-30T12:00:00Z",
    };
    assert.throws(() => releaseManifest({ ...base, tag: "v2026.8.0" }));
    assert.throws(() => releaseManifest({ ...base, zipName: "../bad.zip" }));
  });

  it("uses one closed reader for generated and downloaded manifests", () => {
    const generated: unknown = JSON.parse(releaseManifest({
      version: "2026.7.0",
      tag: "v2026.7.0",
      zipName: "Guild-Wars-Reforged-2026.7.0-macOS-arm64.zip",
      publishedAt: "2026-07-30T12:00:00Z",
    }));
    assert.equal(
      parseReleaseManifest(generated, "darwin-arm64")?.manifest.version,
      "2026.7.0",
    );
    assert.equal(
      parseReleaseManifest({
        ...(generated as Record<string, unknown>),
        url: "https://attacker.invalid/app.zip",
      }, "darwin-arm64"),
      null,
    );
    assert.equal(
      parseReleaseManifest({
        ...(generated as Record<string, unknown>),
        extra: true,
      }, "darwin-arm64"),
      null,
    );
  });

  it("binds Windows discovery to its Setup asset and Squirrel directory", () => {
    const version = "2026.8.0";
    const tag = `v${version}`;
    const manifest = {
      url: releaseAssetUrl(
        tag,
        releaseUpdateArtifactName(version, "win32-x64"),
      ),
      name: `Guild Wars Reforged v${version}`,
      version,
      tag,
      pub_date: "2026-08-30T12:00:00.000Z",
      notes: "",
    };
    assert.equal(
      parseReleaseManifest(manifest, "win32-x64")?.immutableFeedUrl,
      releaseDownloadRoot(tag),
    );
    assert.equal(parseReleaseManifest(manifest, "darwin-arm64"), null);
  });
});
