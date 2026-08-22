import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertFeedsDoNotMoveBackward,
  buildUpdateFeeds,
  selectUpdateCandidates,
} from "../../scripts/update-feeds.ts";
import { releaseAssetUrl } from "../../src/shared/project-identity.ts";

function manifest(version: string) {
  const tag = `v${version}`;
  return {
    url: releaseAssetUrl(
      tag,
      `Guild-Wars-Reforged-${version}-macOS-arm64.zip`,
    ),
    name: `Guild Wars Reforged v${version}`,
    version,
    tag,
    pub_date: "2026-08-22T00:00:00.000Z",
    notes: "",
  };
}

function release(version: string, options: {
  draft?: boolean;
  prerelease?: boolean;
  assets?: unknown[];
} = {}) {
  const tag = `v${version}`;
  const zipName = `Guild-Wars-Reforged-${version}-macOS-arm64.zip`;
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? version.includes("-"),
    assets: options.assets ?? [
      {
        name: "RELEASES.json",
        browser_download_url: releaseAssetUrl(tag, "RELEASES.json"),
      },
      {
        name: zipName,
        browser_download_url: releaseAssetUrl(tag, zipName),
      },
    ],
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("static update feed publication", () => {
  it("selects the highest eligible release independently for each channel", () => {
    const selected = selectUpdateCandidates([
      release("2026.8.0-beta.1"),
      release("2026.7.1"),
      release("2026.9.0-alpha.1"),
      { tag_name: "snapshot-123", draft: false, prerelease: true, assets: [] },
      release("2027.1.0", { draft: true }),
      release("2026.8.0-rc.1"),
    ]);

    assert.equal(selected.stable.tag, "v2026.7.1");
    assert.equal(selected.beta.tag, "v2026.8.0-rc.1");
  });

  it("lets a newer Stable lead both channels and downloads its manifest once", async () => {
    let requests = 0;
    const feeds = await buildUpdateFeeds([
      release("2026.8.0-beta.2"),
      release("2026.8.0"),
    ], async (input) => {
      requests += 1;
      assert.equal(
        String(input),
        releaseAssetUrl("v2026.8.0", "RELEASES.json"),
      );
      return response(manifest("2026.8.0"));
    });

    assert.equal(requests, 1);
    assert.equal(feeds.stable.version, "2026.8.0");
    assert.equal(feeds.beta.version, "2026.8.0");
  });

  it("publishes distinct Stable and Beta manifests when Beta is ahead", async () => {
    const feeds = await buildUpdateFeeds([
      release("2026.7.0"),
      release("2026.8.0-beta.1"),
    ], async (input) => {
      const url = String(input);
      const version = url.includes("beta.1") ? "2026.8.0-beta.1" : "2026.7.0";
      return response(manifest(version));
    });

    assert.equal(feeds.stable.version, "2026.7.0");
    assert.equal(feeds.beta.version, "2026.8.0-beta.1");
  });

  it("refuses duplicate versions, inconsistent metadata, and missing assets", async () => {
    assert.throws(
      () => selectUpdateCandidates([release("2026.7.0"), release("2026.7.0")]),
      /duplicate published release version/,
    );
    assert.throws(
      () => selectUpdateCandidates([
        release("2026.7.0"),
        release("2026.8.0-beta.1", { prerelease: false }),
      ]),
      /inconsistent publication metadata/,
    );
    await assert.rejects(
      buildUpdateFeeds(
        [release("2026.7.0", { assets: [] })],
        async () => response(manifest("2026.7.0")),
      ),
      /lacks its exact updater assets/,
    );
  });

  it("refuses unreadable, missing-channel, unavailable, and inconsistent input", async () => {
    assert.throws(() => selectUpdateCandidates({}), /unreadable/);
    assert.throws(
      () => selectUpdateCandidates([release("2026.8.0-beta.1")]),
      /both Stable and Beta/,
    );
    await assert.rejects(
      buildUpdateFeeds([release("2026.7.0")], async () => response({}, 404)),
      /HTTP 404/,
    );
    await assert.rejects(
      buildUpdateFeeds([release("2026.7.0")], async () =>
        response(manifest("2026.8.0"))),
      /inconsistent/,
    );
  });

  it("allows an unchanged or advancing pair and refuses either rollback", () => {
    const current = {
      stable: manifest("2026.7.0"),
      beta: manifest("2026.8.0-beta.1"),
    };
    assert.doesNotThrow(() => assertFeedsDoNotMoveBackward(current, current));
    assert.doesNotThrow(() => assertFeedsDoNotMoveBackward({
      stable: manifest("2026.8.0"),
      beta: manifest("2026.8.0"),
    }, current));
    assert.throws(() => assertFeedsDoNotMoveBackward({
      stable: manifest("2026.6.0"),
      beta: current.beta,
    }, current), /stable update channel would move backward/);
    assert.throws(() => assertFeedsDoNotMoveBackward({
      stable: current.stable,
      beta: manifest("2026.7.0-beta.1"),
    }, current), /beta update channel would move backward/);
  });
});
