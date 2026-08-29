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
const source = read("src/native/host/host.mm");
const dictationSource = read("src/native/host/dictation-modern.swift");

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

test("dictation is native, on-device, bounded to an explicit session", () => {
  assert.match(dictationSource, /import Speech/u);
  assert.match(dictationSource, /DictationTranscriber/u);
  assert.match(dictationSource, /AssetInventory\.status/u);
  assert.match(dictationSource, /assetInstallationRequest/u);
  assert.match(dictationSource, /installTap\(onBus: 0/u);
  assert.match(dictationSource, /removeTap\(onBus: 0/u);
  assert.match(dictationSource, /finalizeAndFinishThroughEndOfInput/u);
  assert.match(dictationSource, /bestAvailableAudioFormat/u);
  assert.match(dictationSource, /AVAudioConverter/u);
  assert.doesNotMatch(
    source + dictationSource,
    /SFSpeechRecognizer|SFSpeechURLRecognitionRequest|writeToFile/u,
  );
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
  const objectiveCSteps = BUILD_STEPS.filter(([, args]) =>
    args.includes("src/native/host/host.mm"),
  );
  assert.equal(objectiveCSteps.length, 1);
  const [command, args] = objectiveCSteps[0]!;
  assert.equal(command, "xcrun");
  assert.ok(args.includes("-DNAPI_VERSION=8"));
  assert.ok(args.includes("node_modules/node-api-headers/include"));
  assert.ok(args.includes("-mmacosx-version-min=12.0"));
  assert.deepEqual(args.slice(-2), ["-o", "build/native/host.o"]);
  assert.equal(args.filter((arg) => arg === "-arch").length, 1);

  const swiftSteps = BUILD_STEPS.filter(([, stepArgs]) =>
    stepArgs.includes("src/native/host/dictation-modern.swift"),
  );
  assert.equal(swiftSteps.length, 1);
  assert.equal(swiftSteps[0]![1][0], "swiftc");
  const linkSteps = BUILD_STEPS.filter(([, stepArgs]) =>
    stepArgs.includes("build/native/host.o")
      && stepArgs.includes("build/native/dictation-modern.o"),
  );
  assert.equal(linkSteps.length, 1);
  const linkArgs = linkSteps[0]![1];
  assert.ok(linkArgs.includes("AppKit"));
  assert.ok(linkArgs.includes("AVFoundation"));
  assert.ok(linkArgs.includes("Speech"));
  assert.deepEqual(linkArgs.slice(-2), ["-o", "build/native/host.node"]);
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
    /asar: \{ unpack: "\*\*\/build\/native\/\{host\.node,gw-dat-decode\}" \}/u,
  );
  for (const kept of [
    /p === "\/build\/native"/u,
    /p === "\/build\/native\/host\.node"/u,
    /p === "\/build\/native\/gw-dat-decode"/u,
  ]) {
    assert.match(packageIgnore, kept);
  }
  assert.doesNotMatch(forge, /unpackDir|asarUnpack/u);
});
