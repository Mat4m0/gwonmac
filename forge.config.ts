import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import { readFileSync } from "node:fs";
import path from "node:path";
import releaseTargetsJson from "./release-targets.json" with { type: "json" };
import { macOSBundleVersions } from "./scripts/macos-version.js";
import { platformPackageVersions } from "./scripts/platform-version.js";
import {
  parseReleaseTargets,
  releaseTargetById,
  releaseTargetFilename,
} from "./src/shared/release-targets.js";

const packageVersion = (
  JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
const macOSVersion = macOSBundleVersions(packageVersion);
const platformVersions = platformPackageVersions(packageVersion);
const releaseTargets = parseReleaseTargets(releaseTargetsJson);
const macOSReleaseTarget = releaseTargetById(releaseTargets, "macos-arm64");
const windowsReleaseTarget = releaseTargetById(releaseTargets, "windows-x64");
const linuxReleaseTarget = releaseTargetById(releaseTargets, "linux-x64");
const packageDescription =
  "A sandboxed desktop host for ArenaNet's official Guild Wars WebAssembly client";
const packageIcon = path.resolve(
  process.platform === "win32"
    ? "assets/AppIcon.ico"
    : process.platform === "linux"
      ? "assets/AppIcon-linux.png"
      : "assets/AppIcon.icns",
);

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    derefSymlinks: true,
    name: "Guild Wars",
    executableName: "Guild Wars",
    appVersion: macOSVersion.appVersion,
    buildVersion: macOSVersion.buildVersion,
    icon: packageIcon,
    appBundleId: "com.gwdevhub.guildwars",
    appCategoryType: "public.app-category.games",
    darwinDarkModeSupport: true,
    appCopyright:
      "© 2026 gwonmac contributors. Guild Wars © 2005–2026 ArenaNet, Inc.",
    extraResource: [
      "LICENSE",
      "THIRD-PARTY-NOTICES.md",
      "src/renderer/fonts/COPYING-QUALITYPE",
      ...(process.platform === "linux" ? ["assets/AppIcon-linux.png"] : []),
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
      if (
        p === "/node_modules" ||
        p === "/node_modules/@zip.js" ||
        p === "/node_modules/@zip.js/zip.js"
      ) {
        return false;
      }
      if (p.startsWith("/node_modules/@zip.js/zip.js/")) {
        return !(
          p === "/node_modules/@zip.js/zip.js/LICENSE" ||
          p === "/node_modules/@zip.js/zip.js/package.json" ||
          p === "/node_modules/@zip.js/zip.js/index.js" ||
          p === "/node_modules/@zip.js/zip.js/lib" ||
          p.startsWith("/node_modules/@zip.js/zip.js/lib/")
        );
      }
      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    // ZIP remains the sole macOS distribution format.
    new MakerZIP({}, [macOSReleaseTarget.platform]),
    new MakerSquirrel(
      {
        name: "GuildWars",
        title: "Guild Wars",
        authors: "gwonmac contributors",
        description: packageDescription,
        exe: "Guild Wars.exe",
        version: platformVersions.squirrel,
        setupExe: releaseTargetFilename(windowsReleaseTarget, packageVersion),
        setupIcon: path.resolve("assets/AppIcon.ico"),
        noMsi: true,
      },
      [windowsReleaseTarget.platform],
    ),
    new MakerDeb(
      {
        options: {
          name: "guild-wars",
          productName: "Guild Wars",
          genericName: "Online role-playing game",
          description: packageDescription,
          productDescription: packageDescription,
          version: platformVersions.debian,
          section: "games",
          priority: "optional",
          maintainer: "gwonmac contributors",
          homepage: "https://github.com/Mat4m0/gwonmac",
          bin: "Guild Wars",
          icon: path.resolve("assets/AppIcon-linux.png"),
          categories: ["Game"],
        },
      },
      [linuxReleaseTarget.platform],
    ),
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
