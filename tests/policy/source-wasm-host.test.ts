// Reads repository text, and says so in its filename. It was
// tests/release/wasm-host.test.mjs, where the directory implied it executed the
// WASM host; it never has. Every assertion below reads a renderer or main
// source file, it needs no build, and most of them are negative — the client's
// own glue must not be patched, the bridge must not fetch, a trace must touch
// no capability but its own opt-in. Absence has no executable form, which is
// what makes these worth keeping and what makes the old directory a lie.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The scripts index.html loads with a plain `<script src>` tag — no
 * `type="module"`. Read off the page rather than listed here, because the
 * invariant belongs to whatever the page happens to load that way, and a
 * second list would drift from it.
 */
function classicScriptSources(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>/giu)]
    .map((tag) => tag[1] ?? "")
    .filter((attributes) => !/\btype\s*=\s*["']module["']/iu.test(attributes))
    .map((attributes) => /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1])
    .filter((src) => src !== undefined);
}

test("the scripts index.html loads with a plain tag emit no ES module", async () => {
  const html = await readFile(path.join(root, "src/renderer/index.html"), "utf8");
  const scripts = classicScriptSources(html);
  assert.ok(scripts.length > 0, "index.html loads no classic script");

  for (const src of scripts) {
    // The page names the emitted `.js`; the source beside it is the `.ts`.
    const file = path.join(root, "src/renderer", src.replace(/\.js$/u, ".ts"));
    const parsed = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.ES2022,
      false,
      ts.ScriptKind.TS,
    );
    // A file with one top-level `import` or `export` is an ES module, and `tsc`
    // then terminates the emit with `export {}`. Chromium refuses that from a
    // tag with no `type="module"`, so the script never runs — and `harness.ts`'s
    // `var Module` stops being the global binding the generated glue redeclares
    // (AGENTS.md, "Load-bearing constraints"). Nothing else sees it: `tsc` and
    // ESLint both pass, and the Electron suite fails four assertions that name
    // widgets rather than this. `import type` counts, which is why the six files
    // annotate contracts with `import('./x.js').T` instead.
    assert.equal(
      ts.isExternalModule(parsed),
      false,
      `${src} has a top-level import or export, so it is no longer a classic script`,
    );
  }
});

