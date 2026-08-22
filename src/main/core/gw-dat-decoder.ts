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
    const timer = setTimeout(
      () => settle({ error: new Error("the archive decoder timed out") }),
      HELPER_TIMEOUT_MS,
    );
    function removeOperationalListeners(): void {
      child.stdout.removeListener("data", onStdoutData);
      child.removeListener("close", onChildClose);
    }
    function settle(
      outcome: { readonly value: Buffer } | { readonly error: unknown },
    ): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeOperationalListeners();
      if ("error" in outcome) {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        reject(outcome.error);
      } else {
        resolve(outcome.value);
      }
    }
    function onStdoutData(chunk: Buffer): void {
      length += chunk.length;
      if (length > options.maxOutput) {
        settle({
          error: new Error("the archive decoder exceeded its output bound"),
        });
      } else {
        chunks.push(chunk);
      }
    }
    function onChildError(error: Error): void {
      settle({ error });
    }
    function onChildResourceClose(): void {
      // Like stdin below, the process error listener remains until close so a
      // failed kill cannot turn cleanup into an uncaught EventEmitter error.
      child.removeListener("error", onChildError);
    }
    function onChildClose(code: number | null): void {
      if (code !== 0) {
        settle({ error: new Error("the archive decoder refused the local asset") });
        return;
      }
      try {
        settle({ value: options.parse(Buffer.concat(chunks, length)) });
      } catch (error) {
        settle({ error });
      }
    }
    function onStdinError(error: NodeJS.ErrnoException): void {
      // A decoder that refuses an input may close its pipe while Node is still
      // flushing that input. Its process result owns the refusal.
      if (error.code !== "EPIPE") settle({ error });
    }
    function onStdinClose(): void {
      // This listener intentionally outlives settlement: removing it while a
      // buffered write can still report EPIPE would turn expected refusal into
      // an uncaught process error. The stream's close owns its final cleanup.
      child.stdin.removeListener("error", onStdinError);
    }
    child.stdout.on("data", onStdoutData);
    child.on("error", onChildError);
    child.on("close", onChildClose);
    child.once("close", onChildResourceClose);
    child.stdin.on("error", onStdinError);
    child.stdin.once("close", onStdinClose);
    try {
      child.stdin.end(input);
    } catch (error) {
      settle({ error });
    }
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
