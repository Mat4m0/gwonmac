import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import { readFileSync } from "node:fs";
import path from "node:path";
import { macOSBundleVersions } from "./scripts/macos-version.js";

const packageVersion = (
  JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
const macOSVersion = macOSBundleVersions(packageVersion);
const officialRelease = process.env.GW_OFFICIAL_RELEASE === "1";
const developerIdIdentity =
  "Developer ID Application: Matthias Amon (9NN976MFZ4)";

function requiredReleaseEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for an official release`);
  return value;
}

const releaseSigning = officialRelease
  ? {
      identity: developerIdIdentity,
      keychain: requiredReleaseEnvironment("APPLE_KEYCHAIN"),
      hardenedRuntime: true,
      timestamp: "http://timestamp.apple.com/ts01",
      optionsForFile: (filePath: string) => ({
        entitlements: filePath.includes("Helper (Plugin).app")
          ? [
              "com.apple.security.cs.allow-jit",
              "com.apple.security.cs.allow-unsigned-executable-memory",
              "com.apple.security.cs.disable-library-validation",
            ]
          : ["com.apple.security.cs.allow-jit"],
        hardenedRuntime: true,
        timestamp: "http://timestamp.apple.com/ts01",
      }),
    }
  : undefined;

const releaseNotarization = officialRelease
  ? {
      appleApiKey: requiredReleaseEnvironment("APPLE_API_KEY_PATH"),
      appleApiKeyId: requiredReleaseEnvironment("APPLE_API_KEY_ID"),
      appleApiIssuer: requiredReleaseEnvironment("APPLE_API_ISSUER_ID"),
    }
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: "**/build/native/keychain.node" },
    name: "Guild Wars Reforged",
    executableName: "Guild Wars Reforged",
    appVersion: macOSVersion.appVersion,
    buildVersion: macOSVersion.buildVersion,
    icon: path.resolve("assets/AppIcon.icns"),
    appBundleId: "com.gwdevhub.guildwars",
    appCategoryType: "public.app-category.games",
    darwinDarkModeSupport: true,
    appCopyright:
      "© 2026 gwonmac contributors. Guild Wars © ArenaNet LLC.",
    extraResource: [
      "LICENSE",
      "THIRD-PARTY-NOTICES.md",
      "src/renderer/fonts/COPYING-QUALITYPE",
      ...(officialRelease ? ["packaging/official-update.json"] : []),
    ],
    ...(releaseSigning ? { osxSign: releaseSigning } : {}),
    ...(releaseNotarization ? { osxNotarize: releaseNotarization } : {}),
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
      if (p === "/build/native" || p === "/build/native/keychain.node") return false;
      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ["darwin"]),
    ...(officialRelease
      ? [
          new MakerDMG({
            // appdmg also uses this as the mounted volume name and rejects
            // names longer than 27 characters. The release workflow gives the
            // finished asset its versioned immutable filename.
            name: "Guild Wars Reforged",
            icon: path.resolve("assets/AppIcon.icns"),
            overwrite: true,
            additionalDMGOptions: {
              "code-sign": {
                "signing-identity": developerIdIdentity,
                identifier: "com.gwdevhub.guildwars",
              },
            },
          }),
        ]
      : []),
  ],
  hooks: {
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
      if (result.platform !== "darwin" || officialRelease) return;
      const { spawnSync } = await import("node:child_process");
      for (const outputPath of result.outputPaths) {
        const appPath = path.join(outputPath, "Guild Wars Reforged.app");
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
