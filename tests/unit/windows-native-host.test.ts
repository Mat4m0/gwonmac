/** Contract tests for the Windows Credential Manager binding owned by main. */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { parseProfileId } from "../../src/shared/multiple-accounts.js";
import { multiSecretSlot } from "../../src/main/core/native-keychain.js";
import {
  WindowsCredentialKeychain,
  windowsExecutableTrusted,
  windowsNativeHostPath,
} from "../../src/main/windows-native-host.js";

describe("Windows native host boundary", () => {
  it("resolves the unpacked addon in development and a package", () => {
    assert.equal(
      windowsNativeHostPath({
        packaged: false,
        appPath: "C:\\checkout",
        resourcesPath: "C:\\ignored",
      }),
      path.win32.join("C:\\checkout", "build/native/windows-host.node"),
    );
    assert.equal(
      windowsNativeHostPath({
        packaged: true,
        appPath: "C:\\ignored",
        resourcesPath: "C:\\App\\resources",
      }),
      path.win32.join(
        "C:\\App\\resources",
        "app.asar.unpacked/build/native/windows-host.node",
      ),
    );
  });

  it("binds one distribution identity to every closed slot", async () => {
    const calls: unknown[][] = [];
    const host = {
      localAppData: () => "unused",
      currentExecutableTrusted: () => true,
      load: async (...args: unknown[]) => {
        calls.push(["load", ...args]);
        return Buffer.from("saved");
      },
      save: async (...args: unknown[]) => {
        calls.push(["save", ...args]);
      },
      clear: async (...args: unknown[]) => {
        calls.push(["clear", ...args]);
      },
    };
    const keychain = new WindowsCredentialKeychain(host, "preview");
    const profile = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
    const slot = multiSecretSlot(profile, "arenaNetCredentials");

    assert.equal((await keychain.load(slot))?.toString(), "saved");
    await keychain.save(slot, Buffer.from("replacement"));
    await keychain.clear(slot);

    assert.deepEqual(calls, [
      ["load", "io.github.mat4m0.gwonmac.preview", slot],
      ["save", "io.github.mat4m0.gwonmac.preview", slot, Buffer.from("replacement")],
      ["clear", "io.github.mat4m0.gwonmac.preview", slot],
    ]);
    assert.equal(windowsExecutableTrusted(host), true);
  });
});
