/**
 * The utility process the local client proof runs inside: read the module,
 * confirm it is the one that was asked for, verify it, answer once.
 *
 * Isolation is the whole point. The verifier walks a multi-megabyte module this
 * project did not produce, so it runs where a crash or a runaway loop costs the
 * launch nothing. The host owns the timeout; this process holds no state and
 * writes no files.
 *
 * Every refusal is its own exit code, and no message is posted unless the
 * result also passes the boundary check, so the parent never has to interpret a
 * partial answer.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "./local-client-verifier.js";

interface ParentPort {
  postMessage(value: unknown): void;
}

const parentPort = (
  process as NodeJS.Process & { parentPort?: ParentPort }
).parentPort;

async function main(): Promise<void> {
  const [wasmPath, expectedSha256] = process.argv.slice(2);
  if (!parentPort || !wasmPath || !expectedSha256) {
    process.exitCode = 2;
    return;
  }

  const bytes = await readFile(wasmPath);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    process.exitCode = 3;
    return;
  }

  const result = verifyLocalClientBytes(bytes);
  if (!isLocalClientVerification(result, expectedSha256)) {
    process.exitCode = 4;
    return;
  }
  parentPort.postMessage(result);
}

await main().catch(() => {
  process.exitCode = 1;
});