test("the official gamepad imports stay wired without a production WASM hook", async () => {
  const harness = await readFile(path.join(root, "src/renderer/harness.ts"), "utf8");
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
    path.join(root, "src/renderer/filesystem.ts"),
    "utf8",
  );
  const harness = await readFile(
    path.join(root, "src/renderer/harness.ts"),
    "utf8",
  );

  assert.match(filesystem, /module\.preRun/);
  assert.match(filesystem, /sync\(true/);
  assert.match(filesystem, /sync\(false/);
  assert.match(filesystem, /SYNC_TIMEOUT_MS/);
  assert.match(filesystem, /Templates\/Skills/);
  assert.match(filesystem, /Templates\/Equipment/);
  assert.match(filesystem, /chdir\(MOUNT\)/);
  // P6.5 made the installer an export instead of a window global, so the
  // harness has to name the module as well as the call.
  assert.match(harness, /import\('\.\/filesystem\.js'\)/);
  assert.match(harness, /host\.installGameFilesystem\(/);
  assert.doesNotMatch(filesystem, /WebAssembly\.(?:Module|Instance)\.prototype/);
  assert.doesNotMatch(filesystem, /\bfetch\s*\(/);
});

test("production diagnostics do not patch Web Audio prototypes", async () => {
  const sources = await Promise.all(
    ["harness.ts", "diagnostics.ts", "index.html"].map((file) =>
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
    path.join(root, "src/renderer/diagnostics.ts"),
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
    path.join(root, "src/renderer/template-filesystem-trace.ts"),
    "utf8",
  );
  const harness = await readFile(
    path.join(root, "src/renderer/harness.ts"),
    "utf8",
  );
  const window = await readFile(path.join(root, "src/main/window.ts"), "utf8");

  assert.match(window, /process\.env\.GW_TEMPLATE_FS_TRACE === "1"/);
  assert.match(harness, /import\('\.\/template-filesystem-trace\.js'\)/);
  assert.match(harness, /host\.installTemplateFilesystemTrace\(/);
  assert.match(trace, /EVENT_LIMIT = 128/);
  assert.match(trace, /__syscall_openat/);
  assert.match(trace, /__syscall_ftruncate64/);
  assert.match(trace, /fd_read/);
  assert.match(trace, /fd_write/);
  assert.match(trace, /fd_close/);
  assert.doesNotMatch(trace, /gwDiagnostics|ipc|fetch\s*\(/i);
  // The only capability it may touch is its own opt-in, which since P5.2 is a
  // field of the renderer init payload rather than a renderer URL parameter.
  assert.deepEqual(trace.match(/gwNative[.\w]*/gu), [
    "gwNative.init.templateFsTrace",
  ]);
  assert.doesNotMatch(trace, /WebAssembly\.(?:Module|Instance)\.prototype/);
});

test("the GL program cache memoizes only shader-completion state, and only once it is true", async () => {
  const cache = await readFile(
    path.join(root, "src/renderer/gl-program-cache.ts"),
    "utf8",
  );
  const harness = await readFile(path.join(root, "src/renderer/harness.ts"), "utf8");
  const graphics = await readFile(path.join(root, "src/renderer/graphics.ts"), "utf8");

  // KHR_parallel_shader_compile completion, and nothing else.
  assert.match(cache, /COMPLETION_STATUS_KHR = 0x91b1/);

  // The complete invalidator set, plus the context-loss edge.
  assert.match(cache, /glCreateProgram/);
  assert.match(cache, /glLinkProgram/);
  assert.match(cache, /glDeleteProgram/);
  assert.match(cache, /'gw:graphics-context-reset'/);
  assert.match(graphics, /'gw:graphics-context-reset'/);
  assert.match(harness, /import\('\.\/gl-program-cache\.js'\)/);
  assert.match(harness, /host\.installGlProgramCache\(/);

  // Deleted with P5.17: an assertion that the file contained the exact line
  // `=== GL_TRUE) programs.set(program, true)`. Only a true completion may be
  // memoized — freezing false makes the client poll a program that never
  // finishes — and that is executed in tests/unit/gl-program-cache.test.ts,
  // which drives a fake GL context through both answers. Matching the line
  // proved the characters, and broke on reformatting.

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
    path.join(root, "src/renderer/template-save-compatibility.ts"),
    "utf8",
  );
  const runtime = await readFile(
    path.join(root, "src/main/client-runtime.ts"),
    "utf8",
  );

  assert.match(transform, /b0319704f3072d6948a66026a35af5eb/);
  assert.match(transform, /68c6e09cec0f6992058a44a5617ca9ea/);
  assert.match(transform, /WebAssembly\.validate\(output\)/);
  assert.match(runtime, /prepareClientModule/);
  // Deleted with P5.17: three assertions that the strings "unsupported input",
  // "is not the expected stub" and "call site signature mismatch" appeared in
  // the transform. All three are *triggered* in
  // tests/unit/template-save-compat.test.ts, which feeds the transform a wrong
  // build, a rewritten stub and a changed call site and matches the error it
  // throws. Asserting them here proved only that the words were still spelled
  // the same way, in a file the same test already covers.

  // P5.7 deleted the hand-mirrored dirfd markers, and with them the assertion
  // that used to hold the two copies together. Both halves now read
  // WASM_BRIDGE_MARKERS: the transform imports it, the renderer receives it
  // through the generated preload, and neither declares a number of its own.
  assert.doesNotMatch(transform, /-70_?00\d/u);
  assert.doesNotMatch(bridge, /-70_?00\d/u);

  assert.match(bridge, /__syscall_newfstatat/);
  assert.match(bridge, /mkdirTree\(directory\)/);
  // The listing block is freed by the client, so it must be its own allocation.
  assert.match(bridge, /exports\(\)\?\.malloc/);
  assert.doesNotMatch(bridge, /ipc|fetch\s*\(/i);
  assert.deepEqual(bridge.match(/gwNative[.\w]*/gu), [
    "gwNative.wasmBridgeMarkers",
    "gwNative.init.templateFsTrace",
  ]);
});

test("a new client build can be re-certified without hand-derivation", async () => {
  const recert = await readFile(
    path.join(root, "src/tools/template-save-recert.ts"),
    "utf8",
  );
  const cli = await readFile(
    path.join(root, "src/tools/template-save-recertify.ts"),
    "utf8",
  );
  // Only the field this assertion reads; `JSON.parse` returns `any`, which
  // would erase the checking of the comparison below.
  const manifest: { scripts?: Record<string, string> } = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );

  // The regression mode recertify.md makes step 0: prove the tool reproduces
  // today's certified entry before pointing it at a new build.
  assert.match(cli, /--expect-certified/);
  assert.match(recert, /compareToCertified/);
  assert.equal(
    manifest.scripts?.["template:recertify"],
    "pnpm build && node build/tools/template-save-recertify.js",
  );

  // Derivation must stay shape-based. A remembered index would defeat the point.
  assert.match(recert, /caller-set intersection|callers\(/);
  assert.doesNotMatch(recert, /localFunction: \d+/);
  // Deleted with P5.17: two assertions that the recertifier's "expected exactly
  // one" and "expected exactly 2 template scans" messages appeared in its
  // source. tests/unit/template-save-recert.test.ts builds ambiguous modules and
  // matches the errors it actually throws, which is the claim — every ambiguity
  // is a finding, never a best guess.
});

test("the WASM section codec has exactly one home", async () => {
  const shared = await readFile(
    path.join(root, "src/main/core/wasm-binary.ts"),
    "utf8",
  );
  assert.match(shared, /export function splitSections/);
  assert.match(shared, /export function parseCode/);
  // `Buffer.prototype.slice` aliases, so a transform that sliced its input
  // would rewrite the caller's bytes. Every slice here must copy.
  assert.match(shared, /function copyRange/);
  assert.doesNotMatch(shared, /bodies\.push\(bytes\.slice/);

  // The recertifier is developer tooling and lives in src/tools/, so it names
  // the same codec one directory further away (P4.4).
  const sharers: ReadonlyArray<readonly [file: string, specifier: string]> = [
    ["src/main/core/enhancement-transform.ts", './wasm-binary.js'],
    ["src/main/core/template-save-compat.ts", './wasm-binary.js'],
    ["src/tools/template-save-recert.ts", '../main/core/wasm-binary.js'],
  ];
  for (const [file, specifier] of sharers) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.ok(
      source.includes(`from "${specifier}"`),
      `${file} must share the codec`,
    );
    for (const primitive of [
      "splitSections",
      "parseCode",
      "encodeCode",
      "readUleb",
    ]) {
      assert.doesNotMatch(
        source,
        new RegExp(`^function ${primitive}\\(`, "m"),
        `${file} redefines ${primitive}`,
      );
    }
  }
});

test("saved-file recovery defers IndexedDB deletion until before renderer startup", async () => {
  const ipc = await readFile(path.join(root, "src/main/ipc.ts"), "utf8");
  const main = await readFile(path.join(root, "src/main/main.ts"), "utf8");
  // P5.9 moved the handlers into a registry keyed by channel name.
  const resetHandler = ipc.slice(
    ipc.indexOf("gameStorageReset: channel("),
    ipc.indexOf("diagnosticsGraphics: channel("),
  );
  assert.ok(resetHandler.length > 0, "the gameStorageReset handler was not found");

  assert.match(resetHandler, /resetGameInput\(win\)/);
  assert.match(resetHandler, /paths\.gameStorageClearRequest/);
  assert.doesNotMatch(resetHandler, /clearStorageData/);
  assert.doesNotMatch(resetHandler, /credentials|cacheClearRequest|recursive/);
  assert.match(
    main,
    /applyPendingGameStorageClear[\s\S]*origin:\s*"gw:\/\/app"[\s\S]*storages:\s*\["indexdb"\]/,
  );
  const firstWindow = main.indexOf("const win = createMainWindow(");
  assert.notEqual(firstWindow, -1, "no window is created from a window host");
  assert.ok(
    main.indexOf("await applyPendingGameStorageClear()") < firstWindow,
    "the pending IndexedDB clear must run before the first window exists",
  );
});

test("the served module, not requested settings, decides whether Enhancement imports", async () => {
  const harness = await readFile(
    path.join(root, "src/renderer/harness.ts"),
    "utf8",
  );
  const initialized = harness.slice(
    harness.indexOf("onRuntimeInitialized()"),
    harness.indexOf("onAbort(reason)"),
  );
  assert.ok(initialized.length > 0, "runtime initialization was not found");
  assert.match(
    initialized,
    /Object\.values\(init\.enhancementSelection\)\.some\(Boolean\)/u,
  );
  assert.match(
    initialized,
    /WebAssembly\.Module\.customSections\(\s*gameWasmModule,\s*'enhancement_manifest',\s*\)\.length === 1/u,
  );
  assert.match(
    initialized,
    /installEnhancements\(\s*enhancementInstance,\s*enhancementModule,\s*init\.enhancementSelection,\s*init\.enhancementAutomation,/u,
  );
  assert.ok(
    initialized.indexOf("customSections") < initialized.indexOf("import('./enhancements.js')"),
    "Enhancement was imported before the served module proved its manifest",
  );
  assert.doesNotMatch(initialized, /init\.nativeCursor/u);
});

test("a clean WASM process exit closes the host application", async () => {
  const harness = await readFile(
    path.join(root, "src/renderer/harness.ts"),
    "utf8",
  );
  assert.match(harness, /onExit\(code\)/);
  assert.match(harness, /code === 0[\s\S]*native\(\)\.app\.requestQuit\(\)/);
});
