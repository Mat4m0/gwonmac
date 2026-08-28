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
  CONTROLLER_PROMPT_STYLES,
  LAST_UPDATE_CHECK_AT_MAX,
  RENDER_SCALES,
  UI_PANEL_OPACITY_MAX,
  UI_PANEL_OPACITY_MIN,
  UI_FONTS,
  UI_STYLES,
  UPDATE_TRACKS,
  TOOL_NATIVE_NAMESPACES,
  type AppSettings,
} from "../src/shared/contracts.ts";
import { parseSettings, saveSettings } from "../src/main/core/settings.ts";
import {
  fitWindowStateToDisplays,
  parseWindowState,
  saveWindowState,
  type RestorableWindowState,
  type WindowBounds,
} from "../src/main/core/window-state.ts";
import { DISTRIBUTION_CHANNEL_CONFIG } from "../src/shared/distribution-channel.ts";
import { DEFAULT_CUSTOM_UI_THEME } from "../src/shared/ui-theme.ts";
import {
  compareReleaseVersions,
  parseReleaseVersion,
} from "../src/shared/release.ts";
import {
  DEFAULT_STORED_TRAVEL_SHORTCUTS,
  type StoredTravelShortcuts,
} from "../src/shared/travel.ts";
import {
  closePackagedApp,
  launchPackagedApp,
  type RunningPackagedApp,
} from "../tests/helpers/packaged-app.ts";
import {
  canonicalizeStableSettings,
  validateCandidateSettings,
} from "./release-settings-compatibility.ts";

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
const stablePath = stableApp;
const candidatePath = candidateApp;
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
const proofRoot = await mkdtemp(path.join(tmpdir(), "gwonmac-stable-beta-"));
type Cohort = Readonly<{ userData: string; windowStatePath: string }>;

async function createCohort(
  name: "core" | "tools",
  settings: Readonly<Record<string, unknown>>,
): Promise<Cohort> {
  const userData = path.join(proofRoot, name);
  const cohort = Object.freeze({
    userData,
    windowStatePath: path.join(userData, "window-state.json"),
  });
  await mkdir(path.join(userData, "game/chunks"), { recursive: true });
  await writeFile(
    path.join(userData, "settings.json"),
    JSON.stringify(settings),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(userData, "game/chunks/chunk-directory-reset-sentinel"),
    "chunk directory was not wholesale reset",
  );
  return cohort;
}

const cloneLibrary = (library: BuildLibrary): BuildLibrary =>
  JSON.parse(JSON.stringify(library)) as BuildLibrary;

async function launch(cohort: Cohort, appPath: string): Promise<RunningPackagedApp> {
  const running = await launchPackagedApp({
    appPath,
    productName,
    userData: cohort.userData,
    arguments: ["--gw-volatile-secrets"],
  });
  await running.page.waitForFunction(() => "gwNative" in globalThis);
  return running;
}

async function withPackagedApp<T>(
  cohort: Cohort,
  appPath: string,
  use: (running: RunningPackagedApp) => Promise<T>,
): Promise<T> {
  const running = await launch(cohort, appPath);
  let completed = false;
  try {
    const result = await use(running);
    completed = true;
    return result;
  } finally {
    if (completed) await closePackagedApp(running);
    else await closePackagedApp(running).catch(() => undefined);
  }
}

async function readToolsCanonical(page: Page): Promise<{
  settings: unknown;
  library: BuildLibrary;
  recovered: boolean;
}> {
  return page.evaluate(async () => {
    const api = window.gwNative;
    if (!("buildLibrary" in api)) throw new Error("Tools preload is unavailable");
    const settings = await api.settings.get();
    const library = await api.buildLibrary.get();
    return { settings, ...library };
  });
}

