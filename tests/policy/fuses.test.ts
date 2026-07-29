import assert from "node:assert/strict";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { test } from "node:test";
import {
  packageFuseConfig,
  packageFuseExecutable,
} from "../../scripts/package-fuses.ts";

const COMMON_FUSES = new Map<FuseV1Options, boolean>([
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableCookieEncryption, true],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, false],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, false],
  [FuseV1Options.WasmTrapHandlers, true],
]);

for (const platform of ["darwin", "win32", "linux"] as const) {
  test(`${platform} has the complete central fuse policy`, () => {
    const config = packageFuseConfig(platform, platform === "darwin" ? "arm64" : "x64");
    assert.equal(config.version, FuseVersion.V1);
    assert.equal(config.strictlyRequireAllFuses, true);
    for (const [fuse, value] of COMMON_FUSES) {
      assert.equal(config[fuse], value, FuseV1Options[fuse]);
    }
    assert.equal(
      config[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
      platform !== "linux",
    );
    assert.equal(
      config.resetAdHocDarwinSignature,
      platform === "darwin" ? true : undefined,
    );
  });
}

test("the pre-rename executable path is resolved once for every packager layout", () => {
  assert.equal(
    packageFuseExecutable("/tmp/Guild Wars.app/Contents/Resources/app", "darwin"),
    "/tmp/Guild Wars.app/Contents/MacOS/Electron",
  );
  assert.equal(
    packageFuseExecutable("C:\\staging\\resources\\app", "win32"),
    "C:\\staging\\electron.exe",
  );
  assert.equal(
    packageFuseExecutable("/tmp/guild-wars/resources/app", "linux"),
    "/tmp/guild-wars/electron",
  );
  assert.throws(
    () => packageFuseExecutable("/tmp/resources", "freebsd"),
    /unsupported package fuse platform/u,
  );
});
