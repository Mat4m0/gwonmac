/**
 * Runs the local client proof and owns everything the proof itself may not:
 * the bounded child process and its timeout.
 *
 * The child gets the proof mode, module path, and hash it must match, and
 * nothing else.
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

const VERIFIER_TIMEOUT_MS = 5_000;

function runVerifierProcess(
  officialWasmPath: string,
  officialSha256: string,
): Promise<LocalClientVerification | null> {
  return new Promise((resolve) => {
    const entry = fileURLToPath(
      new URL("./local-client-verifier-process.js", import.meta.url),
    );
    const child = utilityProcess.fork(
      entry,
      ["client", officialWasmPath, officialSha256],
      { serviceName: "Guild Wars client compatibility verifier" },
    );
    let settled = false;
    const finish = (value: LocalClientVerification | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), VERIFIER_TIMEOUT_MS);
    child.once("message", (value: unknown) => {
      finish(
        isLocalClientVerification(value, officialSha256) ? value : null,
      );
    });
    child.once("exit", () => finish(null));
  });
}

function runNativeDoubleClickVerifierProcess(
  wasmPath: string,
  inputSha256: string,
): Promise<NativeDoubleClickBuild | null> {
  return new Promise((resolve) => {
    const entry = fileURLToPath(
      new URL("./local-client-verifier-process.js", import.meta.url),
    );
    const child = utilityProcess.fork(
      entry,
      ["native-double-click", wasmPath, inputSha256],
      { serviceName: "Guild Wars double-click verifier" },
    );
    let settled = false;
    const finish = (value: NativeDoubleClickBuild | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), VERIFIER_TIMEOUT_MS);
    child.once("message", (value: unknown) => {
      finish(isDerivedNativeDoubleClickBuild(value, inputSha256) ? value : null);
    });
    child.once("exit", () => finish(null));
  });
}

/**
 * Runs the expensive parsers outside the main and renderer processes for every
 * unknown exact hash. A crash, timeout or malformed reply is simply "no proof";
 * callers keep the untouched official module.
 */
export async function verifyClientLocally(options: {
  officialWasmPath: string;
  officialSha256: string;
}): Promise<LocalClientVerification | null> {
  return runVerifierProcess(
    options.officialWasmPath,
    options.officialSha256,
  ).catch(() => null);
}

/** Derives a native callback record without parsing unknown bytes in Main. */
export async function verifyNativeDoubleClickLocally(options: {
  wasmPath: string;
  inputSha256: string;
}): Promise<NativeDoubleClickBuild | null> {
  return runNativeDoubleClickVerifierProcess(
    options.wasmPath,
    options.inputSha256,
  ).catch(() => null);
}
