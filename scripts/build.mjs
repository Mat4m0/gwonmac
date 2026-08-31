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

/** @typedef {readonly [command: string, args: readonly string[]]} BuildStep */

/**
 * Invoke pnpm's JavaScript entry point through the current Node executable.
 * This avoids both shell parsing and Windows command-shim behavior.
 *
 * @param {NodeJS.Platform} platform
 * @param {string | undefined} npmExecPath
 * @param {string} nodeExecutable
 * @returns {BuildStep}
 */
export function packageManagerInvocation(
  platform,
  npmExecPath,
  nodeExecutable = process.execPath,
) {
  if (npmExecPath) return [nodeExecutable, [npmExecPath]];
  if (platform === "win32") {
    throw new Error("Run the canonical Windows build through `pnpm build`.");
  }
  return ["pnpm", []];
}

const [pnpmCommand, pnpmPrefixArgs] = packageManagerInvocation(
  process.platform,
  process.env.npm_execpath,
);

const DECODER_SOURCES = [
  "src/native/gw-dat/decoder-main.cpp",
  "src/native/gw-dat/vendor/gwdat/xentax.cpp",
  "src/native/gw-dat/vendor/gwdat/AtexReader.cpp",
  "src/native/gw-dat/vendor/gwdat/AtexDecompress.cpp",
  "src/native/gw-dat/vendor/gwdat/AtexAsm.cpp",
];

/**
 * Native recipes selected by the build host. macOS keeps its exact released
 * addon and decoder commands. Windows compiles its Credential Manager addon
 * and decoder; Linux compiles only the decoder until its secure provider is
 * qualified on an installed package.
 *
 * @param {NodeJS.Platform} platform
 * @param {NodeJS.Architecture} architecture
 * @returns {readonly BuildStep[]}
 */
export function nativeBuildSteps(platform, architecture) {
  if (platform === "darwin") {
    const targetArchitecture = architecture === "arm64"
      ? "arm64"
      : architecture === "x64"
        ? "x86_64"
        : null;
    if (targetArchitecture === null) {
      throw new Error(`unsupported macOS build architecture: ${architecture}`);
    }
    return [
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
          targetArchitecture,
          "-O2",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-fvisibility=hidden",
          "src/native/host/host.mm",
          "-framework",
          "AppKit",
          "-framework",
          "Foundation",
          "-framework",
          "LocalAuthentication",
          "-framework",
          "Security",
          "-o",
          "build/native/host.node",
        ],
      ],
      [
        "xcrun",
        [
          "clang++",
          "-std=c++20",
          "-mmacosx-version-min=12.0",
          "-arch",
          targetArchitecture,
          "-O2",
          '-D__int64=long long',
          "-Wno-multichar",
          "-Wno-constant-logical-operand",
          "-Isrc/native/gw-dat",
          ...DECODER_SOURCES,
          "-o",
          "build/native/gw-dat-decode",
        ],
      ],
    ];
  }

  if (platform === "win32") {
    if (architecture !== "x64") {
      throw new Error(`unsupported Windows build architecture: ${architecture}`);
    }
    // The installed package must not depend on a separately installed Visual
    // C++ Redistributable. Both shipped binaries therefore carry the static
    // runtime selected by /MT.
    return [
      [
        "lib.exe",
        [
          "/nologo",
          "/def:node_modules/node-api-headers/def/node_api.def",
          "/machine:x64",
          "/out:build/native/node.lib",
        ],
      ],
      [
        "cl.exe",
        [
          "/nologo",
          "/std:c++20",
          "/O2",
          "/MT",
          "/EHsc",
          "/LD",
          "/DNAPI_VERSION=8",
          "/Inode_modules/node-api-headers/include",
          "/Fobuild\\native\\",
          "/Fdbuild/native/windows-host.pdb",
          "src/native/windows-host/host.cpp",
          "src/native/windows-host/win-delay-load-hook.cpp",
          "Advapi32.lib",
          "Shell32.lib",
          "Ole32.lib",
          "Wintrust.lib",
          "build/native/node.lib",
          "/Fe:build/native/windows-host.node",
          "/link",
          "/DELAYLOAD:NODE.EXE",
          "Delayimp.lib",
        ],
      ],
      [
        "cl.exe",
        [
          "/nologo",
          "/std:c++20",
          "/O2",
          "/MT",
          "/EHsc",
          "/Isrc/native/gw-dat",
          "/Fobuild\\native\\",
          ...DECODER_SOURCES,
          "/Fe:build/native/gw-dat-decode.exe",
        ],
      ],
    ];
  }

  if (platform === "linux") {
    if (architecture !== "x64") {
      throw new Error(`unsupported Linux build architecture: ${architecture}`);
    }
    return [
      [process.execPath, ["scripts/build-linux-secret-portal.mjs"]],
      ["c++", [
        "-std=c++20",
        "-O2",
        '-D__int64=long long',
        "-Wno-multichar",
        "-Wno-constant-logical-operand",
        "-Isrc/native/gw-dat",
        ...DECODER_SOURCES,
        "-o",
        "build/native/gw-dat-decode",
      ]],
    ];
  }

  throw new Error(`unsupported native build platform: ${platform}`);
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
  // Rollup owns the complete renderer runtime closure, including the shared
  // modules it imports. TypeScript checks the same source without emitting;
  // only the main compiler below writes build/shared.
  [process.execPath, ["scripts/build-renderer.mjs"]],
  // The main program, and the owner of build/shared.
  [process.execPath, ["node_modules/typescript/bin/tsc"]],
  // The launcher is a standalone Vue document with its own narrow preload and
  // protocol subtree. Vite owns only build/renderer/launcher/.
  [
    pnpmCommand,
    [...pnpmPrefixArgs, "--filter", "@gwonmac/launcher-ui", "build"],
  ],
  // The Tools application, bundled once for the renderer. It is an independent
  // Vue workspace with its own tests, so this step only packages what already
  // passed them. Vite writes build/renderer/tools/ and empties only that
  // directory, so it cannot disturb the emits above and its position here is
  // for readability rather than correctness.
  [
    pnpmCommand,
    [...pnpmPrefixArgs, "--filter", "@gwonmac/tools-ui", "build:embedded"],
  ],
  // Native compilation remains a direct per-platform recipe. macOS alone has
  // the AppKit/Keychain addon; all three targets build the isolated decoder.
  ...nativeBuildSteps(process.platform, process.arch),
  // Reads src/shared/contracts.ts and src/preload/preload.body.cjs and writes
  // the Core and Tools preload artifacts, which nothing else here produces — so its
  // position is free. It is TypeScript, so it is spawned the one way this
  // repository runs a TypeScript file from Node — the same custom hook
  // package.json's script entries use.
  [
    process.execPath,
    [
      "--import",
      "./scripts/ts-hook.mjs",
      "scripts/generate-preload.ts",
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
    if (result.status !== 0) {
      console.error(
        `Build step failed: ${command}`
          + (result.error ? ` (${result.error.message})` : ""),
      );
      process.exit(result.status ?? 1);
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  build();
}
