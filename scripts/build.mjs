// The single producer of everything under build/.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Every command that produces a package input, in order. Exported so the step
 * list itself is assertable: the kernel is compiled by exactly one of them.
 *
 * Written as pairs rather than left to inference: an array literal of arrays
 * widens to `(string | string[])[][]`, which loses the fact that the first
 * element is the executable and the rest are its arguments, and makes the
 * `spawnSync` call below unresolvable.
 *
 * @type {ReadonlyArray<readonly [command: string, args: readonly string[]]>}
 */
export const BUILD_STEPS = [
  // Static assets only. It fills build/renderer with everything the compiler
  // does not produce, so it has to run before the compiler writes into the
  // same directory.
  [process.execPath, ["scripts/copy-renderer.mjs"]],
  // The renderer's own program, emitting build/renderer/*.js. It used to check
  // without emitting and the JavaScript was copied verbatim; that is what made
  // the copy step's old rmSync harmless, and what would delete this emit if the
  // two ever swapped back.
  //
  // It also re-emits build/shared/*.js, which is not its output to own: the
  // renderer's type-only imports of src/shared make those files emittable, and
  // TypeScript has no flag that keeps a file in a program but out of its emit.
  // tsconfig.renderer.json says why the alternative was rejected. What matters
  // here is the order — this step runs *before* the main program, so the copy
  // that survives is the one with the sourceMappingURL and the .js.map beside
  // it. Reversed, main-process stack traces silently lose their source
  // mapping, which is the defect that made this ordering explicit.
  [
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.renderer.json"],
  ],
  // The main program, and the owner of build/shared.
  [process.execPath, ["node_modules/typescript/bin/tsc"]],
  // The Vue Tools application is independently testable, then bundled once for
  // the renderer. It appends beneath build/renderer/tools and never clears the
  // output owned by the preceding steps.
  ["pnpm", ["--filter", "@gwonmac/tools-ui", "build:embedded"]],
  // Reads src/shared/contracts.ts and src/preload/preload.body.cjs and writes
  // build/preload/preload.cjs, which nothing else here produces — so its
  // position is free. It is TypeScript, so it is spawned the one way this
  // repository runs a TypeScript file from Node — the same flags
  // package.json's script entries use. `--experimental-strip-types` is
  // redundant from Node 22.18 and stays because package.json's engines floor
  // is 22.12, where it is not.
  [
    process.execPath,
    [
      "--import",
      "./scripts/ts-hook.mjs",
      "--experimental-strip-types",
      "scripts/generate-preload.ts",
    ],
  ],
  // A quarantined local decoder for the player's own skill-icon bytes. It is
  // a native helper instead of a Node addon: Electron never loads third-party
  // C++ into either privileged process, and the wrapper bounds both sides of
  // the byte stream before the derived decoder sees it.
  [
    "clang++",
    [
      "-std=c++20",
      "-O2",
      "-D__int64=long long",
      "-Wno-multichar",
      "-Wno-constant-logical-operand",
      "-Isrc/native/skill-icons",
      "src/native/skill-icons/decoder-main.cpp",
      "src/native/skill-icons/vendor/gwdat/xentax.cpp",
      "src/native/skill-icons/vendor/gwdat/AtexReader.cpp",
      "src/native/skill-icons/vendor/gwdat/AtexDecompress.cpp",
      "src/native/skill-icons/vendor/gwdat/AtexAsm.cpp",
      "-o",
      "build/native/gw-skill-icon-decoder",
    ],
  ],
  // No Cargo.toml: no dependencies, and rust-toolchain.toml pins the toolchain.
  // It writes into build/renderer, so it goes after everything that fills it.
  [
    "rustc",
    [
      "src/companion-kernel/lib.rs",
      "--edition=2021",
      "--target",
      "wasm32-unknown-unknown",
      "--crate-type",
      "cdylib",
      "-C",
      "opt-level=s",
      "-C",
      "panic=abort",
      "-C",
      "link-arg=--import-memory",
      "-C",
      "link-arg=--strip-all",
      "-o",
      "build/renderer/companion-kernel.wasm",
    ],
  ],
];

function build() {
  rmSync("build", { recursive: true, force: true });
  mkdirSync("build/native", { recursive: true });

  for (const [command, args] of BUILD_STEPS) {
    const result = spawnSync(command, args, { stdio: "inherit" });
    // `spawnSync` types its failure as a plain `Error`; the `code` that says the
    // executable is missing is only on the Node runtime's `SystemError` shape,
    // so ask whether it is there rather than assert that it is.
    if (
      result.error
      && "code" in result.error
      && result.error.code === "ENOENT"
    ) {
      console.error(
        `${command} is not installed. See the Requirements in README.md.`,
      );
      process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  build();
}
