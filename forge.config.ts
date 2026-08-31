import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { macOSBundleVersions } from "./scripts/macos-version.js";
import { ignorePackageFile } from "./scripts/package-ignore.js";
import { resolvePackageMode } from "./scripts/package-mode.js";
import {
  distributionEntitlementsPath,
  distributionSigningOptions,
} from "./scripts/apple-signing.js";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
  distributionMarker,
} from "./src/shared/distribution-channel.js";
import {
  releaseAssetUrl,
  releaseUpdateArtifactName,
} from "./src/shared/project-identity.js";

const packageVersion = (
  JSON.parse(
    readFileSync(new URL("package.json", import.meta.url), "utf8"),
  ) as {
    version: string;
  }
).version;
const macOSVersion = macOSBundleVersions(packageVersion);
const packageMode = resolvePackageMode(process.env.GW_PACKAGE_INTENT);
const channelConfig = DISTRIBUTION_CHANNEL_CONFIG[packageMode.productChannel];
const buildingDarwin = process.platform === "darwin";
const buildingWindows = process.platform === "win32";
const buildingLinux = process.platform === "linux";

function packagedExecutablePath(
  resourcesPath: string,
  platform: string,
): string {
  if (platform === "darwin") {
    return path.resolve(resourcesPath, "../..", "MacOS", "Electron");
  }
  if (platform !== "win32" && platform !== "linux") {
    throw new Error(`unsupported package platform: ${platform}`);
  }
  // packageAfterCopy runs before Electron Packager renames the executable.
  // Its build path is resources/app, so both desktop targets reach the
  // package root and flip the pre-rename Electron binary.
  const executable = platform === "win32" ? "electron.exe" : "electron";
  return path.resolve(
    resourcesPath,
    "../..",
    executable,
  );
}

function requiredSigningEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for signed packaging`);
  return value;
}

const distributionSigning = buildingDarwin && packageMode.kind === "signed"
  ? (() => {
      const { channel } = packageMode;
      const identity = requiredSigningEnvironment("APPLE_SIGNING_IDENTITY");
      const profile = requiredSigningEnvironment("APPLE_PROVISIONING_PROFILE");
      const keychain = process.env.APPLE_KEYCHAIN;
      const entitlements = distributionEntitlementsPath(channel);
      return distributionSigningOptions({
        channel,
        identity,
        ...(keychain ? { keychain } : {}),
        profile,
        entitlements,
      });
    })()
  : undefined;

const releaseNotarization = buildingDarwin && packageMode.intent === "release"
  ? {
      appleApiKey: requiredSigningEnvironment("APPLE_API_KEY_PATH"),
      appleApiKeyId: requiredSigningEnvironment("APPLE_API_KEY_ID"),
      appleApiIssuer: requiredSigningEnvironment("APPLE_API_ISSUER_ID"),
    }
  : undefined;

const windowsSigning = buildingWindows && packageMode.kind === "signed"
  ? {
      certificateFile: requiredSigningEnvironment("WINDOWS_CERTIFICATE_FILE"),
      certificatePassword: requiredSigningEnvironment("WINDOWS_CERTIFICATE_PASSWORD"),
      timestampServer: "https://timestamp.digicert.com",
      description: channelConfig.productName,
      website: "https://gwonmac.com",
    }
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    // Both are executable code that cannot run from inside the archive: a
    // `.node` addon cannot be dlopen'd from it, and a helper cannot be spawned
    // from it.
    asar: {
      unpack: "**/build/native/{host.node,windows-host.node,gw-secret-portal,gw-dat-decode,gw-dat-decode.exe}",
    },
    name: channelConfig.productName,
    executableName: channelConfig.productName,
    appVersion: macOSVersion.appVersion,
    buildVersion: macOSVersion.buildVersion,
    icon: path.resolve(
      buildingWindows
        ? "assets/AppIcon.ico"
        : buildingLinux
          ? "assets/AppIcon.png"
          : "assets/AppIcon.icns",
    ),
    appBundleId: channelConfig.bundleId,
    appCategoryType: "public.app-category.games",
    darwinDarkModeSupport: true,
    appCopyright: "© 2026 gwonmac contributors. Guild Wars © ArenaNet LLC.",
    extraResource: [
      "LICENSE",
      "THIRD-PARTY-NOTICES.md",
      "src/renderer/fonts/COPYING-QUALITYPE",
      "build/renderer/fonts/COPYING-INTER",
      "src/native/gw-dat/vendor/COPYING-GWTOOLBOX",
      "src/native/gw-dat/vendor/COPYING-GUILDWARSMAPBROWSER",
    ],
    ...(distributionSigning ? { osxSign: distributionSigning } : {}),
    ...(releaseNotarization ? { osxNotarize: releaseNotarization } : {}),
    extendInfo: {
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
    },
    // Forge's own packaged output is out/; compiled JS lives in build/.
    // The explicit filter below is the package boundary. Forge's npm pruner
    // cannot walk pnpm's development symlinks once the one production module
    // is admitted, and it would only duplicate that stricter allowlist.
    prune: false,
    // pnpm exposes direct dependencies as symlinks into its private store.
    // A release archive must contain the dependency, not that workspace link.
    derefSymlinks: true,
    ignore: ignorePackageFile,
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ["darwin"]),
    ...(buildingWindows
      ? [
          new MakerSquirrel({
            usePackageJson: false,
            name: channelConfig.windowsPackageId,
            title: channelConfig.productName,
            exe: `${channelConfig.productName}.exe`,
            version: packageVersion,
            authors: "gwonmac contributors",
            owners: "gwonmac contributors",
            copyright: "© 2026 gwonmac contributors. Guild Wars © ArenaNet LLC.",
            description: "Run Guild Wars with native profiles, updates, and optional Tools.",
            setupExe: releaseUpdateArtifactName(packageVersion, "win32-x64"),
            setupIcon: path.resolve("assets/AppIcon.ico"),
            iconUrl: releaseAssetUrl(`v${packageVersion}`, "AppIcon.ico"),
            noMsi: true,
            noDelta: true,
            ...(windowsSigning ? { windowsSign: windowsSigning } : {}),
          }),
        ]
      : []),
    ...(buildingDarwin && packageMode.intent === "release"
      ? [
          new MakerDMG({
            // appdmg also uses this as the mounted volume name and rejects
            // names longer than 27 characters. The release workflow gives the
            // finished asset its versioned immutable filename.
            name: "Guild Wars Reforged",
            icon: path.resolve("assets/AppIcon.icns"),
            // appdmg picks up the Retina variant from the sibling
            // dmg-background@2x.png automatically.
            background: path.resolve("assets/dmg-background.png"),
            iconSize: 100,
            contents: (opts) => [
              { x: 150, y: 360, type: "file", path: opts.appPath },
              { x: 495, y: 360, type: "link", path: "/Applications" },
            ],
            overwrite: true,
            additionalDMGOptions: {
              window: { size: { width: 640, height: 480 } },
              "code-sign": {
                "signing-identity": requiredSigningEnvironment(
                  "APPLE_SIGNING_IDENTITY",
                ),
                identifier: "io.github.mat4m0.gwonmac",
              },
            },
          }),
        ]
      : []),
  ],
  hooks: {
    packageAfterCopy: async (
      _config,
      resourcesPath,
      _version,
      platform,
      arch,
    ) => {
      if (
        (platform === "darwin" || platform === "win32" || platform === "linux")
        && packageMode.kind === "signed"
      ) {
        writeFileSync(
          path.resolve(resourcesPath, "..", "distribution-channel.json"),
          `${JSON.stringify(distributionMarker(packageMode.channel))}\n`,
          { mode: 0o644 },
        );
      }
      await flipFuses(
        packagedExecutablePath(resourcesPath, platform),
        {
          version: FuseVersion.V1,
          // Flipping a fuse edits the binary, which invalidates the signature
          // the prebuilt Electron carries and Apple Silicon insists on having.
          resetAdHocDarwinSignature:
            platform === "darwin" && arch === "arm64",
          // A fuse this list has never heard of fails the package rather than
          // taking whichever default a new Electron shipped it with.
          strictlyRequireAllFuses: true,
          // A binary that runs arbitrary script on request runs it under this
          // app's signature, and so with its Keychain access.
          [FuseV1Options.RunAsNode]: false,
          // Chromium would otherwise create its own Safe Storage Keychain item
          // beside the Data Protection items this app owns.
          [FuseV1Options.EnableCookieEncryption]: false,
          // NODE_OPTIONS is read from the launching environment, before any
          // check this app is in a position to make.
          [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
          // A debugger attached to main reads the ArenaNet credentials and the
          // Steam token straight out of memory.
          [FuseV1Options.EnableNodeCliInspectArguments]: false,
          // Gatekeeper checks the bundle seal at first launch; this checks the
          // archive at every one.
          // Electron embeds ASAR integrity on macOS and Windows. Linux relies
          // on the signed Flatpak repository, sandbox, and ASAR-only loading.
          [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
            platform !== "linux",
          // Otherwise an app/ directory beside the archive is the fallback when
          // app.asar is missing or unreadable, so removing the archive replaces
          // it with code the check above never sees.
          [FuseV1Options.OnlyLoadAppFromAsar]: true,
          // A browser-process-specific snapshot is a second code-bearing file,
          // outside the archive the two fuses above account for.
          [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
          // Everything the renderer loads arrives over gw://app, so file://
          // pages have nothing here that extra privileges would serve.
          [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
          // The game is WebAssembly: without trap handlers every heap access
          // pays for an explicit bounds check.
          [FuseV1Options.WasmTrapHandlers]: true,
        },
      );
    },
    postPackage: async (_config, result) => {
      if (result.platform !== "darwin" || packageMode.kind === "signed") return;
      const { spawnSync } = await import("node:child_process");
      for (const outputPath of result.outputPaths) {
        const appPath = path.join(outputPath, `${channelConfig.productName}.app`);
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
