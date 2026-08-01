import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { DISTRIBUTION_CHANNEL_CONFIG } from "../src/shared/distribution-channel.ts";

const root = path.resolve(import.meta.dirname, "..");
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("pnpm dev:signed requires native Apple Silicon macOS Node.js");
}
const profileInput = process.env.APPLE_DEVELOPMENT_PROFILE;
const identity = process.env.APPLE_DEVELOPMENT_IDENTITY;
if (!profileInput || !identity) {
  throw new Error(
    "APPLE_DEVELOPMENT_PROFILE and APPLE_DEVELOPMENT_IDENTITY are required; the identity must be its 40-character SHA-1 fingerprint.",
  );
}
const profile = realpathSync(profileInput);
const relativeProfile = path.relative(root, profile);
if (
  relativeProfile === ""
  || (!relativeProfile.startsWith("..") && !path.isAbsolute(relativeProfile))
) {
  throw new Error("APPLE_DEVELOPMENT_PROFILE must be stored outside the repository");
}

const environment = {
  ...process.env,
  GW_PACKAGE_INTENT: "development",
  APPLE_PROVISIONING_PROFILE: profile,
  APPLE_SIGNING_IDENTITY: identity,
};
const packaged = spawnSync("pnpm", ["package"], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
if (packaged.status !== 0) {
  process.exit(packaged.status ?? 1);
}

const productName = DISTRIBUTION_CHANNEL_CONFIG.development.productName;
const appPath = path.join(
  root,
  `out/${productName}-darwin-${process.arch}/${productName}.app`,
);
if (process.argv.slice(2).includes("--test-keychain")) {
  console.log(
    "Testing the signed Dev Keychain on this macOS account; the test refuses to overwrite an existing Dev login.",
  );
  const tested = spawnSync("pnpm", ["test:signed-keychain"], {
    cwd: root,
    env: {
      ...environment,
      GW_ALLOW_LOCAL_SIGNED_KEYCHAIN_TEST: "1",
      GW_SIGNED_APP_PATH: appPath,
      GW_SIGNED_CHANNEL: "development",
    },
    stdio: "inherit",
  });
  process.exit(tested.status ?? 1);
}
const executable = path.join(
  appPath,
  `Contents/MacOS/${productName}`,
);
console.log(`Launching ${productName}; saved login persists only in the Dev channel.`);
const child = spawn(executable, [], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const signalHandlers = new Map<NodeJS.Signals, () => void>();
for (const signal of forwardedSignals) {
  const handler = () => child.kill(signal);
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  for (const [forwarded, handler] of signalHandlers) {
    process.off(forwarded, handler);
  }
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
