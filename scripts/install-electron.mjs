// Electron's own postinstall downloads its binary from GitHub releases, which
// sometimes answers with a short-lived 5xx. Every CI job installs, so one such
// answer failed a whole job before any test ran. A few spaced retries ride it
// out; a lasting outage still fails after the last attempt.
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const delaysMs = [10_000, 30_000];
for (let attempt = 0; ; attempt += 1) {
  const { status } = spawnSync("install-electron", { stdio: "inherit" });
  if (status === 0) break;
  const delay = delaysMs[attempt];
  if (delay === undefined) process.exit(status ?? 1);
  console.warn(`Electron download failed; retrying in ${delay / 1000} s.`);
  await sleep(delay);
}
