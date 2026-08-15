/**
 * Release-only proof that a public beta/RC leaves canonical player data
 * readable and writable by the latest Stable binary.
 *
 * This intentionally launches the two signed app bundles, not two source
 * checkouts. It is the stable-enabler gate for the first Beta and the recurring
 * compatibility gate after that. There is no migration framework: if a
 * candidate adds a durable settings key or accepted value that Stable does not
 * already own, or changes any durable shape in a way Stable cannot round-trip,
 * the release is refused. New settings therefore expand in Stable first and
 * may be used by a later candidate; old fields contract only after the
 * supported Stable baseline no longer needs them.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import {
  LIBRARY_VERSION,
  buildId,
  heroId,
  skillBarOf,
  skillId,
  teamId,
  teamSlotsOf,
  type Build,
  type BuildLibrary,
} from "../src/shared/builds/library.ts";
import {
  DATA_STRATEGIES,
  LAST_UPDATE_CHECK_AT_MAX,
  RENDER_SCALES,
  UI_PANEL_OPACITY_MAX,
  UI_PANEL_OPACITY_MIN,
  UI_FONTS,
  UI_STYLES,
  UPDATE_TRACKS,
  type AppSettings,
} from "../src/shared/contracts.ts";
import { parseSettings } from "../src/main/core/settings.ts";
import { DISTRIBUTION_CHANNEL_CONFIG } from "../src/shared/distribution-channel.ts";
import {
  compareReleaseVersions,
  parseReleaseVersion,
} from "../src/shared/release.ts";
import {
  closePackagedApp,
  launchPackagedApp,
  type RunningPackagedApp,
} from "../tests/helpers/packaged-app.ts";

const stableApp = process.env.GW_STABLE_APP_PATH;
const stableVersion = process.env.GW_STABLE_VERSION;
const candidateApp = process.env.GW_CANDIDATE_APP_PATH;
const candidateVersion = process.env.GW_CANDIDATE_VERSION;
if (
  process.env.GITHUB_ACTIONS !== "true"
  && process.env.GW_ALLOW_LOCAL_STABLE_BETA_TEST !== "1"
) {
  throw new Error(
    "the Stable/Beta round-trip requires an ephemeral release runner or GW_ALLOW_LOCAL_STABLE_BETA_TEST=1",
  );
}
if (!stableApp || !stableVersion || !candidateApp || !candidateVersion) {
  throw new Error(
    "GW_STABLE_APP_PATH, GW_STABLE_VERSION, GW_CANDIDATE_APP_PATH, and GW_CANDIDATE_VERSION are required",
  );
}
const parsedStable = parseReleaseVersion(stableVersion);
if (!parsedStable || parsedStable.channel !== "stable") {
  throw new Error("GW_STABLE_VERSION must name an exact Stable release");
}
const parsedCandidate = parseReleaseVersion(candidateVersion);
if (
  !parsedCandidate
  || (parsedCandidate.channel !== "beta" && parsedCandidate.channel !== "rc")
) {
  throw new Error("the Stable/Beta round-trip runs only for a beta or RC candidate");
}
if (compareReleaseVersions(parsedCandidate, parsedStable) <= 0) {
  throw new Error(
    `candidate ${candidateVersion} must be newer than Stable ${stableVersion}`,
  );
}

const productName = DISTRIBUTION_CHANNEL_CONFIG.release.productName;
const userData = await mkdtemp(path.join(tmpdir(), "gwonmac-stable-beta-"));
await writeFile(
  path.join(userData, "settings.json"),
  JSON.stringify({ autoCheckUpdates: false }),
  { mode: 0o600 },
);
await mkdir(path.join(userData, "game/chunks"), { recursive: true });
await writeFile(
  path.join(userData, "game/chunks/chunk-directory-reset-sentinel"),
  "chunk directory was not wholesale reset",
);

const cloneLibrary = (library: BuildLibrary): BuildLibrary =>
  JSON.parse(JSON.stringify(library)) as BuildLibrary;

async function launch(appPath: string): Promise<RunningPackagedApp> {
  const running = await launchPackagedApp({
    appPath,
    productName,
    userData,
    arguments: ["--gw-volatile-secrets"],
  });
  await running.page.waitForFunction(() => "gwNative" in globalThis);
  return running;
}

async function readCanonical(page: Page): Promise<{
  settings: AppSettings;
  library: BuildLibrary;
  recovered: boolean;
}> {
  return page.evaluate(async () => {
    const settings = await window.gwNative.settings.get();
    const library = await window.gwNative.buildLibrary.get();
    return { settings, ...library };
  });
}

async function readSettingsDocument(): Promise<Record<string, unknown>> {
  const value = JSON.parse(
    await readFile(path.join(userData, "settings.json"), "utf8"),
  ) as unknown;
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "settings.json is not an object",
  );
  return value as Record<string, unknown>;
}

const cycle = <T>(values: readonly T[], index: number): T =>
  values[index % values.length] as T;

const booleanValues = [false, true] as const;
const opacityValues = [UI_PANEL_OPACITY_MIN, UI_PANEL_OPACITY_MAX] as const;
const updateCheckValues = [null, 0, LAST_UPDATE_CHECK_AT_MAX] as const;
const compatibilityValues = [null, "a".repeat(64)] as const;
const domainCaseCount = Math.max(
  RENDER_SCALES.length,
  UI_STYLES.length,
  UI_FONTS.length,
  opacityValues.length,
  booleanValues.length,
  DATA_STRATEGIES.length,
  UPDATE_TRACKS.length,
  updateCheckValues.length,
  compatibilityValues.length,
);
const candidateSettingsDomains = Array.from(
  { length: domainCaseCount },
  (_, index): AppSettings => {
    const settings: AppSettings = {
      renderScale: cycle(RENDER_SCALES, index),
      uiStyle: cycle(UI_STYLES, index),
      uiFont: cycle(UI_FONTS, index),
      uiPanelOpacity: cycle(opacityValues, index),
      gwonmacTools: cycle(booleanValues, index),
      teamManagement: cycle(booleanValues, index + 1),
      xunlaiStorage: cycle(booleanValues, index),
      travelPalette: cycle(booleanValues, index + 1),
      travelShortcuts: [],
      targetReadout: cycle(booleanValues, index),
      shortcutOverrides: {},
      extendedMemoryEnabled: cycle(booleanValues, index + 1),
      showDiagnostics: cycle(booleanValues, index),
      dataStrategy: cycle(DATA_STRATEGIES, index),
      autoCheckUpdates: false,
      updateTrack: cycle(UPDATE_TRACKS, index),
      lastUpdateCheckAt: cycle(updateCheckValues, index),
      compatibilityNoticeSeenFor: cycle(compatibilityValues, index),
    };
    return parseSettings(settings);
  },
);

async function proveStableAcceptsCandidateSettingDomains(
  stablePath: string,
): Promise<void> {
  for (const [index, settings] of candidateSettingsDomains.entries()) {
    await writeFile(
      path.join(userData, "settings.json"),
      JSON.stringify({ formatVersion: 1, ...settings }),
      { mode: 0o600 },
    );
    const stable = await launch(stablePath);
    try {
      const read = await stable.page.evaluate(() => window.gwNative.settings.get());
      assert.deepEqual(
        read,
        settings,
        `latest Stable refused candidate settings-domain case ${index + 1}`,
      );
      assert.deepEqual(
        await stable.page.evaluate(() => window.gwNative.settings.set({})),
        settings,
        `latest Stable could not rewrite candidate settings-domain case ${index + 1}`,
      );
    } finally {
      await closePackagedApp(stable);
    }
    assert.deepEqual(
      semanticSettings(await readSettingsDocument()),
      settings,
      `latest Stable changed candidate settings-domain case ${index + 1}`,
    );
  }
  const names = await readdir(userData);
  assert.equal(
    names.some((name) => name.startsWith("settings.json.corrupt-")),
    false,
    "latest Stable quarantined a candidate-owned settings value",
  );
}

const sortedKeys = (value: Record<string, unknown>): string[] =>
  Object.keys(value).sort();

function semanticSettings(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const { formatVersion, ...settings } = document;
  assert.equal(formatVersion, 1, "settings.json formatVersion changed");
  return settings;
}

async function setWindowSize(page: Page, width: number, height: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width, height },
    });
  } finally {
    await session.detach();
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

async function windowSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({ width: outerWidth, height: outerHeight }));
}

/**
 * Exercise origin-owned browser storage with both embedded Chromium versions.
 * This proves origin continuity, not Emscripten's IDBFS schema or filesystem
 * calls. A real IDBFS/template round-trip is a separate release gate whenever
 * Electron, Chromium, or the filesystem/persistence contract changes.
 */
