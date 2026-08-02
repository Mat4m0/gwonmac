import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { macOSBundleVersions } from "./scripts/macos-version.js";
import { resolvePackageMode } from "./scripts/package-mode.js";
import {
  distributionEntitlementsPath,
  distributionSigningOptions,
} from "./scripts/apple-signing.js";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
  distributionMarker,
} from "./src/shared/distribution-channel.js";

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

function requiredSigningEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for signed packaging`);
  return value;
}

const distributionSigning = packageMode.kind === "signed"
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

const releaseNotarization = packageMode.intent === "release"
  ? {
      appleApiKey: requiredSigningEnvironment("APPLE_API_KEY_PATH"),
      appleApiKeyId: requiredSigningEnvironment("APPLE_API_KEY_ID"),
      appleApiIssuer: requiredSigningEnvironment("APPLE_API_ISSUER_ID"),
    }
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: "**/build/native/keychain.node" },
    name: channelConfig.productName,
    executableName: channelConfig.productName,
    appVersion: macOSVersion.appVersion,
    buildVersion: macOSVersion.buildVersion,
    icon: path.resolve("assets/AppIcon.icns"),
    appBundleId: channelConfig.bundleId,
    appCategoryType: "public.app-category.games",
    darwinDarkModeSupport: true,
    appCopyright: "© 2026 gwonmac contributors. Guild Wars © ArenaNet LLC.",
    extraResource: [
      "LICENSE",
      "THIRD-PARTY-NOTICES.md",
      "src/renderer/fonts/COPYING-QUALITYPE",
      // The certificate feed's pinned key. It ships inside the bundle so the
      // code signature seals it: the one decision about whom a fetched feed
      // may come from must not be editable without breaking the signature.
      "certificates/public-key.txt",
    ],
    ...(distributionSigning ? { osxSign: distributionSigning } : {}),
    ...(releaseNotarization ? { osxNotarize: releaseNotarization } : {}),
    extendInfo: {
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
    },
    // Forge's own packaged output is out/; compiled JS lives in build/.
    ignore: (file) => {
      if (!file || file === "/") return false;
      const p = file.startsWith("/") ? file : `/${file}`;
      if (p === "/package.json") return false;
      if (p === "/build" || p === "/build/main" || p === "/build/shared")
        return false;
      if (p.startsWith("/build/main/") || p.startsWith("/build/shared/")) {
        return (
          p.endsWith(".map") || p.endsWith(".d.ts") || p.endsWith(".d.ts.map")
        );
      }
      if (p === "/build/renderer") return false;
      if (p.startsWith("/build/renderer/")) return p.endsWith(".d.ts");
      if (p === "/build/preload" || p === "/build/preload/preload.cjs")
        return false;
      if (p === "/build/native" || p === "/build/native/keychain.node")
        return false;
      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ["darwin"]),
    ...(packageMode.intent === "release"
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
      if (platform !== "darwin") return;
      if (packageMode.kind === "signed") {
        writeFileSync(
          path.resolve(resourcesPath, "..", "distribution-channel.json"),
          `${JSON.stringify(distributionMarker(packageMode.channel))}\n`,
          { mode: 0o644 },
        );
      }
      await flipFuses(
        path.resolve(resourcesPath, "../..", "MacOS", "Electron"),
        {
          version: FuseVersion.V1,
          // Flipping a fuse edits the binary, which invalidates the signature
          // the prebuilt Electron carries and Apple Silicon insists on having.
          resetAdHocDarwinSignature: arch === "arm64",
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
          [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
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
