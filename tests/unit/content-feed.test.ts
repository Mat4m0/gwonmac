import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ContentFeedController } from "../../src/main/content-feed.js";
import {
  parseContentPayload,
  parseSignedContentEnvelope,
  type ContentPayloadV1,
  type SignedContentEnvelopeV1,
} from "../../src/shared/content-feed.js";

const NOW = Date.parse("2026-08-23T12:00:00Z");

function payload(sequence = 1): ContentPayloadV1 {
  return {
    schemaVersion: 1,
    sequence,
    publishedAt: "2026-08-23T11:59:00Z",
    notices: [{
      id: "arenanet-client-update",
      revision: 1,
      state: "active",
      kind: "arenanet-update",
      severity: "degraded",
      title: "Guild Wars was updated",
      summary: "We’re checking that everything still behaves as expected. You can keep playing.",
      details: ["If something feels wrong, please tell us on Discord."],
      startsAt: "2026-08-23T11:00:00Z",
      expiresAt: "2026-08-24T11:00:00Z",
      action: "discord-support",
    }],
    releases: [],
  };
}

function signer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const envelope = (value: ContentPayloadV1): SignedContentEnvelopeV1 => {
    const bytes = Buffer.from(JSON.stringify(value));
    return {
      schemaVersion: 1,
      keyId: "content-test-01",
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, privateKey).toString("base64url"),
    };
  };
  return { envelope, publicKeyBase64 };
}

describe("content feed contract", () => {
  it("accepts the closed presentation-only schema", () => {
    assert.deepEqual(parseContentPayload(payload()), payload());
    assert.throws(
      () => parseContentPayload({ ...payload(), updateUrl: "https://example.test/app.zip" }),
      /unknown field/u,
    );
    const { envelope } = signer();
    assert.deepEqual(parseSignedContentEnvelope(envelope(payload())).schemaVersion, 1);
  });

  it("rejects unknown content fields and duplicate notice ids", () => {
    const duplicate = payload();
    assert.throws(() => parseContentPayload({
      ...duplicate,
      notices: [...duplicate.notices, duplicate.notices[0]],
    }), /duplicate notice/u);
    assert.throws(() => parseContentPayload({
      ...duplicate,
      notices: [{ ...duplicate.notices[0], html: "<b>remote</b>" }],
    }), /unknown field/u);
  });
});

describe("content feed controller", () => {
  it("verifies, publishes, caches, and marks current content read", async () => {
    const root = await mkdtemp(join(tmpdir(), "gwonmac-content-"));
    const { envelope, publicKeyBase64 } = signer();
    let requests = 0;
    const controller = new ContentFeedController({
      statePath: join(root, "content-state.json"),
      endpoint: "https://example.test/content/v1/feed.json",
      publicKeys: { "content-test-01": publicKeyBase64 },
      enabled: true,
      now: () => NOW,
      fetch: async () => {
        requests += 1;
        return new Response(JSON.stringify(envelope(payload())), {
          status: 200,
          headers: { ETag: '"one"' },
        });
      },
    });
    await controller.start();
    await controller.refresh();
    assert.equal(requests, 1);
    assert.equal(controller.getState().phase, "current");
    assert.equal(controller.getState().notices.length, 1);
    assert.equal(controller.getState().unreadCount, 1);
    await controller.markRead({ id: "arenanet-client-update", revision: 1 });
    assert.equal(controller.getState().unreadCount, 0);
    controller.stop();
  });

  it("makes zero requests while opted out", async () => {
    const root = await mkdtemp(join(tmpdir(), "gwonmac-content-off-"));
    let requests = 0;
    const controller = new ContentFeedController({
      statePath: join(root, "content-state.json"),
      endpoint: "https://example.test/content/v1/feed.json",
      publicKeys: {},
      enabled: false,
      fetch: async () => {
        requests += 1;
        return new Response();
      },
    });
    await controller.start();
    assert.equal(controller.getState().phase, "disabled");
    assert.equal(requests, 0);
    controller.stop();
  });

  it("keeps accepted content when a later response is tampered with", async () => {
    const root = await mkdtemp(join(tmpdir(), "gwonmac-content-bad-"));
    const { envelope, publicKeyBase64 } = signer();
    let valid = true;
    const accepted = envelope(payload());
    const controller = new ContentFeedController({
      statePath: join(root, "content-state.json"),
      endpoint: "https://example.test/content/v1/feed.json",
      publicKeys: { "content-test-01": publicKeyBase64 },
      enabled: true,
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify(valid
        ? accepted
        : { ...accepted, signature: Buffer.alloc(64, 9).toString("base64url") })),
    });
    await controller.start();
    await controller.refresh();
    valid = false;
    await controller.refresh();
    assert.equal(controller.getState().phase, "stale");
    assert.equal(controller.getState().notices[0]?.id, "arenanet-client-update");
    controller.stop();
  });
});
