/**
 * The bounded process boundary around the vendored Guild Wars archive decoder.
 *
 * The helper accepts one compressed archive stream on stdin. Callers choose
 * the decoder mode and validate the returned format, while this module owns
 * the shared timeout and output-size enforcement.
 */

import { spawn } from "node:child_process";

const HELPER_TIMEOUT_MS = 5_000;

export function runGwDatDecoder(
  executable: string,
  input: Uint8Array,
  options: {
    readonly args: readonly string[];
    readonly maxOutput: number;
    parse(output: Uint8Array): Buffer;
  },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, options.args, {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("the archive decoder timed out")),
      HELPER_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > options.maxOutput) {
        fail(new Error("the archive decoder exceeded its output bound"));
      } else {
        chunks.push(chunk);
      }
    });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error("the archive decoder refused the local asset"));
        return;
      }
      try {
        resolve(options.parse(Buffer.concat(chunks, length)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

/** Read the decoder's `GWDB`, little-endian length, payload envelope. */
export function decodedArchiveBytes(
  decoded: Uint8Array,
  maximumPayloadBytes: number,
  content = "data",
): Buffer {
  if (
    decoded.length < 8
    || String.fromCharCode(...decoded.subarray(0, 4)) !== "GWDB"
  ) {
    throw new Error(`the archive decoder returned an invalid ${content} header`);
  }
  const length = new DataView(
    decoded.buffer,
    decoded.byteOffset + 4,
    4,
  ).getUint32(0, true);
  if (length > maximumPayloadBytes || decoded.byteLength !== length + 8) {
    throw new Error(`the archive decoder returned an invalid ${content} length`);
  }
  return Buffer.from(decoded.subarray(8));
}
