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
  assert.match(filesystem, /sync\(true/);
  assert.match(filesystem, /sync\(false/);
  assert.match(filesystem, /SYNC_TIMEOUT_MS/);
  assert.match(filesystem, /Templates\/Skills/);
  assert.match(filesystem, /Templates\/Equipment/);
  assert.match(filesystem, /chdir\(MOUNT\)/);
  assert.match(harness, /gwInstallGameFilesystem/);
  assert.doesNotMatch(filesystem, /WebAssembly\.(?:Module|Instance)\.prototype/);
  assert.doesNotMatch(filesystem, /\bfetch\s*\(/);
});

test("production diagnostics do not patch Web Audio prototypes", async () => {
  const sources = await Promise.all(
    ["harness.js", "diagnostics.js", "index.html"].map((file) =>
      readFile(path.join(root, "src/renderer", file), "utf8")),
  );
  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /gwAudioObserver|AudioBufferSourceNode|GainNode\.prototype/,
  );
});

test("stall attribution markers are fixed-name and Level 2 only", async () => {
  const diagnostics = await readFile(
    path.join(root, "src/renderer/diagnostics.js"),
    "utf8",
  );
  const main = await readFile(
    path.join(root, "src/main/diagnostics.ts"),
    "utf8",
  );

  assert.match(diagnostics, /if \(captureLevel !== 2\) return/);
  assert.match(diagnostics, /traceMark\('gw\.snapshot\.resolve'\)/);
  assert.match(diagnostics, /traceMark\('gw\.frame\.submit'\)/);
  assert.match(diagnostics, /performance\.clearMarks\(name\)/);
  assert.match(main, /"blink\.user_timing"/);
  assert.doesNotMatch(
    diagnostics,
    /traceMark\([^)]*(?:offset|imageId|buffer|data)/,
  );
});

test("template file tracing is explicit, bounded, and attached only at the import boundary", async () => {
  const trace = await readFile(
    path.join(root, "src/renderer/template-filesystem-trace.js"),
    "utf8",
  );
  const harness = await readFile(
    path.join(root, "src/renderer/harness.js"),
    "utf8",
  );
  const window = await readFile(path.join(root, "src/main/window.ts"), "utf8");

  assert.match(window, /process\.env\.GW_TEMPLATE_FS_TRACE === "1"/);
  assert.match(harness, /gwInstallTemplateFilesystemTrace/);
  assert.match(trace, /EVENT_LIMIT = 128/);
  assert.match(trace, /__syscall_openat/);
  assert.match(trace, /__syscall_ftruncate64/);
  assert.match(trace, /fd_read/);
  assert.match(trace, /fd_write/);
  assert.match(trace, /fd_close/);
  assert.doesNotMatch(trace, /gwDiagnostics|gwNative|ipc|fetch\s*\(/i);
  assert.doesNotMatch(trace, /WebAssembly\.(?:Module|Instance)\.prototype/);
});

test("the GL program cache memoizes only shader-completion state, and only once it is true", async () => {
  const cache = await readFile(
    path.join(root, "src/renderer/gl-program-cache.js"),
    "utf8",
  );
  const harness = await readFile(path.join(root, "src/renderer/harness.js"), "utf8");
  const graphics = await readFile(path.join(root, "src/renderer/graphics.js"), "utf8");

  // KHR_parallel_shader_compile completion, and nothing else.
  assert.match(cache, /COMPLETION_STATUS_KHR = 0x91b1/);

  // The complete invalidator set, plus the context-loss edge.
  assert.match(cache, /glCreateProgram/);
  assert.match(cache, /glLinkProgram/);
  assert.match(cache, /glDeleteProgram/);
  assert.match(cache, /'gw:graphics-context-reset'/);
  assert.match(graphics, /'gw:graphics-context-reset'/);
  assert.match(harness, /gwInstallGlProgramCache/);

  // Only a true completion is recorded. Freezing false would make the client
  // poll a program that never finishes.
  assert.match(cache, /=== GL_TRUE\) programs\.set\(program, true\)/);

  const code = cache.replace(/\/\/.*$/gm, "");
  // VALIDATE_STATUS depends on current GL state, so no invalidation set can
  // exist for it; the rest either change outside link, are already memoized by
  // the generated glue, or were measured at one query per program.
  for (const forbidden of [/0x8b82/i, /0x8b83/i, /0x8b84/i, /0x8b85/i, /0x8b80/i, /0x8b86/i, /0x8b89/i, /0x8a36/i]) {
    assert.doesNotMatch(code, forbidden);
  }
  // Reading glGetError clears the flag, and useProgram issues no round trip.
  assert.doesNotMatch(code, /glGetError|glUseProgram|glGetShaderiv/);
  assert.doesNotMatch(cache, /gwNative|ipc|fetch\s*\(/i);
  assert.doesNotMatch(cache, /WebAssembly\.(?:Module|Instance)\.prototype/);
});

test("template saving uses one exact-build derived WASM and a restricted mkdir bridge", async () => {
  const transform = await readFile(
    path.join(root, "src/main/core/template-save-compat.ts"),
    "utf8",
  );
  const bridge = await readFile(
    path.join(root, "src/renderer/template-save-compatibility.js"),
    "utf8",
  );
  const runtime = await readFile(
    path.join(root, "src/main/client-runtime.ts"),
    "utf8",
  );

  assert.match(transform, /callOffset: 0x365a23/);
  assert.match(transform, /1883197770cc74fe48d308f097359a08/);
  assert.match(transform, /WebAssembly\.validate\(output\)/);
  assert.match(runtime, /prepareTemplateSaveClient/);
  assert.match(bridge, /BRIDGE_SENTINEL = 1/);
  assert.match(bridge, /Templates\/Skills/);
  assert.match(bridge, /Templates\/Equipment/);
  assert.match(bridge, /mkdirTree\(directory\)/);
  assert.doesNotMatch(bridge, /gwNative|ipc|fetch\s*\(/i);
});

test("saved-file recovery defers IndexedDB deletion until before renderer startup", async () => {
  const ipc = await readFile(path.join(root, "src/main/ipc.ts"), "utf8");
  const main = await readFile(path.join(root, "src/main/main.ts"), "utf8");
  const resetHandler = ipc.slice(
    ipc.indexOf("ipcMain.handle(IPC.gameStorageReset"),
    ipc.indexOf("ipcMain.handle(IPC.diagnosticsGraphics"),
  );

  assert.match(resetHandler, /resetGameInput\(win\)/);
  assert.match(resetHandler, /paths\.gameStorageClearRequest/);
  assert.doesNotMatch(resetHandler, /clearStorageData/);
  assert.doesNotMatch(resetHandler, /credentials|cacheClearRequest|recursive/);
  assert.match(
    main,
    /applyPendingGameStorageClear[\s\S]*origin:\s*"gw:\/\/app"[\s\S]*storages:\s*\["indexdb"\]/,
  );
  assert.ok(
    main.indexOf("await applyPendingGameStorageClear()") <
      main.indexOf("createMainWindow(buildWindowHost())"),
  );
});

test("a clean WASM process exit closes the host application", async () => {
  const harness = await readFile(
    path.join(root, "src/renderer/harness.js"),
    "utf8",
  );
  assert.match(harness, /onExit\(code\)/);
  assert.match(harness, /code === 0[\s\S]*native\(\)\.app\.requestQuit\(\)/);
});
