/** Static authority checks for the Windows known-folder and secret boundary. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const native = readFileSync(
  path.join(root, "src/native/windows-host/host.cpp"),
  "utf8",
);
const main = readFileSync(path.join(root, "src/main/main.ts"), "utf8");

test("Windows storage starts from the native LocalAppData known folder", () => {
  assert.match(native, /SHGetKnownFolderPath\(FOLDERID_LocalAppData/u);
  assert.doesNotMatch(native, /getenv|LOCALAPPDATA|APPDATA/u);
  assert.match(main, /windowsStorageRoots\(windowsNativeHost\.localAppData\(\)\)/u);
  assert.match(main, /explicitUserData\s*\? colocatedStorageRoots/u);
});

test("Windows starts the local Crashpad handler before renderer creation", () => {
  assert.match(main, /process\.platform === "win32"[\s\S]*crashReporter\.start\(\{ uploadToServer: false \}\)/u);
  assert.doesNotMatch(main, /crashReporter\.start\(\{[^}]*submitURL/u);
});

test("Credential Manager owns only closed application and profile slots", () => {
  for (const value of [
    "io.github.mat4m0.gwonmac",
    "io.github.mat4m0.gwonmac.preview",
    "io.github.mat4m0.gwonmac.dev",
    "arenaNetCredentials",
    "steamSession",
  ]) {
    assert.ok(native.includes(`"${value}"`), `${value} is not native-owned`);
  }
  assert.match(native, /CredReadW/u);
  assert.match(native, /CredWriteW/u);
  assert.match(native, /CredDeleteW/u);
  assert.match(native, /CRED_TYPE_GENERIC/u);
  assert.match(native, /CRED_PERSIST_LOCAL_MACHINE/u);
  assert.match(native, /CRED_MAX_CREDENTIAL_BLOB_SIZE/u);
  assert.match(native, /SecureZeroMemory/u);
  assert.match(native, /napi_create_async_work/u);
  assert.match(native, /napi_queue_async_work/u);
  assert.doesNotMatch(native, /system\s*\(|popen\s*\(|CreateProcess/u);
  assert.doesNotMatch(main, /safeStorage|encryptString|decryptString/u);
});
