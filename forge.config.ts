import { MakerZIP } from "@electron-forge/maker-zip";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { macOSBundleVersions } from "./scripts/macos-version.mjs";

// scripts/build.mjs is the only producer of build/. This hook used to run
// scripts/copy-renderer.mjs a second time, which compiled the Toolbox kernel
// twice per clean `pnpm package`; it now only asserts that the producer ran.
const PACKAGE_INPUTS = [
  "build/main/main.js",
  "build/shared/release.js",
  "build/preload/preload.cjs",
  "build/renderer/index.html",
  "build/renderer/toolbox-kernel.wasm",
];

/** The first source under `dir` modified after `mtimeMs`, or undefined. */
function sourceNewerThan(dir: string, mtimeMs: number): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    const found = entry.isDirectory()
      ? sourceNewerThan(child, mtimeMs)
      : statSync(child).mtimeMs > mtimeMs
        ? child
        : undefined;
    if (found) return found;
  }
  return undefined;
}

/**
 * Throws unless `pnpm build` has run over the current sources. Packaging a
 * missing or stale build/ otherwise produces a plausible-looking broken .app.
 */
export function assertBuildIsFresh(root: string = process.cwd()): void {
  let builtAt = Infinity;
  for (const input of PACKAGE_INPUTS) {
    const stat = statSync(path.join(root, input), { throwIfNoEntry: false });
    if (!stat) throw new Error(`${input} is missing; run \`pnpm build\` first`);
    builtAt = Math.min(builtAt, stat.mtimeMs);
  }
  const stale = sourceNewerThan(path.join(root, "src"), builtAt);
  if (stale) {
    throw new Error(
      `${path.relative(root, stale)} is newer than build/; run \`pnpm build\` first`,
    );
  }
}

const packageVersion = (
  JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
const macOSVersion = macOSBundleVersions(packageVersion);

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "Guild Wars",
    executableName: "Guild Wars",
    appVersion: macOSVersion.appVersion,
    buildVersion: macOSVersion.buildVersion,
    icon: path.resolve("assets/AppIcon.icns"),
    appBundleId: "com.gwdevhub.guildwars",
    appCategoryType: "public.app-category.games",
    darwinDarkModeSupport: true,
    appCopyright:
      "© 2026 gwonmac contributors. Guild Wars © 2005–2026 ArenaNet, Inc.",
    extraResource: [
      "LICENSE",
      "THIRD-PARTY-NOTICES.md",
      "src/renderer/fonts/COPYING-QUALITYPE",
    ],
    extendInfo: {
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
    },
    // Forge's own packaged output is out/; compiled JS lives in build/.
    ignore: (file) => {
      if (!file || file === "/") return false;
      const p = file.startsWith("/") ? file : `/${file}`;
      if (p === "/package.json") return false;
      if (p === "/build" || p === "/build/main" || p === "/build/shared") return false;
      if (p.startsWith("/build/main/") || p.startsWith("/build/shared/")) {
        return p.endsWith(".map") || p.endsWith(".d.ts") || p.endsWith(".d.ts.map");
      }
      if (p === "/build/renderer") return false;
      if (p.startsWith("/build/renderer/")) return p.endsWith(".d.ts");
      if (p === "/build/preload" || p === "/build/preload/preload.cjs") return false;
      return true;
    },
  },
  rebuildConfig: {},
  // Distribution is the zipped .app; no DMG.
  makers: [new MakerZIP({}, ["darwin"])],
  hooks: {
    generateAssets: async () => {
      assertBuildIsFresh();
    },
    packageAfterCopy: async (_config, resourcesPath, _version, platform, arch) => {
      if (platform !== "darwin") return;
      await flipFuses(
        path.resolve(resourcesPath, "../..", "MacOS", "Electron"),
        {
          version: FuseVersion.V1,
          resetAdHocDarwinSignature: arch === "arm64",
          strictlyRequireAllFuses: true,
          [FuseV1Options.RunAsNode]: false,
          [FuseV1Options.EnableCookieEncryption]: true,
          [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
          [FuseV1Options.EnableNodeCliInspectArguments]: false,
          [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
          [FuseV1Options.OnlyLoadAppFromAsar]: true,
          [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
          [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
          [FuseV1Options.WasmTrapHandlers]: true,
        },
      );
    },
    postPackage: async (_config, result) => {
      if (result.platform !== "darwin") return;
      const { spawnSync } = await import("node:child_process");
      for (const outputPath of result.outputPaths) {
        const appPath = path.join(outputPath, "Guild Wars.app");
        const signed = spawnSync(
          "codesign",
          ["--force", "--deep", "--sign", "-", appPath],
          { stdio: "inherit" },
        );
        if (signed.status !== 0) throw new Error("ad-hoc app signing failed");
      }
    },
  },
};

export default config;