async function roundTripProfileStore(
  page: Page,
  expected: string | null,
  next: string,
): Promise<void> {
  await page.evaluate(async ({ expected: wanted, next: replacement }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gwonmac-stable-beta-proof", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("templates");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const current = await new Promise<string | null>((resolve, reject) => {
        const request = database
          .transaction("templates", "readonly")
          .objectStore("templates")
          .get("player-template");
        request.onsuccess = () => resolve(
          typeof request.result === "string" ? request.result : null,
        );
        request.onerror = () => reject(request.error);
      });
      if (current !== wanted) {
        throw new Error(`profile storage held ${JSON.stringify(current)}, expected ${JSON.stringify(wanted)}`);
      }
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("templates", "readwrite");
        transaction.objectStore("templates").put(replacement, "player-template");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, { expected, next });
}

const build = (id: string, name: string, parent: string | null): Build => ({
  id: buildId(id),
  name,
  professions: ["Mo", "Me"],
  skills: skillBarOf((slot) => slot < 2 ? skillId(100 + slot) : null),
  attributes: { HealingPrayers: 12, DivineFavor: 9 },
  tags: ["support", "HM"],
  notes: `${name} notes`,
  favourite: name === "Child",
  lastUsed: 1_725_000_000_000,
  parent: parent === null ? null : buildId(parent),
  origin: "stable/beta release proof",
});

