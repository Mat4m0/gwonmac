// The single producer of everything under build/.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

// package.json's `engines` is the one declaration of the floor, and this is
// where it stops a build. Every entry point reaches the compiler through this
// file, and an older Node fails somewhere further in — on a flag it does not
// have, or on syntax it cannot strip — as a defect in the step rather than as
// an unmet requirement.
/** @type {{ engines?: { node?: string } }} */
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const declaredNode = manifest.engines?.node;
const nodeFloor = /^>=(\d+)\.(\d+)$/u.exec(declaredNode ?? "");
if (nodeFloor === null) {
  throw new Error(
    `package.json engines.node must be a >=<major>.<minor> floor, not ${declaredNode}`,
  );
}
const [floor, floorMajor = "0", floorMinor = "0"] = nodeFloor;
const [runningMajor = 0, runningMinor = 0] = process.versions.node
  .split(".")
  .map(Number);
if (
  runningMajor < Number(floorMajor)
  || (runningMajor === Number(floorMajor) && runningMinor < Number(floorMinor))
) {
  throw new Error(
    `Node ${floor} is required; this is ${process.versions.node}. `
      + "See the Requirements in README.md.",
  );
}

const nativeArchitecture =
  process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : null;
if (nativeArchitecture === null) {
  throw new Error(`unsupported native build architecture: ${process.arch}`);
}

/**
 * The one reproducible freestanding-kernel compile recipe.
 * @param {string} output
 */
export function companionKernelRustcArgs(output) {
  return [
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
    "relocation-model=pic",
    "-C",
    "link-arg=--import-memory",
    "-C",
    "link-arg=--experimental-pic",
    "-C",
    "link-arg=--shared",
    "-C",
    "link-arg=--strip-all",
    "-o",
    output,
  ];
}

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
  // The Tools application, bundled once for the renderer. It is an independent
  // Vue workspace with its own tests, so this step only packages what already
  // passed them. Vite writes build/renderer/tools/ and empties only that
  // directory, so it cannot disturb the emits above and its position here is
  // for readability rather than correctness.
  ["pnpm", ["--filter", "@gwonmac/tools-ui", "build:embedded"]],
  // The only native addon. It uses raw Node-API version 8, whose ABI remains
  // stable across the Node and Electron upgrades this project takes. The
  // framework APIs resolve at runtime from the Electron host, so the bundle
  // deliberately leaves Node-API symbols undefined here.
  [
    "xcrun",
    [
      "clang++",
      "-std=c++20",
      "-fobjc-arc",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-DNAPI_VERSION=8",
      "-I",
      "node_modules/node-api-headers/include",
      "-mmacosx-version-min=12.0",
      "-arch",
      nativeArchitecture,
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-fvisibility=hidden",
      "src/native/keychain/keychain.mm",
      "-framework",
      "Foundation",
      "-framework",
      "LocalAuthentication",
      "-framework",
      "Security",
      "-o",
      "build/native/keychain.node",
    ],
  ],
  // The Guild Wars archive decoder. A separate executable rather than a second
  // addon: it is hand-transcribed x86 (see src/native/gw-dat/vendor/README.md)
  // parsing the player's own game files, and a malformed record should fail one
  // decode rather than take the application down with it. It is spawned once
  // per asset and the result is cached on disk, so the process boundary costs
  // about four milliseconds, once, per icon that is ever looked at.
  //
  // -Wall/-Wextra/-Werror are deliberately not applied: this is vendored source
  // carried unmodified, and the -D/-Wno flags stand in for MSVC builtins clang
  // lacks rather than patching it. The third silences a warning about an `&&`
  // that reads like a typo and is not one — src/native/gw-dat/vendor/README.md
  // records why changing it would break the decode.
  [
    "xcrun",
    [
      "clang++",
      "-std=c++20",
      "-mmacosx-version-min=12.0",
      "-arch",
      nativeArchitecture,
      "-O2",
      '-D__int64=long long',
      "-Wno-multichar",
      "-Wno-constant-logical-operand",
      "-Isrc/native/gw-dat",
      "src/native/gw-dat/decoder-main.cpp",
      "src/native/gw-dat/vendor/gwdat/xentax.cpp",
      "src/native/gw-dat/vendor/gwdat/AtexReader.cpp",
      "src/native/gw-dat/vendor/gwdat/AtexDecompress.cpp",
      "src/native/gw-dat/vendor/gwdat/AtexAsm.cpp",
      "-o",
      "build/native/gw-dat-decode",
    ],
  ],
  // Reads src/shared/contracts.ts and src/preload/preload.body.cjs and writes
  // build/preload/preload.cjs, which nothing else here produces — so its
  // position is free. It is TypeScript, so it is spawned the one way this
  // repository runs a TypeScript file from Node — the same flags
  // package.json's script entries use. `--experimental-strip-types` is
  // redundant from Node 22.18 and stays because the floor checked above is
  // lower, where it is not.
  [
    process.execPath,
    [
      "--import",
      "./scripts/ts-hook.mjs",
      "--experimental-strip-types",
      "scripts/generate-preload.ts",
    ],
  ],
  // Reads the certified build tables under src/main/certification and writes
  // build/certificates/feed.json, which nothing else here produces — so its
  // position is free. Spawned the same way as the preload generator, and for
  // the same reason: it is TypeScript read by the loader.
  [
    process.execPath,
    [
      "--import",
      "./scripts/ts-hook.mjs",
      "--experimental-strip-types",
      "scripts/generate-certificate-feed.ts",
    ],
  ],
  // No Cargo.toml: no dependencies, and rust-toolchain.toml pins the toolchain.
  // rustc writes an unserved candidate. The next step validates its fixed ABI,
  // seals its digest into the emitted renderer, and only then publishes it.
  [
    "rustc",
    companionKernelRustcArgs("build/.companion-kernel.unsealed.wasm"),
  ],
  [process.execPath, ["scripts/seal-companion-kernel.mjs"]],
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
