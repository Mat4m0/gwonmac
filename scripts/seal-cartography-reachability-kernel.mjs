import { createHash } from "node:crypto";
import {
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { validateCartographyReachabilityKernelContract } from
  "./cartography-reachability-kernel-contract.mjs";

export const CANDIDATE = "build/.cartography-reachability-kernel.unsealed.wasm";
export const ARTIFACT = "build/renderer/cartography-reachability-kernel.wasm";
export const LOADER = "build/renderer/cartography-spike/reachability-kernel.js";
export const HASH_BINDING = "CARTOGRAPHY_REACHABILITY_SEALED_SHA256";
const MARKER = "const kernelModule = await WebAssembly.compile(kernelBytes);";

/** @param {Uint8Array} bytes */
export function reachabilitySha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {string} source @param {string} expectedSha256 */
export function verifySealedReachabilityLoader(source, expectedSha256) {
  const declaration = new RegExp(
    `const ${HASH_BINDING} = "([a-f0-9]{64})";`,
    "g",
  );
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1 || matches[0]?.[1] !== expectedSha256) {
    throw new Error("reachability kernel seal is missing or does not match");
  }
  const comparisonAt = source.indexOf(`kernelSha256 !== ${HASH_BINDING}`);
  const compileAt = source.indexOf(MARKER);
  if (comparisonAt < 0 || compileAt < 0 || comparisonAt > compileAt) {
    throw new Error("reachability kernel seal is not checked before compilation");
  }
}

/** @param {string} source @param {string} sha256 */
export function sealReachabilityLoaderSource(source, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("reachability kernel seal is not a SHA-256 digest");
  }
  if (source.includes(HASH_BINDING) || source.split(MARKER).length !== 2) {
    throw new Error("reachability loader compile boundary is invalid");
  }
  const sealed = source.replace(
    MARKER,
    `const ${HASH_BINDING} = "${sha256}"; `
      + `if (kernelSha256 !== ${HASH_BINDING}) { `
      + `throw new Error("Cartography reachability kernel integrity check failed"); } `
      + MARKER,
  );
  verifySealedReachabilityLoader(sealed, sha256);
  return sealed;
}

/**
 * Validate both inputs, publish the sealed loader, then activate the artifact.
 * If any later step fails, restore the original loader and remove the artifact.
 *
 * @param {{candidatePath?: string, artifactPath?: string, loaderPath?: string}} [paths]
 */
export function sealCartographyReachabilityKernel(paths = {}) {
  const candidatePath = paths.candidatePath ?? CANDIDATE;
  const artifactPath = paths.artifactPath ?? ARTIFACT;
  const loaderPath = paths.loaderPath ?? LOADER;
  if (candidatePath === artifactPath) {
    throw new Error("reachability candidate and artifact paths must differ");
  }
  const loaderTemp = `${loaderPath}.seal-${process.pid}.tmp`;
  const restoreTemp = `${loaderPath}.restore-${process.pid}.tmp`;
  let originalLoader;
  let loaderMode;
  let loaderPublished = false;
  try {
    const candidate = readFileSync(candidatePath);
    validateCartographyReachabilityKernelContract(candidate);
    const digest = reachabilitySha256(candidate);
    originalLoader = readFileSync(loaderPath, "utf8");
    loaderMode = statSync(loaderPath).mode & 0o777;
    const sealed = sealReachabilityLoaderSource(originalLoader, digest);
    writeFileSync(loaderTemp, sealed, { mode: loaderMode });
    renameSync(loaderTemp, loaderPath);
    loaderPublished = true;
    renameSync(candidatePath, artifactPath);
    verifySealedReachabilityLoader(readFileSync(loaderPath, "utf8"), digest);
    if (reachabilitySha256(readFileSync(artifactPath)) !== digest) {
      throw new Error("published reachability kernel changed during sealing");
    }
    return digest;
  } catch (error) {
    rmSync(artifactPath, { force: true });
    rmSync(loaderTemp, { force: true });
    if (loaderPublished && originalLoader !== undefined && loaderMode !== undefined) {
      try {
        writeFileSync(restoreTemp, originalLoader, { mode: loaderMode });
        renameSync(restoreTemp, loaderPath);
      } catch {
        rmSync(restoreTemp, { force: true });
      }
    }
    throw error;
  } finally {
    rmSync(loaderTemp, { force: true });
    rmSync(restoreTemp, { force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  sealCartographyReachabilityKernel();
  console.log("sealed Cartography reachability kernel");
}
