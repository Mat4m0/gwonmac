/**
 * Runs the local client proof and owns everything the proof itself may not:
 * the bounded child process, the timeout, and the derived on-disk cache.
 *
 * The child gets the module path and the hash it must match, and nothing else.
 * A result is accepted only if it survives `isLocalClientVerification` against
 * that same hash, whether it arrived over the message port or came back out of
 * the cache — a cache file is untrusted input, not a shortcut past the check.
 * Its checksum catches ordinary corruption; the boundary check is what makes an
 * edited one useless.
 *
 * The timeout is the reason for the process at all: a client this app did not
 * produce must not be able to hang a launch by hanging the verifier.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { utilityProcess } from "electron";
import { writeAtomicJson } from "../core/atomic-file.js";
import {
  isLocalClientVerification,
  type LocalClientVerification,
} from "./local-client-verifier.js";

const VERIFIER_TIMEOUT_MS = 5_000;

export type LocalVerificationSource = "cache" | "process";

export interface LocalVerificationOutcome {
  readonly result: LocalClientVerification;
  readonly source: LocalVerificationSource;
}

interface VerificationCache {
  readonly result: LocalClientVerification;
  readonly checksum: string;
}

function checksum(result: LocalClientVerification): string {
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}

async function readCachedVerification(
  cachePath: string,
  officialSha256: string,
): Promise<LocalClientVerification | null> {
  try {
    const value = JSON.parse(
      await readFile(cachePath, "utf8"),
    ) as Partial<VerificationCache>;
    if (
      !value.result
      || value.checksum !== checksum(value.result)
      || !isLocalClientVerification(value.result, officialSha256)
    ) {
      return null;
    }
    return value.result;
  } catch {
    return null;
  }
}

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
      [officialWasmPath, officialSha256],
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

/**
 * Reuses an exact-hash answer when possible. Otherwise the expensive parsers
 * run outside the main and renderer processes. A crash, timeout or malformed
 * reply is simply "no proof"; callers keep the untouched official module.
 */
export async function verifyClientLocally(options: {
  officialWasmPath: string;
  officialSha256: string;
  cachePath: string;
}): Promise<LocalVerificationOutcome | null> {
  const cached = await readCachedVerification(
    options.cachePath,
    options.officialSha256,
  );
  if (cached) return { result: cached, source: "cache" };

  const result = await runVerifierProcess(
    options.officialWasmPath,
    options.officialSha256,
  ).catch(() => null);
  if (!result) return null;

  // Cache publication is an optimisation, never a launch requirement.
  await writeAtomicJson(
    options.cachePath,
    { result, checksum: checksum(result) } satisfies VerificationCache,
    0o600,
  ).catch(() => undefined);
  return { result, source: "process" };
}
