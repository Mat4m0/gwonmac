import { MakerZIP } from "@electron-forge/maker-zip";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import path from "node:path";

const signing = process.env.APPLE_IDENTITY
  ? {
      osxSign: {
        identity: process.env.APPLE_IDENTITY,
        hardenedRuntime: true,
      },
    }
  : {};
const notarization =
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
    ? {
        osxNotarize: {
          tool: "notarytool" as const,
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        },
      }
    : {};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "Guild Wars",
    executableName: "Guild Wars",
    icon: path.resolve("assets/AppIcon.icns"),
    appBundleId: "com.gwdevhub.guildwars",
    appCategoryType: "public.app-category.games",
    darwinDarkModeSupport: true,
    appCopyright: "© 2005–2026 ArenaNet, Inc. Independent fan project.",
    extraResource: ["src/renderer/fonts/COPYING-QUALITYPE"],
    extendInfo: {
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
    },
    ...signing,
    ...notarization,
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
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync(process.execPath, ["scripts/copy-renderer.mjs"], {
        stdio: "inherit",
      });
      if (r.status !== 0) throw new Error("copy-renderer failed");
    },
    packageAfterCopy: async (_config, resourcesPath, _version, platform, arch) => {
      if (platform !== "darwin") return;
      await flipFuses(
        path.resolve(resourcesPath, "../..", "MacOS", "Electron"),
        {
          version: FuseVersion.V1,
          resetAdHocDarwinSignature: !process.env.APPLE_IDENTITY && arch === "arm64",
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
      if (result.platform !== "darwin" || process.env.APPLE_IDENTITY) return;
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
