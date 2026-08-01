import { signAsync } from "@electron/osx-sign";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  distributionEntitlementsPath,
  distributionSigningOptions,
} from "./apple-signing.ts";
import {
  distributionMarker,
  isDistributionChannel,
} from "../src/shared/distribution-channel.ts";

const app = process.env.GW_SIGN_APP_PATH;
const channel = process.env.GW_SIGN_CHANNEL;
const identity = process.env.APPLE_SIGNING_IDENTITY;
const keychain = process.env.APPLE_KEYCHAIN;
const profile = process.env.APPLE_PROVISIONING_PROFILE;
if (!app || !isDistributionChannel(channel) || !identity || !keychain || !profile) {
  throw new Error(
    "GW_SIGN_APP_PATH, a known GW_SIGN_CHANNEL, APPLE_SIGNING_IDENTITY, APPLE_KEYCHAIN, and APPLE_PROVISIONING_PROFILE are required",
  );
}
const entitlements = distributionEntitlementsPath(channel);
const signing = distributionSigningOptions({
  channel,
  identity,
  keychain,
  profile,
  entitlements,
});
await writeFile(
  path.join(app, "Contents/Resources/distribution-channel.json"),
  `${JSON.stringify(distributionMarker(channel))}\n`,
  { mode: 0o644, flag: "wx" },
);
await signAsync({
  app,
  platform: "darwin",
  ...signing,
});