const initialLibrary = cloneLibrary({
  version: LIBRARY_VERSION,
  tags: ["existing", "support", "HM"],
  builds: [build("root", "Root", null), build("child", "Child", "root")],
  teams: [{
    id: teamId("team"),
    name: "Complete team",
    tags: ["HM"],
    mode: "hard",
    favourite: true,
    lastUsed: 1_725_000_000_001,
    notes: "Team notes",
    slots: teamSlotsOf((slot) => slot === 0
      ? { hero: null, build: buildId("child"), behaviour: null }
      : slot === 1 || slot === 2
        ? {
            hero: heroId(slot === 1 ? 6 : 7),
            build: buildId("child"),
            behaviour: "guard",
          }
        : { hero: null, build: null, behaviour: null }),
  }],
});
const candidateLibrary: BuildLibrary = {
  ...initialLibrary,
  tags: [...initialLibrary.tags, "candidate-roundtrip"],
  builds: initialLibrary.builds.map((build, index) =>
    index === 0
      ? { ...build, notes: `${build.notes}\nWritten by ${candidateVersion}`.trim() }
      : build
  ),
};
const finalLibrary: BuildLibrary = {
  ...candidateLibrary,
  tags: [...candidateLibrary.tags, "stable-return"],
};

let running: RunningPackagedApp | null = null;
try {
  console.log("stable/beta compatibility: Stable accepts candidate value domains");
  await proveStableAcceptsCandidateSettingDomains(stableApp);
  await writeFile(
    path.join(userData, "settings.json"),
    JSON.stringify({ autoCheckUpdates: false }),
    { mode: 0o600 },
  );

  console.log("stable/beta compatibility: latest Stable creates canonical state");
  running = await launch(stableApp);
  const launchedStableVersion = (await running.page.evaluate(
    () => window.gwNative.appUpdates.getState(),
  )).currentVersion;
  assert.equal(
    launchedStableVersion,
    stableVersion,
    "the downloaded latest-Stable ZIP launched a different version",
  );
  const stableSettings = await running.page.evaluate(() =>
    window.gwNative.settings.set({
      autoCheckUpdates: false,
      renderScale: 1.5,
      uiStyle: "obsidian",
      uiPanelOpacity: 88,
      updateTrack: "beta",
    })
  );
  assert.equal(stableSettings.updateTrack, "beta", "latest Stable lacks the Beta enabler");
  assert.deepEqual(
    await running.page.evaluate((library) => window.gwNative.buildLibrary.set(library), initialLibrary),
    initialLibrary,
  );
  await roundTripProfileStore(running.page, null, "stable-template");
  await setWindowSize(running.page, 1_000, 700);
  await closePackagedApp(running);
  running = null;
  const stableSettingsDocument = await readSettingsDocument();

  console.log("stable/beta compatibility: candidate reads, modifies, and writes");
  running = await launch(candidateApp);
  assert.equal(
    (await running.page.evaluate(
      () => window.gwNative.appUpdates.getState(),
    )).currentVersion,
    candidateVersion,
    "the signed candidate app launched a different version",
  );
  const candidateInitial = await readCanonical(running.page);
  assert.equal(candidateInitial.recovered, false);
  assert.equal(candidateInitial.settings.updateTrack, "beta");
  assert.equal(candidateInitial.settings.uiPanelOpacity, 88);
  assert.deepEqual(candidateInitial.library, initialLibrary);
  assert.deepEqual(await windowSize(running.page), { width: 1_000, height: 700 });
  await roundTripProfileStore(running.page, "stable-template", "candidate-template");
  await running.page.evaluate(
    async ({ settings, library }) => {
      await window.gwNative.settings.set(settings);
      await window.gwNative.buildLibrary.set(library);
    },
    {
      settings: {
        showDiagnostics: true,
        uiPanelOpacity: 87,
      } satisfies Partial<AppSettings>,
      library: candidateLibrary,
    },
  );
  await setWindowSize(running.page, 960, 680);
  await closePackagedApp(running);
  running = null;
  const candidateSettingsDocument = await readSettingsDocument();
  assert.deepEqual(
    sortedKeys(candidateSettingsDocument),
    sortedKeys(stableSettingsDocument),
    "candidate introduced or removed a durable settings key; ship the schema expansion in Stable before the beta/RC uses it",
  );

  console.log("stable/beta compatibility: the same Stable reads and writes again");
  running = await launch(stableApp);
  assert.equal(
    (await running.page.evaluate(
      () => window.gwNative.appUpdates.getState(),
    )).currentVersion,
    stableVersion,
    "the return launch did not use the exact Stable baseline",
  );
  const returned = await readCanonical(running.page);
  assert.equal(returned.recovered, false);
  assert.deepEqual(
    returned.settings,
    semanticSettings(candidateSettingsDocument),
    "Stable did not read every candidate-written settings value",
  );
  assert.deepEqual(returned.library, candidateLibrary);
  assert.deepEqual(await windowSize(running.page), { width: 960, height: 680 });
  await roundTripProfileStore(running.page, "candidate-template", "stable-return-template");
  await running.page.evaluate(
    async ({ settings, library }) => {
      await window.gwNative.settings.set(settings);
      await window.gwNative.buildLibrary.set(library);
    },
    {
      settings: {
        showDiagnostics: false,
        updateTrack: "stable",
      } satisfies Partial<AppSettings>,
      library: finalLibrary,
    },
  );
  const final = await readCanonical(running.page);
  const expectedFinalSettings = {
    ...semanticSettings(candidateSettingsDocument),
    showDiagnostics: false,
    updateTrack: "stable",
  };
  assert.deepEqual(
    final.settings,
    expectedFinalSettings,
    "Stable lost candidate-written settings while saving its own patch",
  );
  assert.deepEqual(final.library, finalLibrary);
  await closePackagedApp(running);
  running = null;

  const names = await readdir(userData);
  assert.equal(
    names.some((name) => name.startsWith("settings.json.corrupt-")),
    false,
    "Stable quarantined candidate-written settings",
  );
  assert.equal(
    names.some((name) => name.startsWith("build-library.json.corrupt-")),
    false,
    "Stable quarantined the candidate-written Build library",
  );
  const diskSettings = await readSettingsDocument();
  assert.deepEqual(diskSettings, {
    formatVersion: 1,
    ...expectedFinalSettings,
  });
  const diskLibrary = JSON.parse(await readFile(path.join(userData, "build-library.json"), "utf8"));
  assert.deepEqual(diskLibrary, finalLibrary);
  assert.ok(await readFile(path.join(userData, "window-state.json"), "utf8"));
  assert.equal(
    await readFile(
      path.join(userData, "game/chunks/chunk-directory-reset-sentinel"),
      "utf8",
    ),
    "chunk directory was not wholesale reset",
  );
  console.log(`stable/beta compatibility: ${stableVersion} → ${candidateVersion} → ${stableVersion} passed`);
} finally {
  if (running) await closePackagedApp(running).catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
