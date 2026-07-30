// P4.2 — scripts/build.mjs is the single build producer. copy-renderer.mjs runs
// to completion without rustc, copies assets and no code, and emits no kernel;
// the canonical build step list holds exactly one rustc invocation, and orders
// the three producers that write into build/renderer so none erases another.
// The last block covers the other shared directory: the two compiler projects
// both emit build/shared, so the step list has to say which of them wins.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUILD_STEPS } from "../../scripts/build.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function rendererCheckout(): string {
  const root = mkdtempSync(path.join(tmpdir(), "gw-renderer-"));
  roots.push(root);
  const write = (relative: string, contents: string) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  };
  write("src/renderer/index.html", "<!doctype html>\n");
  write("src/renderer/loading.js", "export {};\n");
  write("src/renderer/gw-native.d.ts", "export {};\n");
  write("src/renderer/favicon.ico", "ico");
  write("src/renderer/favicon.png", "png");
  write("src/renderer/harness.css", "css");
  write("src/renderer/loading.css", "css");
  write("src/renderer/fonts/COPYING-QUALITYPE", "licence");
  write("src/renderer/fonts/QTFrizQuad.otf", "font");
  write("src/renderer/images/logo.webp", "webp");
  write("src/renderer/images/hero-poster.jpg", "jpeg");
  write("src/renderer/images/hero-video.webm", "webm");
  write("src/renderer/.DS_Store", "local metadata");
  write("src/renderer/images/local-note.txt", "untracked");
  return root;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

describe("scripts/copy-renderer.mjs only copies assets", () => {
  const root = rendererCheckout();
  // PATH empty: rustc — and every other command — is unreachable.
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "copy-renderer.mjs")],
    { cwd: root, encoding: "utf8", env: { ...process.env, PATH: "" } },
  );

  it("succeeds without a Rust toolchain", () => {
    assert.equal(result.status, 0, result.stderr);
  });

  it("still produces the renderer tree and its static media", () => {
    assert.equal(
      readFileSync(path.join(root, "build/renderer/index.html"), "utf8"),
      "<!doctype html>\n",
    );
    assert.equal(
      readFileSync(path.join(root, "build/renderer/fonts/COPYING-QUALITYPE"), "utf8"),
      "licence",
    );
    assert.equal(
      readFileSync(path.join(root, "build/renderer/images/hero-poster.jpg"), "utf8"),
      "jpeg",
    );
    assert.equal(
      readFileSync(path.join(root, "build/renderer/images/hero-video.webm"), "utf8"),
      "webm",
    );
    // Not the preload: P5.6 moved that to scripts/generate-preload.ts, which
    // splices the canonical channel constants in and is the only producer of
    // build/preload/preload.cjs.
    assert.equal(existsSync(path.join(root, "build/preload")), false);
  });

  it("copies no code, because tsc emits build/renderer's JavaScript", () => {
    const code = filesUnder(path.join(root, "build")).filter(
      (file) => file.endsWith(".js") || file.endsWith(".ts"),
    );
    assert.deepEqual(code, []);
  });

  it("copies only declared package inputs", () => {
    const relative = filesUnder(path.join(root, "build/renderer"))
      .map((file) => path.relative(path.join(root, "build/renderer"), file))
      .sort();
    assert.deepEqual(relative, [
      "favicon.ico",
      "favicon.png",
      "fonts/COPYING-QUALITYPE",
      "fonts/QTFrizQuad.otf",
      "harness.css",
      "images/hero-poster.jpg",
      "images/hero-video.webm",
      "images/logo.webp",
      "index.html",
      "loading.css",
    ]);
  });

  it("emits no WebAssembly", () => {
    const emitted = filesUnder(path.join(root, "build")).filter((file) =>
      file.endsWith(".wasm"),
    );
    assert.deepEqual(emitted, []);
  });
});

/**
 * One step's argument list. `scripts/build.mjs` is JavaScript, so its step list
 * infers as arrays of `string | string[]` and cannot say that position 1 is
 * always the arguments. Asserting the shape rather than assuming it means a
 * step list that stopped being command-and-arguments pairs fails here, instead
 * of every `includes` below quietly answering about a command string.
 */
function stepArgs(step: (typeof BUILD_STEPS)[number]): string[] {
  const args = step[1];
  assert.ok(
    Array.isArray(args),
    `build step ${String(step[0])} carries no argument list`,
  );
  return args;
}

