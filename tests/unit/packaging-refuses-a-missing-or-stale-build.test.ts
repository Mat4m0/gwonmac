// P4.1 — renderer asset generation has one owner, scripts/build.mjs. Forge's
// generateAssets hook used to be a second producer (it re-ran
// scripts/copy-renderer.mjs), so the hook is now an assertion instead. An
// assertion that never fires is indistinguishable from a deleted hook, so this
// executes it against real directories: a missing package input and a source
// edited after the build must both stop packaging, and a fresh tree must not.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import forgeConfig, { assertBuildIsFresh } from "../../forge.config.ts";

const PACKAGE_INPUTS = [
  "build/main/main.js",
  "build/shared/release.js",
  "build/preload/preload.cjs",
  "build/renderer/index.html",
  "build/renderer/toolbox-kernel.wasm",
];

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A tree that looks like a repository checkout right after `pnpm build`. */
function builtTree(options: { omit?: string } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "gw-build-"));
  roots.push(root);

  const source = path.join(root, "src", "main", "main.ts");
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, "export {};\n");
  const sourceTime = new Date(Date.now() - 60_000);
  utimesSync(source, sourceTime, sourceTime);

  for (const input of PACKAGE_INPUTS) {
    if (input === options.omit) continue;
    const file = path.join(root, input);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
  return root;
}

describe("packaging asserts that build/ was produced from the current sources", () => {
  it("accepts a tree whose build/ is newer than every source", () => {
    assertBuildIsFresh(builtTree());
  });

  it("refuses a build/ that is missing a package input", () => {
    const root = builtTree({ omit: "build/renderer/toolbox-kernel.wasm" });
    assert.throws(
      () => assertBuildIsFresh(root),
      /build\/renderer\/toolbox-kernel\.wasm is missing; run `pnpm build` first/,
    );
  });

  it("refuses a build/ older than a source file, naming the source", () => {
    const root = builtTree();
    const edited = path.join(root, "src", "renderer", "loading.js");
    mkdirSync(path.dirname(edited), { recursive: true });
    writeFileSync(edited, "// edited after the build\n");
    const later = new Date(Date.now() + 60_000);
    utimesSync(edited, later, later);

    assert.throws(
      () => assertBuildIsFresh(root),
      /src\/renderer\/loading\.js is newer than build\/; run `pnpm build` first/,
    );
  });
});

describe("Forge's generateAssets hook asserts rather than builds", () => {
  const generateAssets = forgeConfig.hooks?.generateAssets as
    | ((config: unknown, platform: string, arch: string) => Promise<void>)
    | undefined;

  /** The hook reads process.cwd(), which is the packaged repository root. */
  async function runHookIn(root: string): Promise<void> {
    assert.ok(generateAssets, "forge.config.ts still declares generateAssets");
    const previous = process.cwd();
    process.chdir(root);
    try {
      await generateAssets({}, "darwin", "arm64");
    } finally {
      process.chdir(previous);
    }
  }

  it("passes on a built tree without producing anything itself", async () => {
    // The tree has no src/renderer and no rustc; a hook that still generated
    // assets could not succeed here.
    await runHookIn(builtTree());
  });

  it("fails packaging when build/ is missing", async () => {
    const root = builtTree({ omit: "build/main/main.js" });
    await assert.rejects(() => runHookIn(root), /build\/main\/main\.js is missing/);
  });
});
