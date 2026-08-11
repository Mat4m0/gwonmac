import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BUILD_STEPS } from "../../scripts/build.mjs";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
  DISTRIBUTION_CHANNELS,
} from "../../src/shared/distribution-channel.ts";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const source = read("src/native/keychain/keychain.mm");

test("the native boundary uses only ABI-stable Node-API", () => {
  assert.match(source, /#include <node_api\.h>/u);
  assert.doesNotMatch(
    source,
    /#include <(?:node|node_buffer|node_version|node_object_wrap|uv|v8)(?:\.h|\/)/u,
  );
  assert.doesNotMatch(source, /\b(?:v8|uv_|node::)/u);
  assert.match(source, /napi_create_async_work/u);
  assert.match(source, /napi_queue_async_work/u);
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
  const nativeSteps = BUILD_STEPS.filter(([, args]) =>
    args.includes("src/native/keychain/keychain.mm"),
  );
  assert.equal(nativeSteps.length, 1);
  const [command, args] = nativeSteps[0]!;
  assert.equal(command, "xcrun");
  assert.ok(args.includes("-DNAPI_VERSION=8"));
  assert.ok(args.includes("node_modules/node-api-headers/include"));
  assert.ok(args.includes("-mmacosx-version-min=12.0"));
  assert.deepEqual(args.slice(-2), ["-o", "build/native/keychain.node"]);
  assert.equal(args.filter((arg) => arg === "-arch").length, 1);
  assert.equal(
    JSON.parse(read("package.json")).devDependencies["node-api-headers"],
    "1.9.0",
  );
});

// Two files are unpacked, and both are executable code that cannot run from
// inside the archive: an addon cannot be dlopen'd from it and a helper cannot
// be spawned from it. The pattern stays a literal pair rather than a directory
// glob, so adding a third is an edit here as well as there.
test("Forge unpacks only the two executables from ASAR", () => {
  const forge = read("forge.config.ts");
  const packageIgnore = read("scripts/package-ignore.ts");
  assert.match(
    forge,
    /asar: \{ unpack: "\*\*\/build\/native\/\{keychain\.node,gw-dat-decode\}" \}/u,
  );
  for (const kept of [
    /p === "\/build\/native"/u,
    /p === "\/build\/native\/keychain\.node"/u,
    /p === "\/build\/native\/gw-dat-decode"/u,
  ]) {
    assert.match(packageIgnore, kept);
  }
  assert.doesNotMatch(forge, /unpackDir|asarUnpack/u);
});
