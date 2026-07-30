import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "./core/local-client-verifier.js";

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
