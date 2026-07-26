// P4.2 — `pnpm package` compiled src/toolbox-kernel/lib.rs twice, because
// scripts/copy-renderer.mjs shelled out to rustc and was invoked from both
// scripts/build.mjs and forge.config.ts's generateAssets hook.
//
// Two facts keep it at once. The first is executed here: copy-renderer.mjs runs
// to completion over a fixture checkout with no rustc reachable at all, and
// emits no kernel. The second is the step list scripts/build.mjs actually
// spawns, which holds exactly one rustc invocation. (The other former caller is
// covered by packaging-refuses-a-missing-or-stale-build.test.ts, which executes
// the hook and shows it produces nothing.)
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
  write("src/renderer/images/logo.webp", "webp");
  write("src/renderer/images/bg1.webp", "webp");
  return root;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

describe("scripts/copy-renderer.mjs only copies", () => {
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

  it("still produces the renderer tree and the image index", () => {
    assert.equal(
      readFileSync(path.join(root, "build/renderer/index.html"), "utf8"),
      "<!doctype html>\n",
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(path.join(root, "build/renderer/images/index.json"), "utf8"),
      ),
      {
        logo: "images/logo.webp",
        backgrounds: ["images/bg1.webp"],
        credit:
          'Screenshots by <a href="https://bloogum.net/guildwars/">Snapshot Henchman</a>',
      },
    );
    // Not the preload: P5.6 moved that to scripts/generate-preload.mjs, which
    // splices the canonical channel constants in and is the only producer of
    // build/preload/preload.cjs.
    assert.equal(existsSync(path.join(root, "build/preload")), false);
  });

  it("emits no WebAssembly", () => {
    const emitted = filesUnder(path.join(root, "build")).filter((file) =>
      file.endsWith(".wasm"),
    );
    assert.deepEqual(emitted, []);
  });
});

describe("scripts/build.mjs is the one caller of rustc", () => {
  const rustc = BUILD_STEPS.filter(([command]) => command === "rustc");

  it("compiles the kernel exactly once per build", () => {
    assert.equal(rustc.length, 1);
  });

  it("writes it into the renderer output, after that output is recreated", () => {
    const args = rustc[0]![1];
    assert.deepEqual(args.slice(-2), [
      "-o",
      "build/renderer/toolbox-kernel.wasm",
    ]);
    assert.ok(args.includes("src/toolbox-kernel/lib.rs"));
    const copy = BUILD_STEPS.findIndex(([, args]) =>
      args.includes("scripts/copy-renderer.mjs"),
    );
    // copy-renderer.mjs deletes build/renderer, so a kernel written before it
    // would not survive to be packaged.
    assert.ok(copy >= 0 && copy < BUILD_STEPS.indexOf(rustc[0]!));
  });
});