/**
 * Where the one step whose arguments mention `needle` sits in the list.
 * Positions are read from the step list rather than written down here, so the
 * assertions below stay about the ordering that matters and survive a step
 * being inserted anywhere in it.
 */
function stepPosition(needle: string): number {
  const found = BUILD_STEPS.map((step, index) => ({ step, index })).filter(
    ({ step }) => stepArgs(step).includes(needle),
  );
  assert.equal(found.length, 1, `${needle} is not run by exactly one build step`);
  return found[0]!.index;
}

/**
 * Where the main program is compiled. It is the `tsc` step that names no
 * project file, so it is found by what it lacks rather than by an index.
 */
function mainCompilerPosition(): number {
  const found = BUILD_STEPS.map((step, index) => ({ step, index })).filter(
    ({ step }) =>
      stepArgs(step).includes("node_modules/typescript/bin/tsc")
      && !stepArgs(step).includes("tsconfig.renderer.json"),
  );
  assert.equal(found.length, 1, "the main program is not compiled by exactly one step");
  return found[0]!.index;
}

describe("scripts/build.mjs is the one caller of rustc", () => {
  const rustc = BUILD_STEPS.filter(([command]) => command === "rustc");

  it("compiles the kernel exactly once per build", () => {
    assert.equal(rustc.length, 1);
  });

  it("writes it into the renderer output", () => {
    const kernel = rustc[0];
    assert.ok(kernel, "no rustc step to inspect");
    const args = stepArgs(kernel);
    assert.deepEqual(args.slice(-2), [
      "-o",
      "build/renderer/companion-kernel.wasm",
    ]);
    assert.ok(args.includes("src/companion-kernel/lib.rs"));
  });
});

describe("scripts/build.mjs orders the three producers of build/renderer", () => {
  const assets = stepPosition("scripts/copy-renderer.mjs");
  const renderer = stepPosition("tsconfig.renderer.json");
  const kernel = BUILD_STEPS.findIndex(([command]) => command === "rustc");

  it("copies the assets before the renderer is compiled into the same directory", () => {
    // The reverse order is the defect this ordering exists to prevent: the copy
    // step recreated build/renderer, which was harmless only while the renderer
    // compile emitted nothing.
    assert.ok(
      assets < renderer,
      `assets copied at ${assets}, renderer compiled at ${renderer}`,
    );
  });

  it("compiles the kernel into that directory after both of them", () => {
    assert.ok(kernel >= 0, "no rustc step to inspect");
    assert.ok(
      assets < kernel && renderer < kernel,
      `kernel written at ${kernel}, before assets ${assets} or renderer ${renderer}`,
    );
  });
});

/**
 * A project as `tsc` resolves it, read through the compiler rather than
 * `JSON.parse` so the `//` comments in these files stay legal and the paths are
 * the absolute ones the compiler will emit to.
 */
function projectOptions(file: string): ts.CompilerOptions {
  const configPath = path.join(repoRoot, file);
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(error, undefined, `${file} could not be read`);
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    repoRoot,
    undefined,
    configPath,
  );
  assert.deepEqual(parsed.errors, [], `${file} does not parse`);
  return parsed.options;
}

describe("scripts/build.mjs orders the two producers of build/shared", () => {
  const main = projectOptions("tsconfig.json");
  const renderer = projectOptions("tsconfig.renderer.json");

  it("has two compiler projects emitting to the same tree", () => {
    // Not a preference, a fact this ordering depends on: the renderer's
    // type-only imports of src/shared make those sources emittable, so it needs
    // `rootDir: "src"` and lands its copy of build/shared beside the main
    // program's. If a later change removes the overlap — a project reference is
    // the only way — this fails, and the ordering below stops being load-bearing.
    assert.equal(renderer.rootDir, main.rootDir);
    assert.equal(renderer.outDir, main.outDir);
  });

  it("compiles the renderer first, so the sourcemapped emit is the one that survives", () => {
    // Reversed, the renderer's unmapped copy overwrites the main program's and
    // build/shared/*.js loses its sourceMappingURL while the .js.map files stay
    // on disk, referenced by nothing. That failure is silent: the build
    // succeeds, the app runs, and main-process stack traces stop resolving.
    const renderer = stepPosition("tsconfig.renderer.json");
    const mainCompiler = mainCompilerPosition();
    assert.ok(
      renderer < mainCompiler,
      `renderer compiled at ${renderer}, main program at ${mainCompiler}`,
    );
  });
});
