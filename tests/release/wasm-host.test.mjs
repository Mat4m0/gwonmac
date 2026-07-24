import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the official gamepad imports stay wired without a production WASM hook", async () => {
  const harness = await readFile(path.join(root, "src/renderer/harness.js"), "utf8");
  for (const name of [
    "emscripten_sample_gamepad_data",
    "emscripten_set_gamepadconnected_callback_on_thread",
    "emscripten_set_gamepaddisconnected_callback_on_thread",
    "emscripten_get_num_gamepads",
    "emscripten_get_gamepad_status",
  ]) {
    assert.match(harness, new RegExp(`'${name}'`));
  }
  assert.doesNotMatch(harness, /navigator\.getGamepads\s*=(?!=)/);
  assert.doesNotMatch(harness, /WebAssembly\.(?:Module|Instance)\.prototype/);
});

test("persistent game files are prepared through supported Emscripten startup hooks", async () => {
  const filesystem = await readFile(
    path.join(root, "src/renderer/filesystem.js"),
    "utf8",
  );
  const harness = await readFile(
    path.join(root, "src/renderer/harness.js"),
    "utf8",
  );

  assert.match(filesystem, /module\.preRun/);
  assert.match(filesystem, /syncfs\(true/);
  assert.match(filesystem, /syncfs\(false/);
  assert.match(filesystem, /Templates\/Skills/);
  assert.match(filesystem, /Templates\/Equipment/);
  assert.match(filesystem, /chdir\(MOUNT\)/);
  assert.match(harness, /gwInstallGameFilesystem/);
  assert.doesNotMatch(filesystem, /WebAssembly\.(?:Module|Instance)\.prototype/);
  assert.doesNotMatch(filesystem, /\bfetch\s*\(/);
});

test("saved-file recovery clears only the owned IndexedDB origin", async () => {
  const ipc = await readFile(path.join(root, "src/main/ipc.ts"), "utf8");
  const resetHandler = ipc.slice(
    ipc.indexOf("ipcMain.handle(IPC.gameStorageReset"),
    ipc.indexOf("ipcMain.handle(IPC.diagnosticsGraphics"),
  );

  assert.match(resetHandler, /resetGameInput\(win\)/);
  assert.match(resetHandler, /win\.webContents\.session\.clearStorageData/);
  assert.match(resetHandler, /origin:\s*"gw:\/\/app"/);
  assert.match(resetHandler, /storages:\s*\["indexdb"\]/);
  assert.doesNotMatch(resetHandler, /credentials|cacheClearRequest|recursive/);
});
