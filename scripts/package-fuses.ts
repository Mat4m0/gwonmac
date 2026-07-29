import {
  FuseV1Options,
  FuseVersion,
  type FuseConfig,
} from "@electron/fuses";
import path from "node:path";
import type { ReleasePlatform } from "../src/shared/release-targets.js";

function releasePlatform(platform: string): ReleasePlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }
  throw new Error(`unsupported package fuse platform: ${platform}`);
}

export function packageFuseExecutable(
  copiedAppPath: string,
  targetPlatform: string,
): string {
  const platform = releasePlatform(targetPlatform);
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const executable = platform === "win32"
    ? "electron.exe"
    : platform === "linux"
      ? "electron"
      : path.join("MacOS", "Electron");
  return platformPath.resolve(copiedAppPath, "../..", executable);
}

export function packageFuseConfig(
  targetPlatform: string,
  arch: string,
): FuseConfig {
  const platform = releasePlatform(targetPlatform);
  return {
    version: FuseVersion.V1,
    ...(platform === "darwin"
      ? { resetAdHocDarwinSignature: arch === "arm64" }
      : {}),
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
      platform !== "linux",
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  };
}
