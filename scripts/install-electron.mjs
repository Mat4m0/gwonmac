// Electron's own postinstall downloads its binary from GitHub releases, which
// sometimes answers with 5xx for a minute or two. Every CI job installs, so one
// such answer failed a whole job before any test ran. Spaced retries ride it
// out; a lasting outage still fails after the last attempt.
//
// ELECTRON_SKIP_BINARY_DOWNLOAD=1 skips the download for jobs that never start
// Electron. Electron's installer dropped that switch, so it lives here.
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === "1") process.exit(0);

const delaysMs = [10_000, 30_000, 60_000];
for (let attempt = 0; ; attempt += 1) {
  const { status } = spawnSync("install-electron", { stdio: "inherit" });
  if (status === 0) break;
  const delay = delaysMs[attempt];
  if (delay === undefined) process.exit(status ?? 1);
  console.warn(`Electron download failed; retrying in ${delay / 1000} s.`);
  await sleep(delay);
}
