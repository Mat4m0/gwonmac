import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectEventLog } from "../../src/main/diagnostics/detector.ts";
import {
  DIAGNOSTIC_EVENT_SCHEMA,
  diagnosticEventRecord,
} from "../../src/main/diagnostics/schema.ts";
import type { DiagnosticEvent } from "../../src/main/diagnostics/schema.ts";
import { asDigest } from "../../src/shared/digest.ts";

/**
 * Behaviour only: every case here runs the detector over a real JSONL document
 * and asserts on what it did. Nothing reads source text.
 */

let seq = 0;

/** The envelope the flight recorder writes, minus the fields under test. */
function line(
  overrides: Record<string, unknown>,
  fields?: Record<string, unknown>,
): string {
  seq += 1;
  const requestedName =
    typeof overrides.name === "string" ? overrides.name : "app.uncaughtException";
  const owner = Object.hasOwn(DIAGNOSTIC_EVENT_SCHEMA, requestedName)
    ? DIAGNOSTIC_EVENT_SCHEMA[
        requestedName as keyof typeof DIAGNOSTIC_EVENT_SCHEMA
      ]
    : DIAGNOSTIC_EVENT_SCHEMA["app.uncaughtException"];
  return JSON.stringify({
    seq,
    tsUs: 1_000 * seq,
    wallTime: new Date(seq * 1_000).toISOString(),
    level: owner.level,
    subsystem: owner.subsystem,
    name: "app.uncaughtException",
    fields: fields ?? { code: "unknown" },
    ...overrides,
  });
}

/** A record built the way the production path builds it. */
function recorded(event: DiagnosticEvent): string {
  const record = diagnosticEventRecord(event);
  return line(
    {
      level: record.level,
      subsystem: record.subsystem,
      name: record.name,
    },
    record.fields,
  );
}

function rejects(text: string, expected: RegExp): void {
  assert.throws(() => inspectEventLog(text), expected);
}

describe("export detector", () => {
  it("accepts every declared event built through the schema", () => {
    const events: DiagnosticEvent[] = [
      { k: "app.uncaughtException", code: "validation" },
      { k: "browserCookies.clearFailed", phase: "quit", code: "unknown" },
      { k: "patch.updateFailed", code: "fetch_failed", fallbackCode: "unknown" },
      { k: "client.candidatePromoted", fingerprint: null },
      { k: "client.integrityMetadataReady", fingerprint: asDigest("a".repeat(64)) },
      { k: "snapshot.rangeFailed", offsetBytes: 0, bytes: 16, code: "bad_range" },
      { k: "proxy.requestFailed", route: "account", code: "http_status" },
      { k: "socket.close", socketId: 7, reason: "peer" },
      { k: "socket.error", socketId: 7, code: "refused" },
    ];
    const result = inspectEventLog(events.map(recorded).join("\n"));
    assert.equal(result.records, events.length);
    assert.equal(result.schemaChecked, events.length);
  });

  it("rejects a declared event that carries a field the schema does not declare", () => {
    // The regression this exists for: a build whose `app.uncaughtException`
    // still pushed `error.message` into the log.
    rejects(
      line({ name: "app.uncaughtException" }, { code: "unknown", message: "boom" }),
      /carries undeclared field message/,
    );
    rejects(
      line({ name: "socket.error" }, { socketId: 1 }),
      /socket\.error is missing declared field code/,
    );
  });

  it("rejects a value outside the field's declared vocabulary", () => {
    rejects(
      line({ name: "socket.close" }, { socketId: 1, reason: "connection reset by peer" }),
      /socket\.close\.reason is not a declared value/,
    );
    rejects(
      line({ name: "proxy.requestFailed" }, { route: "evil.example.com", code: "allowlist" }),
      /proxy\.requestFailed\.route is not a declared value/,
    );
    rejects(
      line({ name: "app.uncaughtException" }, { code: "ENOTFOUND 10.0.0.4" }),
      /app\.uncaughtException\.code is not a declared value/,
    );
    rejects(
      line({ name: "client.candidatePromoted" }, { fingerprint: "not-a-digest" }),
      /client\.candidatePromoted\.fingerprint is not a declared value/,
    );
  });

  it("rejects text a redactor would have called clean", () => {
    // `redactText(text) !== text` is false for both of these — they are what
    // the redactor produces. A fixed-point check passes them; a schema check
    // rejects them, because neither field is declared on the event.
    rejects(
      line({ name: "app.uncaughtException" }, { code: "unknown", path: "[redacted-path]" }),
      /carries undeclared field path/,
    );
    rejects(
      line({ name: "settings.loadFailed" }, { code: "bad_settings", url: "token=[redacted]" }),
      /carries undeclared field url/,
    );
  });

  it("rejects a malformed envelope rather than trusting the record", () => {
    rejects(line({ level: 5 }), /envelope field level/);
    rejects(line({ subsystem: 5 }), /envelope field subsystem/);
    rejects(line({ name: "/Users/x/secret.txt" }), /undeclared event name/);
    rejects(line({ traceId: "trace-1" }), /record key traceId/);
    rejects(line({ hostname: "gw.example.com" }), /undeclared record key hostname/);
    rejects("not json at all", /line 1 is not JSON/);
    rejects(JSON.stringify([1, 2]), /line 1 is not an object/);
  });

  it("rejects a declared event under another subsystem or level", () => {
    rejects(
      line({ name: "socket.open", subsystem: "app" }, { socketId: 1 }),
      /socket\.open has the wrong subsystem/,
    );
    rejects(
      line({ name: "socket.open", level: "error" }, { socketId: 1 }),
      /socket\.open has the wrong level/,
    );
  });

  it("rejects every undeclared event and former free-text producer field", () => {
    rejects(
      line(
        { name: "security.navigationBlocked", level: "warn" },
        { url: "https://elsewhere" },
      ),
      /security\.navigationBlocked carries undeclared field url/,
    );
    rejects(
      line(
        { name: "childProcess.gone" },
        { type: "GPU", reason: "crashed", exitCode: 5 },
      ),
      /childProcess\.gone carries undeclared field type/,
    );
    rejects(
      line({ name: "diagnostics.unnamed" }, {}),
      /undeclared event name/,
    );
  });

  it("rejects a nested field on any record, declared or not", () => {
    rejects(
      line(
        { name: "electron.ready", level: "info" },
        { detail: { message: "boom" } },
      ),
      /electron\.ready carries undeclared field detail/,
    );
    rejects(
      line(
        { name: "electron.ready", level: "info" },
        { frames: [1, 2, 3] },
      ),
      /electron\.ready carries undeclared field frames/,
    );
  });

  it("skips the blank lines a JSONL document ends with", () => {
    const result = inspectEventLog(
      `${recorded({ k: "socket.open", socketId: 1, port: 6112 })}\n\n`,
    );
    assert.equal(result.records, 1);
  });
});
