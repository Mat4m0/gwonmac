import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runGwDatDecoder } from "../../src/main/core/gw-dat-decoder.js";

const OPTIONS = {
  args: ["--eval", "process.exit(2)"],
  maxOutput: 8,
  parse: (output: Uint8Array) => Buffer.from(output),
} as const;

describe("Guild Wars archive decoder process boundary", () => {
  it("settles and stops the child when writing stdin throws", async () => {
    const input = new Uint8Array(8);
    if (!(input.buffer instanceof ArrayBuffer)) throw new Error("expected ArrayBuffer");
    structuredClone(input, { transfer: [input.buffer] });

    await assert.rejects(
      runGwDatDecoder(process.execPath, input, {
        ...OPTIONS,
        args: ["--eval", "setTimeout(() => undefined, 10_000)"],
      }),
      TypeError,
    );
  });

  it("contains an early stdin close and reports the decoder refusal", async () => {
    await assert.rejects(
      runGwDatDecoder(process.execPath, Buffer.alloc(2 * 1024 * 1024), OPTIONS),
      /archive decoder refused the local asset/u,
    );
  });

  it("settles once when an output refusal closes stdin", async () => {
    await assert.rejects(
      runGwDatDecoder(process.execPath, Buffer.alloc(2 * 1024 * 1024), {
        args: ["--eval", "process.stdout.write('too large')"],
        maxOutput: 1,
        parse: OPTIONS.parse,
      }),
      /archive decoder exceeded its output bound/u,
    );
  });
});
