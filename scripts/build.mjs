// The single producer of everything under build/. Forge's generateAssets hook
// used to run scripts/copy-renderer.mjs a second time, so a clean `pnpm package`
// compiled the Toolbox kernel twice; that hook now only asserts this script's
// output (see assertBuildIsFresh in forge.config.ts).
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Every command that produces a package input, in order. Exported so the step
 * list itself is assertable: the kernel is compiled by exactly one of them.
 */
export const BUILD_STEPS = [
  [process.execPath, ["node_modules/typescript/bin/tsc"]],
  [
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.renderer.json"],
  ],
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
    if (result.error?.code === "ENOENT") {
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
