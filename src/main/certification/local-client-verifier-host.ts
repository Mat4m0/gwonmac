/**
 * Runs the local client proof and owns everything the proof itself may not:
 * the bounded child process and its timeout.
 *
 * The child gets the proof mode plus only the artifact paths and hashes that
 * proof needs.
 * A result is accepted only if it arrives from this launch's process and
 * survives `isLocalClientVerification` against that same hash. Profile state is
 * never certification authority, so every unknown exact hash runs the proof.
 *
 * The timeout is the reason for the process at all: a client this app did not
 * produce must not be able to hang a launch by hanging the verifier.
 */
import { fileURLToPath } from "node:url";
import { utilityProcess } from "electron";
import {
  isLocalClientVerification,
  type LocalClientVerification,
} from "./local-client-verifier.js";
import {
  isDerivedNativeDoubleClickBuild,
  type NativeDoubleClickBuild,
} from "./native-double-click.js";
import {
  enhancementCapabilityProfile,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  isExtendedMemoryStructuralProof,
  type ExtendedMemoryStructuralProof,
} from "./extended-memory.js";
import {
  isCartographySpikeBuild,
  type CartographySpikeBuild,
} from "./cartography-spike-verifier.js";

const VERIFIER_TIMEOUT_MS = 5_000;

function runIsolatedVerifier<Result>(options: {
  args: readonly string[];
  serviceName: string;
  accept: (value: unknown) => Result | null;
}): Promise<Result | null> {
  return new Promise((resolve) => {
    const entry = fileURLToPath(
      new URL("./local-client-verifier-process.js", import.meta.url),
    );
    const child = utilityProcess.fork(
      entry,
      [...options.args],
      { serviceName: options.serviceName },
    );
    let settled = false;
    const finish = (value: Result | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), VERIFIER_TIMEOUT_MS);
    child.once("message", (value: unknown) => finish(options.accept(value)));
    child.once("exit", () => finish(null));
  });
}

/**
 * Runs the expensive parsers outside the main and renderer processes for every
 * prepared input. A crash, timeout or malformed reply is simply "no proof";
 * callers keep the untouched official module.
 */
export async function verifyClientLocally(options: {
  officialWasmPath: string;
  officialSha256: string;
  requestedCapabilities: EnhancementCapabilities;
}): Promise<LocalClientVerification | null> {
  return runIsolatedVerifier({
    args: [
      "client",
      options.officialWasmPath,
      options.officialSha256,
      enhancementCapabilityProfile(options.requestedCapabilities) ?? "none",
    ],
    serviceName: "Guild Wars client compatibility verifier",
    accept: (value) => isLocalClientVerification(
      value,
      options.officialSha256,
      options.requestedCapabilities,
    ) ? value : null,
  }).catch(() => null);
}

/** Derives a native callback record without parsing unknown bytes in Main. */
export async function verifyNativeDoubleClickLocally(options: {
  wasmPath: string;
  inputSha256: string;
}): Promise<NativeDoubleClickBuild | null> {
  return runIsolatedVerifier({
    args: ["native-double-click", options.wasmPath, options.inputSha256],
    serviceName: "Guild Wars double-click verifier",
    accept: (value) => isDerivedNativeDoubleClickBuild(value, options.inputSha256)
      ? value
      : null,
  }).catch(() => null);
}

/** Qualifies Cartography layout and output without parsing client bytes in Main. */
export async function verifyCartographyLocally(options: {
  wasmPath: string;
  inputSha256: string;
}): Promise<CartographySpikeBuild | null> {
  return runIsolatedVerifier({
    args: ["cartography", options.wasmPath, options.inputSha256],
    serviceName: "Guild Wars Cartography compatibility verifier",
    accept: (value) => isCartographySpikeBuild(value, options.inputSha256)
      ? value
      : null,
  }).catch(() => null);
}

/** Qualifies the manifest-bound 4 GB pair without parsing it in Main. */
export async function verifyExtendedMemoryLocally(options: {
  jsPath: string;
  jsInputSha256: string;
  wasmPath: string;
  wasmInputSha256: string;
}): Promise<ExtendedMemoryStructuralProof | null> {
  return runIsolatedVerifier({
    args: [
      "extended-memory",
      options.jsPath,
      options.jsInputSha256,
      options.wasmPath,
      options.wasmInputSha256,
    ],
    serviceName: "Guild Wars extended-memory verifier",
    accept: (value) => isExtendedMemoryStructuralProof(
      value,
      options.jsInputSha256,
      options.wasmInputSha256,
    ) ? value : null,
  }).catch(() => null);
}
