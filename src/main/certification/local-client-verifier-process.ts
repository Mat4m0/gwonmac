/**
 * The utility process the local client proof runs inside: read the module,
 * confirm it is the one that was asked for, verify it, answer once.
 *
 * Isolation is the whole point. The verifier walks a multi-megabyte module this
 * project did not produce, so it runs where a crash or a runaway loop costs the
 * launch nothing. The host owns the timeout; this process holds no state and
 * writes no files.
 *
 * Every refusal is its own exit code and posts `null` before returning. That
 * closes the parent's wait immediately; the parent still validates every
 * non-null result and owns the timeout for a crash or a hung parser.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "./local-client-verifier.js";
import {
  deriveNativeDoubleClickBuild,
  isDerivedNativeDoubleClickBuild,
} from "./native-double-click.js";

interface ParentPort {
  postMessage(value: unknown): void;
}

const parentPort = (
  process as NodeJS.Process & { parentPort?: ParentPort }
).parentPort;

async function main(): Promise<void> {
  const [mode, wasmPath, expectedSha256] = process.argv.slice(2);
  if (!parentPort || !mode || !wasmPath || !expectedSha256) {
    process.exitCode = 2;
    return;
  }

  const bytes = await readFile(wasmPath);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    parentPort.postMessage(null);
    process.exitCode = 3;
    return;
  }

  if (mode === "client") {
    const result = verifyLocalClientBytes(bytes);
    if (!isLocalClientVerification(result, expectedSha256)) {
      parentPort.postMessage(null);
      process.exitCode = 4;
      return;
    }
    parentPort.postMessage(result);
    return;
  }
  if (mode === "native-double-click") {
    const result = deriveNativeDoubleClickBuild(bytes);
    if (!isDerivedNativeDoubleClickBuild(result, expectedSha256)) {
      parentPort.postMessage(null);
      process.exitCode = 4;
      return;
    }
    parentPort.postMessage(result);
    return;
  }
  parentPort.postMessage(null);
  process.exitCode = 2;
}

await main().catch(() => {
  process.exitCode = 1;
});
