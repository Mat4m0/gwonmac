// scripts/build.mjs is the single build producer. copy-renderer.mjs runs
// to completion without rustc, copies assets and no code, and emits no kernel;
// the canonical build step list holds exactly one rustc invocation, and orders
// the producers that write into build/renderer so none erases another.
// Rollup is the only renderer runtime producer; the main compiler is the only
// producer of build/shared.
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
import {
  BUILD_STEPS,
  companionKernelRustcArgs,
} from "../../scripts/build.mjs";

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
  write("src/renderer/settings.css", "css");
  write("src/renderer/fonts/COPYING-QUALITYPE", "licence");
  write("src/renderer/fonts/QTFrizQuad.otf", "font");
  write("src/renderer/images/logo.webp", "webp");
  write("src/renderer/images/playstation-controller-prompts.png", "controller-png");
  write("apps/website/public/bg-reforged.jpg", "landscape");
  write("src/renderer/.DS_Store", "local metadata");
  write("src/renderer/images/local-note.txt", "untracked");
  // The design system is a package input that does not live under src/renderer:
  // the Tools application reads it too, and apps/** may only reach src/shared.
  write("src/shared/ui/tokens.css", "tokens");
  write("src/shared/ui/components.css", "components");
  write("node_modules/@fontsource-variable/inter/wght.css", "inter-css");
  write("node_modules/@fontsource-variable/inter/LICENSE", "inter-licence");
  for (const subset of [
    "cyrillic-ext",
    "cyrillic",
    "greek-ext",
    "greek",
    "latin-ext",
    "latin",
    "vietnamese",
  ]) {
    write(
      `node_modules/@fontsource-variable/inter/files/inter-${subset}-wght-normal.woff2`,
      `inter-${subset}`,
    );
  }
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
      readFileSync(
        path.join(root, "build/renderer/images/playstation-controller-prompts.png"),
        "utf8",
      ),
      "controller-png",
    );
    assert.equal(
      readFileSync(path.join(root, "build/renderer/images/bg-reforged.jpg"), "utf8"),
      "landscape",
    );
    // Not the preload: scripts/generate-preload.ts owns that output, splices
    // the canonical channel constants in and is the only producer of
    // the generated preload artifacts.
    assert.equal(existsSync(path.join(root, "build/preload")), false);
  });

  it("copies no code, because Rollup emits build/renderer's JavaScript", () => {
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
      "fonts/COPYING-INTER",
      "fonts/COPYING-QUALITYPE",
      "fonts/QTFrizQuad.otf",
      "fonts/files/inter-cyrillic-ext-wght-normal.woff2",
      "fonts/files/inter-cyrillic-wght-normal.woff2",
      "fonts/files/inter-greek-ext-wght-normal.woff2",
      "fonts/files/inter-greek-wght-normal.woff2",
      "fonts/files/inter-latin-ext-wght-normal.woff2",
      "fonts/files/inter-latin-wght-normal.woff2",
      "fonts/files/inter-vietnamese-wght-normal.woff2",
      "fonts/inter.css",
      "harness.css",
      "images/bg-reforged.jpg",
      "images/logo.webp",
      "images/playstation-controller-prompts.png",
      "index.html",
      "loading.css",
      // Copied out of src/shared, and flattened to `ui/` so the renderer and
      // the Tools bundle load the one design system by the same href.
      "ui/components.css",
      "ui/tokens.css",
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
describe("scripts/build.mjs is the one caller of rustc", () => {
  const rustc = BUILD_STEPS.filter(([command]) => command === "rustc");

  it("compiles the kernel exactly once per build", () => {
    assert.equal(rustc.length, 1);
  });

  it("writes only an unserved candidate", () => {
    const kernel = rustc[0];
    assert.ok(kernel, "no rustc step to inspect");
    const args = stepArgs(kernel);
    assert.deepEqual(args.slice(-2), [
      "-o",
      "build/.companion-kernel.unsealed.wasm",
    ]);
    assert.ok(args.includes("src/companion-kernel/lib.rs"));
    assert.deepEqual(
      args,
      companionKernelRustcArgs("build/.companion-kernel.unsealed.wasm"),
    );
  });

  it("publishes it through one immediate build-time sealing step", () => {
    const kernel = BUILD_STEPS.findIndex(([command]) => command === "rustc");
    const sealers = BUILD_STEPS.map((step, index) => ({ step, index })).filter(
      ({ step }) => stepArgs(step).includes("scripts/seal-companion-kernel.mjs"),
    );
    assert.equal(sealers.length, 1);
    assert.equal(sealers[0]!.index, kernel + 1);
  });
});

describe("scripts/build.mjs orders the producers of build/renderer", () => {
  const assets = stepPosition("scripts/copy-renderer.mjs");
  const renderer = stepPosition("scripts/build-renderer.mjs");
  const kernel = BUILD_STEPS.findIndex(([command]) => command === "rustc");
  const sealer = stepPosition("scripts/seal-companion-kernel.mjs");

  it("copies the assets before the renderer is compiled into the same directory", () => {
    // The reverse order is the defect this ordering exists to prevent: the copy
    // step recreated build/renderer, which was harmless only while the renderer
    // compile emitted nothing.
    assert.ok(
      assets < renderer,
      `assets copied at ${assets}, renderer compiled at ${renderer}`,
    );
  });

  it("compiles and seals the kernel after both of them", () => {
    assert.ok(kernel >= 0, "no rustc step to inspect");
    assert.ok(
      assets < kernel && renderer < kernel && kernel < sealer,
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

describe("renderer typechecking does not emit runtime files", () => {
  const main = projectOptions("tsconfig.json");
  const renderer = projectOptions("tsconfig.renderer.json");

  it("leaves build/shared to the main compiler", () => {
    assert.equal(renderer.noEmit, true);
    assert.equal(renderer.outDir, undefined);
    assert.equal(main.noEmit, undefined);
    assert.equal(main.outDir, path.join(repoRoot, "build"));
  });

  it("has one explicit renderer runtime producer", () => {
    assert.equal(stepPosition("scripts/build-renderer.mjs") >= 0, true);
    assert.equal(
      BUILD_STEPS.some((step) => stepArgs(step).includes("tsconfig.renderer.json")),
      false,
    );
  });
});
