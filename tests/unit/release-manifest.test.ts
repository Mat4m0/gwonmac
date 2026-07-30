import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { releaseManifest } from "../../scripts/release-manifest.ts";

describe("Squirrel.Mac release manifest", () => {
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
});