async function readSettingsDocument(cohort: Cohort): Promise<Record<string, unknown>> {
  const value = JSON.parse(
    await readFile(path.join(cohort.userData, "settings.json"), "utf8"),
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
const distinctModernCustomTheme = {
  material: "modern",
  window: "#18212B",
  titlebar: "#263442",
  surface: "#34495E",
  recessed: "#0D141B",
  selected: "#5B3F78",
  accent: "#5FD6C5",
  text: "#F5F7FA",
  mutedText: "#A7B4C2",
  border: "#71869A",
  windowGradient: false,
} as const satisfies AppSettings["uiCustomTheme"];
const customThemeValues: readonly AppSettings["uiCustomTheme"][] = [
  DEFAULT_CUSTOM_UI_THEME,
  distinctModernCustomTheme,
];
for (const field of Object.keys(DEFAULT_CUSTOM_UI_THEME) as Array<
  keyof AppSettings["uiCustomTheme"]
>) {
  assert.notEqual(
    distinctModernCustomTheme[field],
    DEFAULT_CUSTOM_UI_THEME[field],
    `Modern custom-theme case must change durable field ${field}`,
  );
}
const travelShortcutValues: readonly StoredTravelShortcuts[] = [
  DEFAULT_STORED_TRAVEL_SHORTCUTS,
  [],
  [
    { mapId: 55, district: "europe-english", districtNumber: 2 },
    null,
    { mapId: 449, district: "international", districtNumber: 0 },
    { mapId: 642, district: "asia-japanese", districtNumber: 1 },
    null,
    { mapId: 81, district: "america", districtNumber: 7 },
    null,
    null,
    { mapId: 857, district: "international", districtNumber: 0 },
  ],
] as const;
const domainCaseCount = Math.max(
  RENDER_SCALES.length,
  UI_STYLES.length,
  UI_FONTS.length,
  CONTROLLER_PROMPT_STYLES.length,
  opacityValues.length,
  booleanValues.length,
  UPDATE_TRACKS.length,
  updateCheckValues.length,
  compatibilityValues.length,
  customThemeValues.length,
  travelShortcutValues.length,
);
const candidateSettingsDomains = Array.from(
  { length: domainCaseCount },
  (_, index): AppSettings => {
    const settings: AppSettings = {
      renderScale: cycle(RENDER_SCALES, index),
      uiStyle: cycle(UI_STYLES, index),
      uiCustomTheme: cycle(customThemeValues, index),
      uiFont: cycle(UI_FONTS, index),
      controllerPromptStyle: cycle(CONTROLLER_PROMPT_STYLES, index),
      uiPanelOpacity: cycle(opacityValues, index),
      cartographyOverlayEnabled: cycle(booleanValues, index),
      cartographyGridEnabled: cycle(booleanValues, index + 1),
      cartographyRevealMode: cycle(["off", "normal", "birds-eye"] as const, index),
      cartographyOverlayStyle: "black",
      cartographyOverlayOpacity: cycle([0, 55, 100] as const, index),
      cartographyControlIdleOpacity: cycle([15, 35, 100] as const, index),
      cartographyOverlayCustomStyle: {
        veilColor: "#171A1C",
        outlineColor: "#E9EEE9",
        outlineWidth: cycle([0, 1, 4] as const, index),
        gridColor: "#D8E1DE",
        missingColor: "#E2B85C",
        currentColor: "#8ED8F8",
        hoverColor: "#F4F1E7",
        normalRangeColor: "#8ED8F8",
        birdsEyeRangeColor: "#C2B8FF",
      },
      gwonmacTools: cycle(booleanValues, index),
      buildLibrary: cycle(booleanValues, index + 1),
      tradeChat: cycle(booleanValues, index),
      xunlaiStorage: cycle(booleanValues, index),
      travelPalette: cycle(booleanValues, index + 1),
      travelShortcuts: cycle(travelShortcutValues, index),
      targetReadout: cycle(booleanValues, index),
      shortcutOverrides: {},
      skillKeyBindings: [null, null, null, null, null, null, null, null],
      skillKeyLabelsEnabled: cycle(booleanValues, index + 1),
      skillCooldownOverlayEnabled: cycle(booleanValues, index),
      skillCooldownColor: { kind: "preset", preset: "red" },
      extendedMemoryEnabled: cycle(booleanValues, index + 1),
      autoRelogAfterReload: cycle(booleanValues, index),
      showDiagnostics: cycle(booleanValues, index),
      dataStrategy: "full",
      autoCheckUpdates: false,
      updateTrack: cycle(UPDATE_TRACKS, index),
      lastUpdateCheckAt: cycle(updateCheckValues, index),
      compatibilityNoticeSeenFor: cycle(compatibilityValues, index),
    };
    return parseSettings(settings);
  },
);

async function proveStableAcceptsCandidateSettingDomains(
  cohort: Cohort,
  stablePath: string,
): Promise<void> {
  for (const [index, settings] of candidateSettingsDomains.entries()) {
    await saveSettings(path.join(cohort.userData, "settings.json"), settings);
    await withPackagedApp(cohort, stablePath, async (stable) => {
      const read = await stable.page.evaluate(() => window.gwNative.settings.get());
      assert.deepEqual(
        canonicalizeStableSettings(read, { disk: false }),
        settings,
        `latest Stable refused candidate settings-domain case ${index + 1}`,
      );
      assert.deepEqual(
        canonicalizeStableSettings(
          await stable.page.evaluate(() => window.gwNative.settings.set({})),
          { disk: false },
        ),
        settings,
        `latest Stable could not rewrite candidate settings-domain case ${index + 1}`,
      );
    });
    assert.deepEqual(
      canonicalizeStableSettings(await readSettingsDocument(cohort), { disk: true }),
      settings,
      `latest Stable changed candidate settings-domain case ${index + 1}`,
    );
  }
  const names = await readdir(cohort.userData);
  assert.equal(
    names.some((name) => name.startsWith("settings.json.corrupt-")),
    false,
    "latest Stable quarantined a candidate-owned settings value",
  );
}

const sortedKeys = (value: Record<string, unknown>): string[] =>
  Object.keys(value).sort();

async function readCoreCanonical(page: Page): Promise<{
  settings: Record<string, unknown>;
  toolNamespaces: readonly string[];
}> {
  const value = await page.evaluate(async (toolNamespaces) => ({
    settings: await window.gwNative.settings.get(),
    toolNamespaces: toolNamespaces.filter((name) => name in window.gwNative),
  }), TOOL_NATIVE_NAMESPACES);
  return {
    settings: validateCandidateSettings(value.settings, { disk: false }),
    toolNamespaces: value.toolNamespaces,
  };
}

async function proveCoreRoundTrip(cohort: Cohort): Promise<void> {
  await publishWindowSize(cohort, 1_000, 700);
  console.log("stable/beta compatibility: Core preload round-trip");
  const stableWindowState = await readPersistedWindowState(cohort);
  const stableSettings = await withPackagedApp(cohort, stableApp!, async (core) => {
    const settings = await core.page.evaluate(() => window.gwNative.settings.set({
      autoCheckUpdates: false,
      gwonmacTools: false,
      showDiagnostics: false,
    }));
    await roundTripProfileStore(core.page, null, "stable-core-template");
    await assertWindowMatchesPersistedState(stableWindowState, core.page);
    return canonicalizeStableSettings(settings, { disk: false });
  });
  await assertDiskSentinel(cohort);
  const candidateWindowState = await readPersistedWindowState(cohort);
  await withPackagedApp(cohort, candidateApp!, async (core) => {
    const initial = await readCoreCanonical(core.page);
    assert.deepEqual(initial.toolNamespaces, [], "candidate Core launch exposed a Tools namespace");
    assert.deepEqual(initial.settings, stableSettings, "candidate changed Stable-owned Core settings");
    assert.equal(initial.settings.buildLibrary, false, "candidate lost the legacy Apply-Team opt-out");
    const changed = validateCandidateSettings(
      await core.page.evaluate(() => window.gwNative.settings.set({ showDiagnostics: true })),
      { disk: false },
    );
    assert.deepEqual(changed, { ...stableSettings, showDiagnostics: true });
    await roundTripProfileStore(core.page, "stable-core-template", "candidate-core-template");
    await assertWindowMatchesPersistedState(candidateWindowState, core.page);
  });
  await assertDiskSentinel(cohort);
  const rollbackWindowState = await readPersistedWindowState(cohort);
  await withPackagedApp(cohort, stableApp!, async (core) => {
    const returned = canonicalizeStableSettings(
      await core.page.evaluate(() => window.gwNative.settings.get()),
      { disk: false },
    );
    assert.equal(returned.buildLibrary, false, "rollback Stable lost the Apply-Team opt-out");
    assert.deepEqual(returned, { ...stableSettings, showDiagnostics: true });
    await roundTripProfileStore(core.page, "candidate-core-template", "stable-return-core-template");
    await assertWindowMatchesPersistedState(rollbackWindowState, core.page);
  });
  await assertDiskSentinel(cohort);
}

async function assertDiskSentinel(cohort: Cohort): Promise<void> {
  assert.equal(
    await readFile(path.join(cohort.userData, "game/chunks/chunk-directory-reset-sentinel"), "utf8"),
    "chunk directory was not wholesale reset",
  );
}

const publishWindowSize = (cohort: Cohort, width: number, height: number): Promise<void> =>
  saveWindowState(cohort.windowStatePath, {
    bounds: { x: 100, y: 100, width, height },
    mode: "normal",
    // The rollback Stable ignores this additive field. The candidate requires
    // it whenever it writes the same format-1 document.
    displayWorkArea: { x: 0, y: 0, width: 1_920, height: 1_080 },
  });

async function windowSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({ width: outerWidth, height: outerHeight }));
}

