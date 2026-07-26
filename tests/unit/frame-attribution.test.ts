import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributeFrameStalls,
  parseRecorderEvents,
  visibleFrameTimestamps,
} from "../../src/tools/diagnostics/attribute-frames.ts";

/** Build a GWFRAME1 buffer from [timestampUs, visible] pairs. */
function frames(rows: Array<[number, number]>): Uint8Array {
  const bytes = new Uint8Array(16 + rows.length * 7 * 8);
  bytes.set(new TextEncoder().encode("GWFRAME1"));
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 7, true);
  rows.forEach(([timestampUs, visible], record) => {
    const base = 16 + record * 7 * 8;
    view.setFloat64(base, timestampUs, true);
    view.setFloat64(base + 6 * 8, visible, true);
  });
  return bytes;
}

describe("frame attribution", () => {
  it("reads only visible records and rejects a bad header", () => {
    assert.deepEqual(
      visibleFrameTimestamps(
        frames([
          [1_000, 1],
          [17_000, 0],
          [33_000, 1],
        ]),
      ),
      [1_000, 33_000],
    );
    assert.throws(
      () => visibleFrameTimestamps(new Uint8Array(16)),
      /header is invalid/,
    );
  });

  it("blames composition loss when the window changed state", () => {
    const report = attributeFrameStalls(
      frames([
        [1_000_000, 1],
        [1_400_000, 1],
      ]),
      parseRecorderEvents(
        [
          JSON.stringify({ tsUs: 1_100_000, name: "window.blurred" }),
          JSON.stringify({ tsUs: 1_100_000, name: "process.main", fields: {} }),
        ].join("\n"),
      ),
      { thresholdUs: 100_000, instrumented: true },
    );
    assert.equal(report.stalls.length, 1);
    assert.equal(report.stalls[0]?.cause, "composition");
    assert.deepEqual(report.stalls[0]?.windowEvents, ["window.blurred@1.10s"]);
    // Per-sample telemetry is never offered as an explanation.
    assert.deepEqual(report.stalls[0]?.events, []);
  });

  it("blames the main process only when its event loop actually blocked", () => {
    const blocked = attributeFrameStalls(
      frames([
        [1_000_000, 1],
        [1_400_000, 1],
      ]),
      parseRecorderEvents(
        JSON.stringify({
          tsUs: 1_200_000,
          name: "eventLoop.sample",
          fields: { maxUs: 300_000 },
        }),
      ),
      { thresholdUs: 100_000, instrumented: true },
    );
    assert.equal(blocked.stalls[0]?.cause, "mainProcess");
    assert.equal(blocked.stalls[0]?.mainLoopMaxUs, 300_000);

    const idle = attributeFrameStalls(
      frames([
        [1_000_000, 1],
        [1_400_000, 1],
      ]),
      parseRecorderEvents(
        [
          JSON.stringify({
            tsUs: 1_200_000,
            name: "eventLoop.sample",
            fields: { maxUs: 26_000 },
          }),
          JSON.stringify({
            tsUs: 1_050_000,
            name: "socket.error",
            fields: { message: "read ECONNRESET" },
          }),
        ].join("\n"),
      ),
      { thresholdUs: 100_000, instrumented: true },
    );
    assert.equal(idle.stalls[0]?.cause, "renderer");
    assert.deepEqual(idle.stalls[0]?.events, ["socket.error@1.05s"]);
  });

  it("refuses to blame anything when the capture predates the instrumentation", () => {
    const report = attributeFrameStalls(
      frames([
        [1_000_000, 1],
        [1_400_000, 1],
      ]),
      [],
      { thresholdUs: 100_000 },
    );
    assert.equal(report.instrumented, false);
    assert.equal(report.stalls[0]?.cause, "uninstrumented");
  });

  it("ignores gaps under the threshold and events outside the window", () => {
    const report = attributeFrameStalls(
      frames([
        [1_000_000, 1],
        [1_016_000, 1],
        [1_400_000, 1],
      ]),
      parseRecorderEvents(
        [
          // Three seconds before the stall: outside the correlation window.
          JSON.stringify({ tsUs: 1_000_000 - 3_000_000, name: "window.blurred" }),
          "{ this line is torn",
        ].join("\n"),
      ),
      { thresholdUs: 100_000, instrumented: true },
    );
    assert.equal(report.stalls.length, 1);
    assert.equal(report.stalls[0]?.durationUs, 384_000);
    assert.equal(report.stalls[0]?.cause, "renderer");
  });

  it("rejects a non-positive threshold", () => {
    assert.throws(
      () => attributeFrameStalls(frames([[0, 1]]), [], { thresholdUs: 0 }),
      /positive number/,
    );
  });
});
