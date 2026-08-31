import type { ForgeConfig } from "@electron-forge/shared-types";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Archive-rooted paths: the leading "/" is the packaged app's root. */
type PackageInventory = ReadonlySet<string>;

type PackagerIgnore = NonNullable<ForgeConfig["packagerConfig"]>["ignore"];

export const CORE_PRELOAD_ENTRY = "/build/preload/preload-core.cjs";
export const TOOLS_PRELOAD_ENTRY = "/build/preload/preload-tools.cjs";
export const LAUNCHER_PRELOAD_ENTRY = "/build/preload/preload-launcher.cjs";
export const PRELOAD_ENTRIES = Object.freeze([
  CORE_PRELOAD_ENTRY,
  TOOLS_PRELOAD_ENTRY,
  LAUNCHER_PRELOAD_ENTRY,
]);

export const REQUIRED_PACKAGE_FILES = Object.freeze([
  "/node_modules/ws/package.json",
  "/node_modules/ws/wrapper.mjs",
  "/node_modules/ws/lib/websocket.js",
  "/node_modules/pngjs/package.json",
  "/node_modules/pngjs/lib/png.js",
  "/node_modules/pngjs/lib/png-sync.js",
  "/build/native/host.node",
  "/build/renderer/companion-kernel.wasm",
  "/build/renderer/cartography-reachability-kernel.wasm",
  "/build/renderer/enhancements.js",
  "/build/renderer/companion-snapshot.js",
  "/build/renderer/enhancement-cursor.js",
  "/build/renderer/enhancement-readout.js",
  "/build/main/certification/enhancement-transform.js",
  "/build/main/certification/client-module.js",
  "/build/main/certification/enhancement-builds.js",
  "/build/main/certification/enhancement-policy.js",
  "/build/main/main.js",
  ...PRELOAD_ENTRIES,
  "/build/renderer/index.html",
  "/build/renderer/launcher/index.html",
  "/build/renderer/images/logo.webp",
  "/package.json",
]);

export const DEVELOPER_PACKAGE_FILES = Object.freeze([
  "/build/tools/certification.js",
  "/build/tools/template-save-recert.js",
  "/build/tools/enhancement-recert.js",
  "/build/tools/carry-forward.js",
  "/build/tools/enhancement-workspace.js",
  "/scripts/enhancements-live.ts",
  "/scripts/enhancements-live/scenarios.ts",
  "/scripts/enhancements-live/performance.ts",
  "/scripts/enhancements-visual.ts",
]);

export function assertRequiredPackageFiles(inventory: PackageInventory): void {
  for (const file of REQUIRED_PACKAGE_FILES) {
    if (!inventory.has(file)) throw new Error(`${file} is missing from the packaged app`);
  }
  for (const extension of [".js", ".css", ".jpg", ".webp", ".otf"]) {
    if (![...inventory].some((file) =>
      file.startsWith("/build/renderer/launcher/assets/") && file.endsWith(extension)
    )) {
      throw new Error(`the packaged Vue launcher has no ${extension} asset`);
    }
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
    if (
      !/^\/(?:build\/(?:main|shared|renderer|preload|native)\/|node_modules\/(?:ws|pngjs)\/|package\.json$)/u.test(
        file,
      )
    ) {
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
      // pnpm exposes direct dependencies as symlinks. Electron Packager
      // dereferences them, so this proof must model the same directory walk.
      const isDirectory = entry.isDirectory()
        || (entry.isSymbolicLink()
          && statSync(path.join(directory, entry.name)).isDirectory());
      if (isDirectory) {
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
