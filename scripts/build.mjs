// The single producer of everything under build/.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
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
  [process.execPath, ["node_modules/typescript/bin/tsc"]],
  [
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.renderer.json"],
  ],
  // Reads build/shared/contracts.js, so it has to run after tsc.
  [process.execPath, ["scripts/generate-preload.mjs"]],
  // Recreates build/renderer, so the kernel has to be written after it.
  [process.execPath, ["scripts/copy-renderer.mjs"]],
  // No Cargo.toml: no dependencies, and rust-toolchain.toml pins the toolchain.
  [
    "rustc",
    [
      "src/toolbox-kernel/lib.rs",
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
      "build/renderer/toolbox-kernel.wasm",
    ],
  ],
];

function build() {
  rmSync("build", { recursive: true, force: true });

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
