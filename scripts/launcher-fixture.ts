/** Launch one disposable unified-launcher scenario without real player data. */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedCachedClient } from "../tests/helpers/cached-client.js";
import {
  LAUNCHER_FIXTURE_SCENARIOS,
  seedLauncherProfileFixture,
  type LauncherFixtureScenario,
} from "../tests/helpers/launcher-profile-fixtures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenario = process.argv[2] as LauncherFixtureScenario | undefined;
const keep = process.argv.includes("--keep");
if (!scenario || !LAUNCHER_FIXTURE_SCENARIOS.includes(scenario)) {
  throw new Error(`usage: pnpm launcher:fixture <${LAUNCHER_FIXTURE_SCENARIOS.join("|")}> [--keep]`);
}

const userData = await mkdtemp(path.join(tmpdir(), `gwonmac-${scenario}-`));
console.log(`Launcher fixture: ${userData}`);
await seedCachedClient({
  artifacts: path.join(userData, "game", "artifacts"),
  userData,
}, {
  beforeSeal: () => seedLauncherProfileFixture(userData, scenario),
});

const electron = path.join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const child = spawn(electron, [".", `--user-data-dir=${userData}`], {
  cwd: root,
  env: {
    ...process.env,
    GW_REQUIRE_CACHED_CLIENT: "1",
    GW_BACKGROUND_LAUNCH: "0",
  },
  stdio: "inherit",
});
const exitCode = await new Promise<number | null>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (exitCode === 0 && !keep) {
  await rm(userData, { recursive: true, force: true });
  console.log("Fixture removed after a clean exit.");
} else {
  console.log(`Fixture retained: ${userData}`);
}
process.exitCode = exitCode ?? 1;
