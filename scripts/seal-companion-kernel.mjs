import { createHash } from "node:crypto";
import {
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { validateCompanionKernelContract } from "./companion-kernel-contract.mjs";

export const COMPANION_KERNEL_CANDIDATE =
  "build/.companion-kernel.unsealed.wasm";
export const COMPANION_KERNEL_ARTIFACT =
  "build/renderer/companion-kernel.wasm";
export const COMPANION_KERNEL_LOADER =
  "build/renderer/companion-kernel-loader.js";
export const COMPANION_KERNEL_HASH_PLACEHOLDER =
  "__COMPANION_KERNEL_SHA256_PLACEHOLDER__";
export const COMPANION_KERNEL_HASH_BINDING =
  "COMPANION_KERNEL_SEALED_SHA256";

const COMPILE_MARKER =
  "const kernelModule = await WebAssembly.compile(kernelBytes);";

/** @param {Uint8Array} bytes */
export function companionKernelSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {string} source @param {string} expectedSha256 */
export function verifySealedCompanionLoader(source, expectedSha256) {
  const declaration = new RegExp(
    `const ${COMPANION_KERNEL_HASH_BINDING} = "([a-f0-9]{64})";`,
    "g",
  );
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1 || matches[0]?.[1] !== expectedSha256) {
    throw new Error("companion kernel seal is missing or does not match");
  }
  if (source.includes(COMPANION_KERNEL_HASH_PLACEHOLDER)) {
    throw new Error("companion kernel hash placeholder was not replaced");
  }
  const comparison =
    `kernelSha256 !== ${COMPANION_KERNEL_HASH_BINDING}`;
  const comparisonAt = source.indexOf(comparison);
  const compileAt = source.indexOf(COMPILE_MARKER);
  if (comparisonAt < 0 || compileAt < 0 || comparisonAt > compileAt) {
    throw new Error("companion kernel seal is not checked before compilation");
  }
}

/** @param {string} source @param {string} sha256 */
export function sealCompanionLoaderSource(source, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("companion kernel seal is not a SHA-256 digest");
  }
  if (
    source.includes(COMPANION_KERNEL_HASH_BINDING)
    || source.includes(COMPANION_KERNEL_HASH_PLACEHOLDER)
  ) {
    throw new Error("companion kernel loader already contains a seal");
  }
  if (source.split(COMPILE_MARKER).length !== 2) {
    throw new Error("companion kernel loader compile boundary is not unique");
  }
  const check =
    `const ${COMPANION_KERNEL_HASH_BINDING} = `
    + `"${COMPANION_KERNEL_HASH_PLACEHOLDER}"; `
    + `if (kernelSha256 !== ${COMPANION_KERNEL_HASH_BINDING}) { `
    + `throw new Error("Companion kernel integrity check failed"); } `
    + COMPILE_MARKER;
  const sealed = source
    .replace(COMPILE_MARKER, check)
    .replace(COMPANION_KERNEL_HASH_PLACEHOLDER, sha256);
  verifySealedCompanionLoader(sealed, sha256);
  return sealed;
}

/**
 * Validate the rustc candidate, prepare the loader seal, then publish each
 * through an atomic rename with the served artifact last. A failed candidate
 * never reaches the served path.
 *
 * @param {{candidatePath?: string, artifactPath?: string, loaderPath?: string}} [paths]
 */
export function sealCompanionKernelBuild(paths = {}) {
  const candidatePath = paths.candidatePath ?? COMPANION_KERNEL_CANDIDATE;
  const artifactPath = paths.artifactPath ?? COMPANION_KERNEL_ARTIFACT;
  const loaderPath = paths.loaderPath ?? COMPANION_KERNEL_LOADER;
  if (candidatePath === artifactPath) {
    throw new Error("companion candidate and artifact paths must differ");
  }

  const loaderTemp = `${loaderPath}.seal-${process.pid}.tmp`;
  const restoreTemp = `${loaderPath}.restore-${process.pid}.tmp`;
  let loader;
  let loaderMode;
  let loaderPublished = false;
  try {
    const candidate = readFileSync(candidatePath);
    validateCompanionKernelContract(candidate);
    const sha256 = companionKernelSha256(candidate);
    loader = readFileSync(loaderPath, "utf8");
    loaderMode = statSync(loaderPath).mode & 0o777;
    const sealedLoader = sealCompanionLoaderSource(loader, sha256);
    writeFileSync(loaderTemp, sealedLoader, {
      mode: loaderMode,
    });
    renameSync(loaderTemp, loaderPath);
    loaderPublished = true;
    renameSync(candidatePath, artifactPath);
    verifySealedCompanionLoader(readFileSync(loaderPath, "utf8"), sha256);
    if (companionKernelSha256(readFileSync(artifactPath)) !== sha256) {
      throw new Error("published companion kernel changed during sealing");
    }
    return sha256;
  } catch (error) {
    // The artifact is the activation boundary. Never leave one behind from a
    // failed seal, and restore the original loader after a later failure.
    rmSync(artifactPath, { force: true });
    rmSync(loaderTemp, { force: true });
    if (
      loaderPublished
      && loader !== undefined
      && loaderMode !== undefined
    ) {
      try {
        writeFileSync(restoreTemp, loader, { mode: loaderMode });
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
  sealCompanionKernelBuild();
  console.log("sealed companion kernel artifact and loader hash");
}
