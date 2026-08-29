/** Disposable account-workspace shapes shared by Electron tests and developers. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gamePaths } from "../../src/main/core/paths.js";

export const LAUNCHER_FIXTURE_SCENARIOS = [
  "fresh",
  "single",
  "multi",
  "mixed",
  "interrupted",
  "corrupt",
] as const;

export type LauncherFixtureScenario = (typeof LAUNCHER_FIXTURE_SCENARIOS)[number];

const FIRST_PROFILE_ID = "2d31e565-9fc8-4dde-9fd4-9d644f8283ae";

const workspace = {
  formatVersion: 1,
  profiles: [{
    id: FIRST_PROFILE_ID,
    name: "Existing account",
    archived: false,
    templates: "private",
    builds: "private",
  }],
  deletingProfileIds: [],
} as const;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function seedLauncherProfileFixture(
  userData: string,
  scenario: LauncherFixtureScenario,
): Promise<void> {
  const paths = gamePaths(userData);
  if (scenario === "fresh") return;
  if (scenario === "single") {
    await Promise.all([
      writeJson(paths.launcherMode, { formatVersion: 1, mode: "single" }),
      writeJson(paths.settings, {}),
    ]);
    return;
  }
  if (scenario === "multi") {
    await Promise.all([
      writeJson(paths.launcherMode, { formatVersion: 1, mode: "multi" }),
      writeJson(paths.multiWorkspace, workspace),
    ]);
    return;
  }
  if (scenario === "mixed") {
    await Promise.all([
      writeJson(paths.launcherMode, { formatVersion: 1, mode: "single" }),
      writeJson(paths.settings, {}),
      writeJson(paths.multiWorkspace, workspace),
    ]);
    return;
  }
  if (scenario === "interrupted") {
    await mkdir(paths.multiRoot, { recursive: true });
    await writeFile(
      `${paths.multiWorkspace}.1234.abcdef.tmp`,
      "{\"formatVersion\":1",
      { mode: 0o600 },
    );
    return;
  }
  await mkdir(paths.multiRoot, { recursive: true });
  await writeFile(paths.multiWorkspace, "{not-json", { mode: 0o600 });
}