async function assertWindowMatchesPersistedState(
  stored: RestorableWindowState,
  page: Page,
): Promise<void> {
  const workArea = await page.evaluate((): WindowBounds => ({
    // GitHub's ephemeral macOS release runner exposes one display at the
    // origin. The browser API provides its usable size but not a typed origin.
    x: 0,
    y: 0,
    width: screen.availWidth,
    height: screen.availHeight,
  }));
  const expected = fitWindowStateToDisplays(stored, [workArea], workArea).bounds;
  assert.deepEqual(await windowSize(page), {
    width: expected.width,
    height: expected.height,
  });
}

async function readPersistedWindowState(
  cohort: Cohort,
): Promise<RestorableWindowState> {
  return parseWindowState(JSON.parse(
    await readFile(cohort.windowStatePath, "utf8"),
  ));
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

async function proveToolsRoundTrip(toolsCohort: Cohort): Promise<void> {
  console.log("stable/beta compatibility: Stable accepts candidate value domains");
  await proveStableAcceptsCandidateSettingDomains(toolsCohort, stablePath);
  await writeFile(
    path.join(toolsCohort.userData, "settings.json"),
    JSON.stringify({
      autoCheckUpdates: false,
      gwonmacTools: true,
      teamManagement: false,
    }),
    { mode: 0o600 },
  );

  console.log("stable/beta compatibility: latest Stable creates canonical state");
  // The Electron suite owns native resize-to-disk behaviour. This release gate
  // writes through the candidate's canonical serializer so it can concentrate
  // on whether both packaged versions read the exact same durable shape.
  await publishWindowSize(toolsCohort, 1_000, 700);
  await withPackagedApp(toolsCohort, stablePath, async (running) => {
    const stableInitialSettings = canonicalizeStableSettings(
      await running.page.evaluate(() => window.gwNative.settings.get()),
      { disk: false },
    );
    assert.equal(
      stableInitialSettings.buildLibrary,
      false,
      "latest Stable lost the legacy Apply-Team opt-out before upgrade",
    );
    const launchedStableVersion = (await running.page.evaluate(
      () => window.gwNative.appUpdates.getState(),
    )).currentVersion;
    assert.equal(
      launchedStableVersion,
      stableVersion,
      "the downloaded latest-Stable ZIP launched a different version",
    );
    const stableSettings = canonicalizeStableSettings(await running.page.evaluate(() =>
      window.gwNative.settings.set({
        autoCheckUpdates: false,
        gwonmacTools: true,
        renderScale: 1.5,
        uiStyle: "obsidian",
        uiPanelOpacity: 88,
        updateTrack: "beta",
        buildLibrary: true,
      })
    ), { disk: false });
    assert.equal(stableSettings.updateTrack, "beta", "latest Stable lacks the Beta enabler");
    assert.equal(stableSettings.buildLibrary, true, "latest Stable did not enable Build Library");
    const stableTools = await readToolsCanonical(running.page);
    assert.equal(
      stableTools.recovered,
      false,
      "latest Stable recovered its fresh build library before the round-trip",
    );
    assert.deepEqual(
      await running.page.evaluate((library) => {
        const api = window.gwNative;
        if (!("buildLibrary" in api)) throw new Error("Tools preload is unavailable");
        return api.buildLibrary.set(library);
      }, initialLibrary),
      initialLibrary,
    );
    await roundTripProfileStore(running.page, null, "stable-template");
  });
  const stableSettingsDocument = await readSettingsDocument(toolsCohort);

  console.log("stable/beta compatibility: candidate reads, modifies, and writes");
  const candidateWindowState = await readPersistedWindowState(toolsCohort);
  await withPackagedApp(toolsCohort, candidatePath, async (running) => {
    assert.equal(
      (await running.page.evaluate(
        () => window.gwNative.appUpdates.getState(),
      )).currentVersion,
      candidateVersion,
      "the signed candidate app launched a different version",
    );
    const candidateInitial = await readToolsCanonical(running.page);
    const candidateInitialSettings = validateCandidateSettings(
      candidateInitial.settings,
      { disk: false },
    );
    assert.equal(candidateInitial.recovered, false);
    assert.equal(candidateInitialSettings.updateTrack, "beta");
    assert.equal(candidateInitialSettings.uiPanelOpacity, 88);
    assert.equal(candidateInitialSettings.buildLibrary, true);
    assert.deepEqual(candidateInitial.library, initialLibrary);
    await assertWindowMatchesPersistedState(candidateWindowState, running.page);
    await roundTripProfileStore(running.page, "stable-template", "candidate-template");
    await running.page.evaluate(
      async ({ settings, library }) => {
        const api = window.gwNative;
        if (!("buildLibrary" in api)) throw new Error("Tools preload is unavailable");
        await api.buildLibrary.set(library);
        await api.settings.set(settings);
      },
      {
        settings: {
          showDiagnostics: true,
          uiPanelOpacity: 87,
          buildLibrary: false,
        } satisfies Partial<AppSettings>,
        library: candidateLibrary,
      },
    );
  });
  await publishWindowSize(toolsCohort, 960, 680);
  const candidateSettingsDocument = await readSettingsDocument(toolsCohort);
  assert.deepEqual(
    sortedKeys(validateCandidateSettings(candidateSettingsDocument, { disk: true })),
    sortedKeys(canonicalizeStableSettings(stableSettingsDocument, { disk: true })),
    "candidate introduced or removed a durable settings key; ship the schema expansion in Stable before the beta/RC uses it",
  );

  console.log("stable/beta compatibility: the same Stable reads and writes again");
  const rollbackWindowState = await readPersistedWindowState(toolsCohort);
  const expectedFinalSettings: Record<string, unknown> = {
    ...validateCandidateSettings(candidateSettingsDocument, { disk: true }),
    showDiagnostics: false,
    updateTrack: "stable",
  };
  await withPackagedApp(toolsCohort, stablePath, async (running) => {
    assert.equal(
      (await running.page.evaluate(
        () => window.gwNative.appUpdates.getState(),
      )).currentVersion,
      stableVersion,
      "the return launch did not use the exact Stable baseline",
    );
    const returnedSettings = canonicalizeStableSettings(
      await running.page.evaluate(() => window.gwNative.settings.get()),
      { disk: false },
    );
    assert.equal(returnedSettings.buildLibrary, false, "rollback Stable lost the opt-out");
    assert.deepEqual(
      returnedSettings,
      validateCandidateSettings(candidateSettingsDocument, { disk: true }),
      "Stable did not read every candidate-written settings value",
    );
    await running.page.evaluate(() => window.gwNative.settings.set({ buildLibrary: true }));
    const returned = await readToolsCanonical(running.page);
    assert.equal(returned.recovered, false);
    assert.deepEqual(returned.library, candidateLibrary);
    await assertWindowMatchesPersistedState(rollbackWindowState, running.page);
    await roundTripProfileStore(running.page, "candidate-template", "stable-return-template");
    await running.page.evaluate(
      async ({ settings, library }) => {
        const api = window.gwNative;
        if (!("buildLibrary" in api)) throw new Error("Tools preload is unavailable");
        await api.buildLibrary.set(library);
        await api.settings.set(settings);
      },
      {
        settings: {
          showDiagnostics: false,
          updateTrack: "stable",
          buildLibrary: false,
        } satisfies Partial<AppSettings>,
        library: finalLibrary,
      },
    );
    const finalSettings = canonicalizeStableSettings(
      await running.page.evaluate(() => window.gwNative.settings.get()),
      { disk: false },
    );
    assert.equal(finalSettings.buildLibrary, false, "Stable save enabled Apply Team");
    assert.deepEqual(
      finalSettings,
      expectedFinalSettings,
      "Stable lost candidate-written settings while saving its own patch",
    );
  });

  const names = await readdir(toolsCohort.userData);
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
  const diskSettings = await readSettingsDocument(toolsCohort);
  assert.deepEqual(
    canonicalizeStableSettings(diskSettings, { disk: true }),
    expectedFinalSettings,
  );
  const diskLibrary = JSON.parse(await readFile(
    path.join(toolsCohort.userData, "build-library.json"),
    "utf8",
  ));
  assert.deepEqual(diskLibrary, finalLibrary);
  assert.ok(await readFile(toolsCohort.windowStatePath, "utf8"));
  assert.equal(
    await readFile(
      path.join(toolsCohort.userData, "game/chunks/chunk-directory-reset-sentinel"),
      "utf8",
    ),
    "chunk directory was not wholesale reset",
  );
  console.log(`stable/beta compatibility: ${stableVersion} → ${candidateVersion} → ${stableVersion} passed`);
}

try {
  const coreCohort = await createCohort(
    "core",
    { autoCheckUpdates: false, gwonmacTools: false, teamManagement: false },
  );
  const toolsCohort = await createCohort(
    "tools",
    { autoCheckUpdates: false, gwonmacTools: true },
  );
  await proveCoreRoundTrip(coreCohort);
  await proveToolsRoundTrip(toolsCohort);
} finally {
  await rm(proofRoot, { recursive: true, force: true });
}
