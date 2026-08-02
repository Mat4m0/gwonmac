// Everything a release asserts about a signed package, in one command a
// developer can run against a build sitting on their own disk.
//
//   GW_SIGNED_CHANNEL=release \
//   APPLE_PROVISIONING_PROFILE=/path/outside/the/repo/gwonmac.provisionprofile \
//   pnpm verify:signed-app \
//     "out/Guild Wars Reforged-darwin-arm64/Guild Wars Reforged.app" \
//     "out/make/Guild Wars Reforged.dmg"
//
// The disk image is optional because the ZIP the updater installs contains an
// application and no image. Everything else is required, and the application
// must already be notarized and stapled: the Gatekeeper assessment and the
// ticket are part of what is proved, so an unnotarized build fails here rather
// than passing a quieter version of the same check.
//
// It owns no expectation of its own. What an approved package looks like is
// scripts/apple-signing.ts — the same table the signer is driven by — so a
// signing change cannot leave the verifier agreeing with a rule that moved.
// It refuses to build, sign, notarize, staple, or publish anything.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  approvedDistributionEntitlements,
  distributionAuthorityName,
  distributionOptionsForFile,
  matchesExactEntitlements,
} from "./apple-signing.ts";
import {
  APPLE_TEAM_ID,
  DISTRIBUTION_CHANNEL_CONFIG,
  isDistributionChannel,
  type DistributionChannel,
} from "../src/shared/distribution-channel.ts";

// Electron ships four helper applications, and exactly one of them is the
// Plugin helper — the only target allowed to disable library validation and
// map unsigned executable memory. A fifth helper, or a second plugin, is
// signing surface nobody approved.
const HELPERS = 4;
const PLUGIN_HELPERS = 1;

function fail(message: string): never {
  throw new Error(`Signed package verification failed: ${message}`);
}

function capture(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  // codesign, spctl and stapler report on stderr even when they succeed.
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited ${result.status}\n${output}`);
  }
  return output;
}

function expectSignature(target: string, required: readonly string[]): void {
  const signature = capture("codesign", ["-dv", "--verbose=4", target]);
  for (const needle of required) {
    if (!signature.includes(needle)) {
      fail(`${target} signature has no ${needle}\n${signature}`);
    }
  }
}

function signedEntitlements(target: string): unknown {
  const signed = spawnSync("codesign", ["-d", "--entitlements", ":-", target]);
  if (signed.error) throw signed.error;
  if (signed.status !== 0) fail(`${target} has no readable entitlements`);
  const converted = spawnSync(
    "plutil",
    ["-convert", "json", "-o", "-", "--", "-"],
    { input: signed.stdout, encoding: "utf8" },
  );
  if (converted.status !== 0) {
    fail(`${target} entitlements are not a property list`);
  }
  return JSON.parse(converted.stdout) as unknown;
}

function verifyHelpers(channel: DistributionChannel, application: string): void {
  const frameworks = path.join(application, "Contents/Frameworks");
  const helpers = readdirSync(frameworks)
    .filter((entry) => entry.includes("Helper") && entry.endsWith(".app"))
    .map((entry) => path.join(frameworks, entry));
  const plugins = helpers.filter((helper) =>
    helper.includes("Helper (Plugin).app"),
  );
  if (helpers.length !== HELPERS || plugins.length !== PLUGIN_HELPERS) {
    fail(
      `${application} carries ${helpers.length} helpers and ${plugins.length} `
        + `plugin helpers, not ${HELPERS} and ${PLUGIN_HELPERS}`,
    );
  }
  for (const helper of helpers) {
    const approved = distributionOptionsForFile(channel, helper).entitlements;
    if (!Array.isArray(approved)) {
      fail(`${helper} is not signed as a helper application`);
    }
    const expected = Object.fromEntries(approved.map((key) => [key, true]));
    if (!matchesExactEntitlements(signedEntitlements(helper), expected)) {
      fail(`${helper} is not signed with exactly ${approved.join(", ")}`);
    }
    expectSignature(helper, [
      `TeamIdentifier=${APPLE_TEAM_ID}`,
      "Runtime Version",
      "Timestamp=",
    ]);
  }
}

function verifyApplication(
  channel: DistributionChannel,
  application: string,
  profile: string,
): void {
  capture("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    application,
  ]);
  expectSignature(application, [
    `Authority=${distributionAuthorityName(channel)}`,
    `TeamIdentifier=${APPLE_TEAM_ID}`,
    "Runtime Version",
    "Timestamp=",
  ]);
  const bundleId = capture("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    path.join(application, "Contents/Info.plist"),
  ]).trim();
  if (bundleId !== DISTRIBUTION_CHANNEL_CONFIG[channel].bundleId) {
    fail(`${application} is ${bundleId}, which is not the ${channel} bundle`);
  }
  const embedded = readFileSync(
    path.join(application, "Contents/embedded.provisionprofile"),
  );
  if (!embedded.equals(readFileSync(profile))) {
    fail(`${application} embeds a provisioning profile other than ${profile}`);
  }
  if (
    !matchesExactEntitlements(
      signedEntitlements(application),
      approvedDistributionEntitlements(channel),
    )
  ) {
    fail(`${application} is not signed with the approved ${channel} entitlements`);
  }
  verifyHelpers(channel, application);
  capture("xcrun", ["stapler", "validate", "-v", application]);
  capture("spctl", ["--assess", "--type", "execute", "--verbose=4", application]);
}

function verifyDiskImage(channel: DistributionChannel, diskImage: string): void {
  capture("codesign", ["--verify", "--verbose=2", diskImage]);
  expectSignature(diskImage, [
    `Authority=${distributionAuthorityName(channel)}`,
    `TeamIdentifier=${APPLE_TEAM_ID}`,
    "Timestamp=",
  ]);
  capture("xcrun", ["stapler", "validate", "-v", diskImage]);
  // Gatekeeper assesses an image the way an opening user does, against the
  // image's own signature rather than a quarantine record it has not got yet.
  capture("spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=4",
    diskImage,
  ]);
}

const args = process.argv.slice(2);
const [application, diskImage] = args;
const channel = process.env.GW_SIGNED_CHANNEL;
const profile = process.env.APPLE_PROVISIONING_PROFILE;
// Only an absent second argument means a package with no disk image. An empty
// one is a caller whose lookup found nothing, and skipping the image
// assertions for it would let a release pass by verifying less than it asked
// to.
if (
  !application
  || !isDistributionChannel(channel)
  || !profile
  || (args.length > 1 && !diskImage)
) {
  throw new Error(
    "usage: GW_SIGNED_CHANNEL=<channel> APPLE_PROVISIONING_PROFILE=<profile> "
      + "verify-signed-app <application> [<disk image>]",
  );
}
verifyApplication(channel, application, profile);
if (diskImage) verifyDiskImage(channel, diskImage);
console.log(`Verified the signed ${channel} package at ${application}.`);
