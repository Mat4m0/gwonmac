import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  nativeBuildSteps,
  packageManagerInvocation,
} from "../../scripts/build.mjs";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
  DISTRIBUTION_CHANNELS,
} from "../../src/shared/distribution-channel.ts";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const source = read("src/native/host/host.mm");

test("the native boundary uses only ABI-stable Node-API", () => {
  assert.match(source, /#include <node_api\.h>/u);
  assert.doesNotMatch(
    source,
    /#include <(?:node|node_buffer|node_version|node_object_wrap|uv|v8)(?:\.h|\/)/u,
  );
  assert.doesNotMatch(source, /\b(?:v8|uv_|node::)/u);
  assert.match(source, /napi_create_async_work/u);
  assert.match(source, /napi_queue_async_work/u);
  assert.match(source, /napi_async_init/u);
  assert.match(source, /napi_make_callback/u);
});

test("Command-held releases use one app-local macOS monitor", () => {
  assert.match(source, /#import <AppKit\/AppKit\.h>/u);
  assert.match(source, /addLocalMonitorForEventsMatchingMask:/u);
  assert.match(source, /NSEventMaskKeyUp/u);
  assert.match(source, /NSEventMaskKeyDown/u);
  assert.match(source, /NSEventMaskFlagsChanged/u);
  assert.match(source, /NSEventModifierFlagCommand/u);
  assert.match(source, /commandKeys\.insert\(monitor->downKeys\.begin\(\)/u);
  assert.match(source, /const bool commandOwned =\s+commandHeld \|\|/u);
  assert.match(
    source,
    /return commandHeld && handled \? nil : event/u,
  );
  assert.doesNotMatch(source, /CGEventTap|IOHID|AXIsProcessTrusted/u);
});

test("the native host does not own the app key-repeat preference", () => {
  assert.doesNotMatch(source, /ApplePressAndHoldEnabled|registerDefaults/u);
});

test("the native boundary owns two fixed Data Protection Keychain items", () => {
  const nativeBundleIds = [
    ...source.matchAll(/NSString \*const k\w+Bundle = @"([^"]+)";/gu),
  ].map((match) => match[1]);
  assert.deepEqual(
    nativeBundleIds.sort(),
    DISTRIBUTION_CHANNELS.map(
      (channel) => DISTRIBUTION_CHANNEL_CONFIG[channel].bundleId,
    ).sort(),
  );
  for (const value of [
    "arenaNetCredentials",
    "steamSession",
    "arena-net-credentials",
    "steam-session",
  ]) {
    assert.ok(
      source.includes(`"${value}"`),
      `${value} is not fixed in native code`,
    );
  }
  assert.match(source, /kSecUseDataProtectionKeychain/u);
  assert.match(source, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/u);
  assert.match(source, /interactionNotAllowed = YES/u);
  assert.match(source, /kSecUseAuthenticationContext/u);
  assert.match(source, /NSBundle\.mainBundle\.bundleIdentifier/u);
  assert.match(source, /return bundle;/u);
  assert.match(source, /kSecAttrService : service/u);
  assert.equal(
    (source.match(/if \(query == nil\)\s*return Result::kUnavailable/gu) ?? [])
      .length,
    3,
  );
  assert.doesNotMatch(source, /SecKeychain|SecAccess|kSecAttrAccessGroup/u);
  assert.doesNotMatch(source, /\b(?:system|popen|exec[lv]?[pe]?)\s*\(/u);
});

test("the canonical build emits one host-only Node-API 8 addon", () => {
  const nativeSteps = nativeBuildSteps("darwin", "arm64").filter(([, args]) =>
    args.includes("src/native/host/host.mm"),
  );
  assert.equal(nativeSteps.length, 1);
  const [command, args] = nativeSteps[0]!;
  assert.equal(command, "xcrun");
  assert.ok(args.includes("-DNAPI_VERSION=8"));
  assert.ok(args.includes("node_modules/node-api-headers/include"));
  assert.ok(args.includes("-mmacosx-version-min=12.0"));
  assert.ok(args.includes("AppKit"));
  assert.deepEqual(args.slice(-2), ["-o", "build/native/host.node"]);
  assert.equal(args.filter((arg) => arg === "-arch").length, 1);
  assert.equal(
    JSON.parse(read("package.json")).devDependencies["node-api-headers"],
    "1.9.0",
  );
});

test("Windows and Linux build only their target-native boundaries", () => {
  const windows = nativeBuildSteps("win32", "x64");
  const linux = nativeBuildSteps("linux", "x64");

  assert.deepEqual(windows.map(([command]) => command), [
    "lib.exe",
    "cl.exe",
    "cl.exe",
  ]);
  assert.ok(windows[0]?.[1].includes("/out:build/native/node.lib"));
  assert.ok(windows[1]?.[1].includes("build/native/node.lib"));
  assert.ok(windows[1]?.[1].includes("src/native/windows-host/win-delay-load-hook.cpp"));
  assert.ok(windows[1]?.[1].includes("/DELAYLOAD:NODE.EXE"));
  assert.ok(windows[1]?.[1].includes("Delayimp.lib"));
  assert.ok(windows[1]?.[1].includes("/Fe:build/native/windows-host.node"));
  assert.ok(windows[2]?.[1].includes("/Fe:build/native/gw-dat-decode.exe"));
  for (const [, args] of windows.slice(1)) {
    assert.ok(args.includes("/MT"), "packaged native code must carry its C++ runtime");
    assert.equal(args.includes("/MD"), false);
  }
  assert.deepEqual(linux.map(([command]) => command), [process.execPath, "c++"]);
  assert.deepEqual(linux[0]?.[1], ["scripts/build-linux-secret-portal.mjs"]);
  assert.deepEqual(linux[1]?.[1].slice(-2), [
    "-o",
    "build/native/gw-dat-decode",
  ]);
  for (const steps of [windows, linux]) {
    assert.equal(
      steps.some(([, args]) => args.includes("src/native/host/host.mm")),
      false,
    );
  }
});

test("the build invokes pnpm through Node without shell parsing", () => {
  assert.deepEqual(
    packageManagerInvocation("win32", "C:\\pnpm\\pnpm.cjs", "node.exe"),
    ["node.exe", ["C:\\pnpm\\pnpm.cjs"]],
  );
  assert.deepEqual(
    packageManagerInvocation("linux", "/opt/pnpm/pnpm.cjs", "/usr/bin/node"),
    ["/usr/bin/node", ["/opt/pnpm/pnpm.cjs"]],
  );
  assert.throws(() => packageManagerInvocation("win32", undefined));
  assert.deepEqual(packageManagerInvocation("darwin", undefined), ["pnpm", []]);
});

test("the first target ports refuse unsupported CPU architectures", () => {
  assert.throws(() => nativeBuildSteps("win32", "arm64"));
  assert.throws(() => nativeBuildSteps("linux", "arm64"));
});

// Each package contains the decoder for its own platform. macOS and Windows
// also contain their separate native credential boundary. Every listed file is executable
// code that cannot run inside the archive, and the allowlist remains exact
// rather than opening a directory.
test("Forge unpacks only the platform-native executables from ASAR", () => {
  const forge = read("forge.config.ts");
  const packageIgnore = read("scripts/package-ignore.ts");
  assert.match(
    forge,
    /unpack: "\*\*\/build\/native\/\{host\.node,windows-host\.node,gw-secret-portal,gw-dat-decode,gw-dat-decode\.exe\}"/u,
  );
  for (const kept of [
    /p === "\/build\/native"/u,
    /p === "\/build\/native\/host\.node"/u,
    /p === "\/build\/native\/windows-host\.node"/u,
    /p === "\/build\/native\/gw-secret-portal"/u,
    /p === "\/build\/native\/gw-dat-decode"/u,
    /p === "\/build\/native\/gw-dat-decode\.exe"/u,
  ]) {
    assert.match(packageIgnore, kept);
  }
  assert.doesNotMatch(forge, /unpackDir|asarUnpack/u);
});
