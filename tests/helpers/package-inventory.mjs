import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const PRELOAD_ENTRY = "/build/preload/preload.cjs";

export const REQUIRED_PACKAGE_FILES = Object.freeze([
  "/build/renderer/companion-kernel.wasm",
  "/build/renderer/enhancements.js",
  "/build/renderer/companion-snapshot.js",
  "/build/renderer/enhancement-cursor.js",
  "/build/renderer/enhancement-readout.js",
  "/build/main/core/enhancement-transform.js",
  "/build/main/core/client-module.js",
  "/build/main/core/enhancement-builds.js",
  "/build/main/enhancement-policy.js",
  "/build/main/main.js",
  PRELOAD_ENTRY,
  "/build/renderer/index.html",
  "/build/renderer/images/index.json",
  "/package.json",
]);

export const DEVELOPER_PACKAGE_FILES = Object.freeze([
  "/build/tools/template-save-recert.js",
  "/build/tools/template-save-recertify.js",
  "/build/tools/enhancement-recertify.js",
  "/build/tools/enhancement-doctor.js",
  "/build/tools/enhancement-observations.js",
  "/build/tools/enhancement-transform.js",
  "/scripts/enhancements-live.mjs",
  "/scripts/enhancements-live/scenarios.mjs",
  "/scripts/enhancements-live/performance.mjs",
  "/scripts/enhancements-visual.mjs",
]);

export function assertRequiredPackageFiles(inventory) {
  for (const file of REQUIRED_PACKAGE_FILES) {
    if (!inventory.has(file)) throw new Error(`${file} is missing from the packaged app`);
  }
}

export function assertNoDeveloperPackageFiles(inventory) {
  for (const file of DEVELOPER_PACKAGE_FILES) {
    if (inventory.has(file)) throw new Error(`${file} ships in the packaged app`);
  }

  const developerShaped = /recert|doctor|observation|scenario|benchmark|\.map$|\.d\.ts$/u;
  const unexpected = [...inventory].filter((file) => developerShaped.test(file));
  if (unexpected.length > 0) {
    throw new Error(`developer-shaped files ship in the packaged app: ${unexpected.join(", ")}`);
  }

  for (const file of inventory) {
    if (!/^\/(?:build\/(?:main|shared|renderer|preload)\/|package\.json$)/u.test(file)) {
      throw new Error(`${file} is outside the packaged runtime trees`);
    }
  }
}

/** Reproduce Electron Packager's copy walk over the repository. */
export function forgePackageFiles(root, ignore) {
  if (typeof ignore !== "function") {
    throw new TypeError("Forge's package ignore function is missing");
  }

  const walk = (directory, prefix = "") => {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}/${entry.name}`;
      if (ignore(name)) continue;
      if (entry.isDirectory()) {
        files.push(...walk(path.join(directory, entry.name), name));
      } else {
        files.push(name);
      }
    }
    return files;
  };

  return walk(root);
}

/** Return local script paths from an HTML file as archive-rooted paths. */
export function htmlScriptEntryPoints(htmlPath, html) {
  const entries = [];
  const scriptSource = /<script\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/giu;
  for (const match of html.matchAll(scriptSource)) {
    const source = match[2];
    if (/^[a-z][a-z\d+.-]*:/iu.test(source) || source.startsWith("//")) continue;
    const [pathname] = source.split(/[?#]/u, 1);
    entries.push(path.posix.resolve(path.posix.dirname(htmlPath), pathname));
  }
  return entries;
}

/**
 * Walk every literal relative module dependency reachable from the supplied
 * JavaScript entry points. TypeScript's scanner understands static, re-export
 * and dynamic imports plus CommonJS require calls, while ignoring JSDoc-only
 * import types.
 */
export function relativeEsmClosure({ entryPoints, inventory, readText }) {
  const pending = entryPoints.map((entry) => path.posix.resolve("/", entry));
  const visited = new Set();

  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    if (!inventory.has(file)) {
      throw new Error(`packaged entry point ${file} is missing`);
    }
    visited.add(file);

    if (!/\.[cm]?js$/u.test(file)) continue;
    const imports = ts.preProcessFile(readText(file), true, true).importedFiles;
    for (const imported of imports) {
      if (!imported.fileName.startsWith("./") && !imported.fileName.startsWith("../")) {
        continue;
      }
      const [specifierPath] = imported.fileName.split(/[?#]/u, 1);
      const dependency = path.posix.resolve(path.posix.dirname(file), specifierPath);
      if (!inventory.has(dependency)) {
        throw new Error(
          `${file} imports ${imported.fileName}, but ${dependency} is absent from the package`,
        );
      }
      pending.push(dependency);
    }
  }

  return visited;
}
