import type { ForgeConfig } from "@electron-forge/shared-types";
import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Archive-rooted paths: the leading "/" is the packaged app's root. */
type PackageInventory = ReadonlySet<string>;

// Derived from Forge's own option rather than restated, because the callers
// hand this straight through from `forgeConfig.packagerConfig?.ignore` and the
// guard below is what turns the wider option into the copy filter this walk
// needs.
type PackagerIgnore = NonNullable<ForgeConfig["packagerConfig"]>["ignore"];

export const PRELOAD_ENTRY = "/build/preload/preload.cjs";

export const REQUIRED_PACKAGE_FILES = Object.freeze([
  "/build/renderer/toolbox-kernel.wasm",
  "/build/renderer/toolbox.js",
  "/build/renderer/toolbox-snapshot.js",
  "/build/renderer/toolbox-cursor.js",
  "/build/renderer/toolbox-readout.js",
  "/build/main/core/toolbox-transform.js",
  "/build/main/core/client-module.js",
  "/build/main/core/toolbox-builds.js",
  "/build/main/toolbox-policy.js",
  "/build/main/main.js",
  PRELOAD_ENTRY,
  "/build/renderer/index.html",
  "/build/renderer/images/index.json",
  "/package.json",
]);

export const DEVELOPER_PACKAGE_FILES = Object.freeze([
  "/build/tools/template-save-recert.js",
  "/build/tools/template-save-recertify.js",
  "/build/tools/toolbox-recertify.js",
  "/build/tools/toolbox-doctor.js",
  "/build/tools/toolbox-observations.js",
  "/build/tools/toolbox-transform.js",
  "/scripts/toolbox-live.ts",
  "/scripts/toolbox-live/scenarios.ts",
  "/scripts/toolbox-live/performance.ts",
  "/scripts/toolbox-visual.ts",
]);

export function assertRequiredPackageFiles(inventory: PackageInventory): void {
  for (const file of REQUIRED_PACKAGE_FILES) {
    if (!inventory.has(file)) throw new Error(`${file} is missing from the packaged app`);
  }
}

export function assertNoDeveloperPackageFiles(inventory: PackageInventory): void {
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
export function forgePackageFiles(root: string, ignore: PackagerIgnore): string[] {
  if (typeof ignore !== "function") {
    throw new TypeError("Forge's package ignore function is missing");
  }

  const walk = (directory: string, prefix = ""): string[] => {
    const files: string[] = [];
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
export function htmlScriptEntryPoints(htmlPath: string, html: string): string[] {
  const entries: string[] = [];
  const scriptSource = /<script\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/giu;
  for (const match of html.matchAll(scriptSource)) {
    const source = match[2];
    if (source === undefined) continue;
    if (/^[a-z][a-z\d+.-]*:/iu.test(source) || source.startsWith("//")) continue;
    const pathname = source.replace(/[?#][\s\S]*$/u, "");
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
export function relativeEsmClosure({
  entryPoints,
  inventory,
  readText,
}: {
  entryPoints: readonly string[];
  inventory: PackageInventory;
  readText: (file: string) => string;
}): ReadonlySet<string> {
  const pending = entryPoints.map((entry) => path.posix.resolve("/", entry));
  const visited = new Set<string>();

  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
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
      const specifierPath = imported.fileName.replace(/[?#][\s\S]*$/u, "");
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
