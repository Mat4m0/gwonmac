// What the closed schema produces for the flight recorder. The guard that
// makes the schema closed is executed separately, in
// diagnostic-schema-rejects-free-text.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../../src/shared/errors.ts";
import {
  asDigest,
  diagnosticEventRecord,
  isDigest,
} from "../../src/main/diagnostics/schema.ts";

const FINGERPRINT = "a".repeat(64);

describe("diagnosticEventRecord", () => {
  it("owns the subsystem and level of an event, so a call site cannot disagree", () => {
    assert.deepEqual(diagnosticEventRecord({ k: "prefetch.failed", code: "chunk_offline" }), {
      subsystem: "cache",
      level: "warn",
      name: "prefetch.failed",
      fields: { code: "chunk_offline" },
    });
    assert.deepEqual(diagnosticEventRecord({ k: "app.uncaughtException", code: "unknown" }), {
      subsystem: "app",
      level: "error",
      name: "app.uncaughtException",
      fields: { code: "unknown" },
    });
  });

  it("keeps the discriminant out of the recorded fields", () => {
    const record = diagnosticEventRecord({ k: "quit.cleanupFailed", code: "short_write" });
    assert.equal(Object.hasOwn(record.fields, "k"), false);
    assert.deepEqual(Object.keys(record.fields), ["code"]);
  });

  it("carries every field of a multi-field event", () => {
    assert.deepEqual(
      diagnosticEventRecord({
        k: "snapshot.rangeFailed",
        offsetBytes: 4096,
        bytes: 65_536,
        code: "chunk_offline",
      }).fields,
      { offsetBytes: 4096, bytes: 65_536, code: "chunk_offline" },
    );
    assert.deepEqual(
      diagnosticEventRecord({
        k: "patch.updateFailed",
        code: "fetch_failed",
        fallbackCode: "bad_manifest",
      }).fields,
      { code: "fetch_failed", fallbackCode: "bad_manifest" },
    );
  });

  it("records a phase as a field rather than as part of the event name", () => {
    // A templated name (`browserCookies.clearFailed.${phase}`) is an open
    // string by another route, and the recorder would have to normalise it.
    const startup = diagnosticEventRecord({
      k: "browserCookies.clearFailed",
      phase: "startup",
      code: "unknown",
    });
    const quit = diagnosticEventRecord({
      k: "browserCookies.clearFailed",
      phase: "quit",
      code: "unknown",
    });
    assert.equal(startup.name, quit.name);
    assert.deepEqual(startup.fields, { phase: "startup", code: "unknown" });
    assert.deepEqual(quit.fields, { phase: "quit", code: "unknown" });
  });

  it("keeps the socket event name closed and the payload declared", () => {
    // `socket.${event.type}` was a templated name whose error branch carried
    // libuv's message; both parts are now fields of a fixed name.
    assert.deepEqual(diagnosticEventRecord({ k: "socket.open", socketId: 4 }), {
      subsystem: "socket",
      level: "info",
      name: "socket.open",
      fields: { socketId: 4 },
    });
    assert.deepEqual(
      diagnosticEventRecord({ k: "socket.close", socketId: 4, reason: "owner" }),
      {
        subsystem: "socket",
        level: "info",
        name: "socket.close",
        fields: { socketId: 4, reason: "owner" },
      },
    );
    assert.deepEqual(
      diagnosticEventRecord({ k: "socket.error", socketId: 4, code: "refused" }),
      {
        subsystem: "socket",
        level: "warn",
        name: "socket.error",
        fields: { socketId: 4, code: "refused" },
      },
    );
  });

  it("records which proxy route failed", () => {
    assert.deepEqual(
      diagnosticEventRecord({
        k: "proxy.requestFailed",
        route: "account",
        code: "fetch_failed",
      }).fields,
      { route: "account", code: "fetch_failed" },
    );
  });

  it("passes a digest and an absent digest through unchanged", () => {
    assert.deepEqual(
      diagnosticEventRecord({
        k: "client.candidatePromoted",
        fingerprint: asDigest(FINGERPRINT),
      }).fields,
      { fingerprint: FINGERPRINT },
    );
    assert.deepEqual(
      diagnosticEventRecord({ k: "client.integrityMetadataReady", fingerprint: null }).fields,
      { fingerprint: null },
    );
  });

  it("produces only scalars, so no nested value can smuggle text out", () => {
    const events = [
      diagnosticEventRecord({
        k: "proxy.requestFailed",
        route: "webgate",
        code: "allowlist",
      }),
      diagnosticEventRecord({ k: "settings.saveFailed", code: "bad_settings" }),
      diagnosticEventRecord({ k: "filesystem.resetFailed", code: "unknown" }),
      diagnosticEventRecord({
        k: "client.candidateRolledBack",
        fingerprint: asDigest(FINGERPRINT),
      }),
    ];
    for (const { fields } of events) {
      for (const value of Object.values(fields)) {
        assert.ok(
          value === null || ["string", "number", "boolean"].includes(typeof value),
          `unexpected ${typeof value}`,
        );
      }
    }
  });
});

describe("asDigest", () => {
  it("accepts a 64-character lower-case hex digest", () => {
    assert.equal(asDigest(FINGERPRINT), FINGERPRINT);
    assert.equal(asDigest("0123456789abcdef".repeat(4)), "0123456789abcdef".repeat(4));
  });

  it("rejects anything else, without quoting it", () => {
    for (const bad of [
      "",
      "abc",
      FINGERPRINT.toUpperCase(),
      `${FINGERPRINT}0`,
      FINGERPRINT.slice(1),
      "/Users/x/secret.txt",
      `${FINGERPRINT} /Users/x/secret.txt`,
    ]) {
      assert.throws(
        () => asDigest(bad),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, "bad_digest");
          // The rejected value must not survive in the message it produced.
          assert.equal(error.message.includes(bad) && bad !== "", false);
          return true;
        },
        bad,
      );
    }
  });

  it("has a predicate that agrees with it", () => {
    assert.equal(isDigest(FINGERPRINT), true);
    assert.equal(isDigest(FINGERPRINT.toUpperCase()), false);
    assert.equal(isDigest("/Users/x/secret.txt"), false);
    assert.equal(isDigest(null), false);
    assert.equal(isDigest(64), false);
  });
});
