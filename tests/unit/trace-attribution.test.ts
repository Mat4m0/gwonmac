import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeTraceStalls } from "../../src/tools/diagnostics/attribute-stalls.ts";

describe("Chromium stall attribution", () => {
  it("joins long frame marks, snapshot boundaries, CPU stacks, and renderer tasks", () => {
    const report = attributeTraceStalls(
      {
        traceEvents: [
          {
            name: "Profile",
            pid: 7,
            tid: 70,
            id: "0x1",
            ts: 1_000,
            args: { data: { startTime: 1_000 } },
          },
          {
            name: "gw.frame.submit",
            pid: 7,
            tid: 71,
            ts: 1_050,
          },
          {
            name: "gw.snapshot.resolve",
            pid: 7,
            tid: 71,
            ts: 1_150,
          },
          {
            name: "RunTask",
            ph: "X",
            pid: 7,
            tid: 71,
            ts: 1_060,
            dur: 250,
          },
          {
            name: "ProfileChunk",
            pid: 7,
            tid: 72,
            id: "0x1",
            ts: 1_310,
            args: {
              data: {
                cpuProfile: {
                  nodes: [
                    {
                      id: 1,
                      callFrame: {
                        codeType: "other",
                        functionName: "(root)",
                      },
                    },
                    {
                      id: 2,
                      parent: 1,
                      callFrame: {
                        codeType: "wasm",
                        functionName: "wasm-function[42]",
                        url: "gw://app/Gw.jspi.wasm",
                      },
                    },
                    {
                      id: 3,
                      parent: 1,
                      callFrame: {
                        codeType: "JS",
                        functionName: "assembleRange",
                        url: "gw://app/harness.js",
                      },
                    },
                    {
                      id: 4,
                      parent: 1,
                      callFrame: {
                        codeType: "other",
                        functionName: "(idle)",
                      },
                    },
                  ],
                  samples: [2, 3, 4],
                },
                timeDeltas: [100, 100, 100],
              },
            },
          },
          {
            name: "gw.frame.submit",
            pid: 7,
            tid: 71,
            ts: 1_350,
          },
          {
            name: "gw.frame.submit",
            pid: 7,
            tid: 71,
            ts: 1_400,
          },
        ],
      },
      200,
    );

    assert.equal(report.frameMarks, 3);
    assert.equal(report.stalls.length, 1);
    assert.deepEqual(report.stalls[0], {
      startUs: 1_050,
      endUs: 1_350,
      durationUs: 300,
      snapshotResolutions: 1,
      sampledUs: 300,
      categories: [
        { name: "WASM", timeUs: 100 },
        { name: "JavaScript", timeUs: 100 },
        { name: "idle", timeUs: 100 },
      ],
      leaves: [
        { name: "wasm-function[42]", timeUs: 100 },
        { name: "assembleRange (harness.js)", timeUs: 100 },
        { name: "(idle)", timeUs: 100 },
      ],
      stacks: [
        { name: "wasm-function[42]", timeUs: 100 },
        { name: "assembleRange (harness.js)", timeUs: 100 },
        { name: "(idle)", timeUs: 100 },
      ],
      traceEvents: [{ name: "RunTask", durationUs: 250 }],
    });
  });

  it("reports captures without new frame marks and rejects invalid thresholds", () => {
    assert.deepEqual(attributeTraceStalls({ traceEvents: [] }), {
      frameMarks: 0,
      thresholdUs: 100_000,
      stalls: [],
    });
    assert.throws(
      () => attributeTraceStalls({ traceEvents: [] }, 0),
      /positive/,
    );
  });
});
