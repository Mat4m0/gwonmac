import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRelogTranscript } from "../../src/main/diagnostics/relog-transcript.ts";
import type { LogRecord } from "../../src/main/diagnostics/flight-recorder.ts";

function event(
  seq: number,
  ownerId: number | undefined,
  name: string,
  fields: LogRecord["fields"] = {},
): LogRecord {
  return {
    seq,
    tsUs: seq * 1_250,
    wallTime: "2026-08-25T00:00:00.000Z",
    level: "info",
    subsystem: name.startsWith("commandQ") || name.startsWith("quitReload")
      || name.startsWith("gameReload")
      ? "app" : "renderer",
    name,
    ...(ownerId === undefined ? {} : { ownerId }),
    fields,
  };
}

describe("reload transcript", () => {
  it("joins main and replacement-renderer events for exactly one owner", () => {
    const text = formatRelogTranscript({
      ownerId: 4,
      completeFromStart: true,
      records: [
        event(0, 4, "relog.finished", { outcome: "outpost" }),
        event(1, 4, "commandQ.shortcut", { phase: "claimed", reason: "none" }),
        event(2, 9, "quitReloadDialog.lifecycle", {
          phase: "settled", action: "reload", autoRelog: true,
        }),
        event(3, 4, "quitReloadDialog.lifecycle", {
          phase: "settled", action: "reload", autoRelog: true,
        }),
        event(4, undefined, "app.ready"),
        event(5, 4, "gameReload.requested", { cause: "command-q" }),
        event(6, 4, "gameReload.loaded", { cause: "command-q" }),
        event(7, 4, "relog.intentClaimed", { clockSynchronized: true }),
        event(8, 4, "relog.inputSettled", {
          stage: "login", outcome: "sent", clockSynchronized: true,
        }),
        event(10, 4, "relog.finished", {
          outcome: "restored", clockSynchronized: true,
        }),
      ],
    });
    assert.match(text, /status: complete/);
    assert.match(text, /outside-current=1; omitted=0/);
    assert.match(text, /commandQ\.shortcut claimed none/);
    assert.match(text, /gameReload\.loaded cause=command-q/);
    assert.doesNotMatch(text, /app\.ready/);
    assert.equal((text.match(/quitReloadDialog/g) ?? []).length, 1);
  });

  it("reports an incomplete or missing boundary truthfully", () => {
    const incomplete = formatRelogTranscript({
      ownerId: 1,
      completeFromStart: false,
      records: [
        event(1, 1, "gameReload.requested", { cause: "menu" }),
        event(2, 1, "relog.tokenRequested", { clockSynchronized: false }),
      ],
    });
    assert.match(incomplete, /status: incomplete; recorder-start=truncated/);
    const absent = formatRelogTranscript({
      ownerId: 1,
      completeFromStart: true,
      records: [event(1, 1, "renderer.loaded")],
    });
    assert.match(absent, /no reload boundary/);
  });

  it("starts a menu trace at its own reload after an older Command-Q run", () => {
    const text = formatRelogTranscript({
      ownerId: 1,
      completeFromStart: true,
      records: [
        event(1, 1, "commandQ.shortcut", { phase: "claimed", reason: "none" }),
        event(2, 1, "gameReload.requested", { cause: "command-q" }),
        event(3, 1, "relog.finished", { outcome: "restored" }),
        event(4, 1, "gameReload.requested", { cause: "menu" }),
        event(5, 1, "relog.finished", { outcome: "outpost" }),
      ],
    });
    assert.doesNotMatch(text, /commandQ\.shortcut/);
    assert.doesNotMatch(text, /outcome=restored/);
    assert.match(text, /gameReload\.requested cause=menu/);
    assert.match(text, /relog\.finished outcome=outpost/);
  });

  it("stays below the clipboard ceiling by retaining newest complete rows", () => {
    const records = [event(1, 2, "gameReload.requested", { cause: "menu" })];
    for (let seq = 2; seq < 300; seq += 1) {
      records.push(event(seq, 2, "relog.preGameProbe", {
        state: "unknown", mask: seq, clockSynchronized: true,
      }));
    }
    records.push(event(300, 2, "relog.finished", {
      outcome: "restored", clockSynchronized: true,
    }));
    const text = formatRelogTranscript({
      ownerId: 2,
      completeFromStart: true,
      records,
      ceiling: 1_500,
    });
    assert.ok(text.length <= 1_500);
    assert.match(text, /omitted=[1-9]\d*/);
    assert.match(text, /relog\.finished/);
  });
});
