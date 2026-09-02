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
import {
  enhancementCapabilitiesForProfile,
  NO_ENHANCEMENT_CAPABILITIES,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  deriveExtendedMemoryStructuralProof,
  isExtendedMemoryStructuralProof,
} from "./extended-memory.js";
import {
  deriveCartographySpikeBuild,
  isCartographySpikeBuild,
} from "./cartography-spike-verifier.js";

interface ParentPort {
  postMessage(value: unknown): void;
}

const parentPort = (
  process as NodeJS.Process & { parentPort?: ParentPort }
).parentPort;

async function main(): Promise<void> {
  const [mode, firstPath, firstSha256, secondPath, secondSha256] =
    process.argv.slice(2);
  if (!parentPort || !mode || !firstPath || !firstSha256) {
    process.exitCode = 2;
    return;
  }

  if (mode === "extended-memory") {
    if (!secondPath || !secondSha256) {
      process.exitCode = 2;
      return;
    }
    const [jsInput, wasmInput] = await Promise.all([
      readFile(firstPath, "utf8"),
      readFile(secondPath),
    ]);
    const actualJsSha256 = createHash("sha256").update(jsInput).digest("hex");
    const actualWasmSha256 = createHash("sha256").update(wasmInput).digest("hex");
    if (actualJsSha256 !== firstSha256 || actualWasmSha256 !== secondSha256) {
      parentPort.postMessage(null);
      process.exitCode = 3;
      return;
    }
    const result = deriveExtendedMemoryStructuralProof(jsInput, wasmInput);
    if (!isExtendedMemoryStructuralProof(result, firstSha256, secondSha256)) {
      parentPort.postMessage(null);
      process.exitCode = 4;
      return;
    }
    parentPort.postMessage(result);
    return;
  }

  const wasmPath = firstPath;
  const expectedSha256 = firstSha256;
  const requestedProfile = secondPath;

  const bytes = await readFile(wasmPath);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    parentPort.postMessage(null);
    process.exitCode = 3;
    return;
  }

  if (mode === "client") {
    const requestedCapabilities: EnhancementCapabilities | null = requestedProfile === "none"
      ? NO_ENHANCEMENT_CAPABILITIES
      : requestedProfile
        ? enhancementCapabilitiesForProfile(requestedProfile)
        : null;
    if (!requestedCapabilities) {
      parentPort.postMessage(null);
      process.exitCode = 2;
      return;
    }
    const result = verifyLocalClientBytes(bytes, requestedCapabilities);
    if (!isLocalClientVerification(
      result,
      expectedSha256,
      requestedCapabilities,
    )) {
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
  if (mode === "cartography") {
    const result = deriveCartographySpikeBuild(bytes);
    if (!isCartographySpikeBuild(result, expectedSha256)) {
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
  parentPort?.postMessage(null);
  process.exitCode = 1;
});
