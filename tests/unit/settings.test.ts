import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS,
  LAST_UPDATE_CHECK_AT_MAX,
  type RendererSettingsPatch,
} from "../../src/shared/contracts.js";
import { DEFAULT_CUSTOM_UI_THEME } from "../../src/shared/ui-theme.js";
import { AppError } from "../../src/shared/errors.js";
import {
  CARTOGRAPHY_BUILTIN_PRESETS,
  type CartographyPresetRef,
} from "../../src/shared/cartography-overlay.js";
import {
  loadSettings,
  parseSettings,
  parseSettingsPatch,
  parseRendererSettingsPatch,
  saveSettings,
} from "../../src/main/core/settings.js";

describe("settings", () => {
  it("makes preset selection and library replacement exclusive for renderer callers", () => {
    const accepts = (patch: RendererSettingsPatch): RendererSettingsPatch => patch;
    const selection: CartographyPresetRef = { kind: "builtin", id: "monochrome" };
    assert.deepEqual(accepts({ cartographyPresetSelection: selection }), {
      cartographyPresetSelection: selection,
    });
    const invalid: RendererSettingsPatch = {
      cartographyPresetSelection: selection,
      // @ts-expect-error A semantic selection cannot carry a stale library snapshot.
      cartographyPresetLibrary: DEFAULT_SETTINGS.cartographyPresetLibrary,
    };
    assert.ok(invalid);
  });

  it("exposes the documented defaults", () => {
    assert.deepEqual(DEFAULT_SETTINGS, {
      renderScale: 2,
      uiStyle: "guild-wars",
      uiCustomTheme: DEFAULT_CUSTOM_UI_THEME,
      uiFont: "guild-wars",
      controllerPromptStyle: "game-default",
      uiPanelOpacity: 94,
      cartographyEnabled: true,
      characterSwitchEnabled: true,
      cartographyOverlayEnabled: false,
      cartographyGridEnabled: false,
      cartographyCompassGridEnabled: false,
      cartographyRevealMode: "off",
      cartographyPresetLibrary: DEFAULT_SETTINGS.cartographyPresetLibrary,
      cartographyWalkabilityOpacity: 55,
      cartographyGridOpacity: 65,
      cartographyControlIdleOpacity: 35,
      gwonmacTools: false,
      buildLibrary: true,
      tradeChat: true,
      xunlaiStorage: false,
      travelPalette: true,
      characterSwitchProfession: true,
      characterSwitchLevel: true,
      characterSwitchLocation: true,
      travelShortcuts: DEFAULT_SETTINGS.travelShortcuts,
      targetReadout: false,
      shortcutOverrides: {},
      skillKeyBindings: [null, null, null, null, null, null, null, null],
      skillKeyLabelsEnabled: false,
      chatFiltersEnabled: false,
      chatFilterAllyDrops: true,
      chatFilterHallOfHeroes: true,
      chatFilterTitleAchievements: true,
      skillCooldownOverlayEnabled: true,
      quickItemMove: false,
      skillCooldownColor: { kind: "preset", preset: "red" },
      extendedMemoryEnabled: false,
      autoRelogAfterReload: false,
      showDiagnostics: false,
      dataStrategy: "full",
      // Automatic app-update checks remain a separate preference from the
      // required ArenaNet game-data download.
      autoCheckUpdates: true,
      updateTrack: "stable",
      lastUpdateCheckAt: null,
      // No client build has been warned about yet, so every build warns once.
      compatibilityNoticeSeenFor: null,
    });
  });

  it("defaults the Compass grid off for existing settings and validates its opt-in", () => {
    assert.equal(parseSettings({ cartographyGridEnabled: true }).cartographyCompassGridEnabled, false);
    assert.deepEqual(parseSettingsPatch({ cartographyCompassGridEnabled: true }), { cartographyCompassGridEnabled: true });
    assert.throws(() => parseSettingsPatch({ cartographyCompassGridEnabled: "true" }), AppError);
  });

  it("drops retired cursor fields from an alpha profile", () => {
    // A profile written before the cursor became a boolean carries
    // `cursorTheme` and a selectable input mode. They are unknown fields now,
    // so they are ignored rather than rejected: nothing else the player chose
    // may be lost with them.
    //
    // Such a profile also predates the default flip. It gets the new default
    // rather than the old one — an alpha install that never expressed a
    // preference is not an install that said no.
    const got = parseSettings({
      cursorTheme: "guild-wars-2",
      renderScale: 1,
      touchMode: "off",
      showDiagnostics: true,
    });
    assert.equal("cursorTheme" in got, false);
    assert.equal("nativeCursor" in got, false);
    assert.deepEqual(got, {
      uiPanelOpacity: 94,
      renderScale: 1,
      uiStyle: "guild-wars",
      uiCustomTheme: DEFAULT_CUSTOM_UI_THEME,
      uiFont: "guild-wars",
      controllerPromptStyle: "game-default",
      cartographyEnabled: true,
      characterSwitchEnabled: true,
      cartographyOverlayEnabled: false,
      cartographyGridEnabled: false,
      cartographyCompassGridEnabled: false,
      cartographyRevealMode: "off",
      cartographyPresetLibrary: DEFAULT_SETTINGS.cartographyPresetLibrary,
      cartographyWalkabilityOpacity: 55,
      cartographyGridOpacity: 65,
      cartographyControlIdleOpacity: 35,
      gwonmacTools: false,
      buildLibrary: true,
      tradeChat: true,
      xunlaiStorage: false,
      travelPalette: true,
      characterSwitchProfession: true,
      characterSwitchLevel: true,
      characterSwitchLocation: true,
      travelShortcuts: DEFAULT_SETTINGS.travelShortcuts,
      targetReadout: false,
      shortcutOverrides: {},
      skillKeyBindings: [null, null, null, null, null, null, null, null],
      skillKeyLabelsEnabled: false,
      chatFiltersEnabled: false,
      chatFilterAllyDrops: true,
      chatFilterHallOfHeroes: true,
      chatFilterTitleAchievements: true,
      skillCooldownOverlayEnabled: true,
      quickItemMove: false,
      skillCooldownColor: { kind: "preset", preset: "red" },
      extendedMemoryEnabled: false,
      autoRelogAfterReload: false,
      showDiagnostics: true,
      dataStrategy: "full",
      autoCheckUpdates: true,
      updateTrack: "stable",
      lastUpdateCheckAt: null,
      compatibilityNoticeSeenFor: null,
    });
  });

  it("fills missing fields and ignores unknown keys on read", () => {
    assert.equal(parseSettings({}).renderScale, 2);
    const got = parseSettings({
      patchMode: "fullImage",
      renderScale: 2,
      mystery: true,
    });
    assert.equal("patchMode" in got, false);
    assert.equal(got.renderScale, 2);
    assert.equal("mystery" in got, false);
  });

  it("hard-cuts the unreleased combined Character Switch detail setting", () => {
    const got = parseSettings({ characterSwitchDetails: false });
    assert.equal("characterSwitchDetails" in got, false);
    assert.equal(got.characterSwitchProfession, true);
    assert.equal(got.characterSwitchLevel, true);
    assert.equal(got.characterSwitchLocation, true);
  });

  it("preserves every explicit supported render scale", () => {
    assert.equal(parseSettings({ renderScale: 1 }).renderScale, 1);
    assert.equal(parseSettings({ renderScale: 1.5 }).renderScale, 1.5);
    assert.equal(parseSettings({ renderScale: 2 }).renderScale, 2);
  });

  it("accepts only supported interface styles", () => {
    assert.equal(parseSettings({ uiStyle: "guild-wars" }).uiStyle, "guild-wars");
    assert.equal(parseSettings({ uiStyle: "obsidian" }).uiStyle, "obsidian");
    assert.equal(parseSettings({ uiStyle: "custom" }).uiStyle, "custom");
    assert.throws(() => parseSettings({ uiStyle: "jade" }), AppError);
    assert.throws(() => parseSettings({ uiStyle: true }), AppError);
  });

  it("normalises and validates the permanent custom theme contract", () => {
    const custom = {
      ...DEFAULT_CUSTOM_UI_THEME,
      window: "#abcdef",
      recessed: "#123456",
      selected: "#789abc",
      accent: "#fedcba",
      windowGradient: false,
    };
    assert.deepEqual(parseSettings({ uiCustomTheme: custom }).uiCustomTheme, {
      ...DEFAULT_CUSTOM_UI_THEME,
      window: "#ABCDEF",
      recessed: "#123456",
      selected: "#789ABC",
      accent: "#FEDCBA",
      windowGradient: false,
    });
    assert.throws(() => parseSettings({ uiCustomTheme: { ...custom, accent: "#fff" } }), AppError);
    assert.throws(() => parseSettings({ uiCustomTheme: { ...custom, extra: true } }), AppError);
    assert.throws(() => parseSettings({ uiCustomTheme: { ...custom, windowGradient: "yes" } }), AppError);
  });

  it("validates the cartography preset library and independent opacities", () => {
    const library = {
      activePreset: { kind: "custom", id: "night-run" },
      customPresets: [{
        id: "night-run",
        name: " Night Run ",
        style: CARTOGRAPHY_BUILTIN_PRESETS.synthwave.style,
      }],
    } as const;
    assert.deepEqual(parseSettingsPatch({
      cartographyOverlayEnabled: true,
      cartographyGridEnabled: true,
      cartographyRevealMode: "birds-eye",
      cartographyPresetLibrary: library,
      cartographyWalkabilityOpacity: 72,
      cartographyGridOpacity: 61,
      cartographyControlIdleOpacity: 44,
    }), {
      cartographyOverlayEnabled: true,
      cartographyGridEnabled: true,
      cartographyRevealMode: "birds-eye",
      cartographyPresetLibrary: {
        activePreset: { kind: "custom", id: "night-run" },
        customPresets: [{
          id: "night-run",
          name: "Night Run",
          style: CARTOGRAPHY_BUILTIN_PRESETS.synthwave.style,
        }],
      },
      cartographyWalkabilityOpacity: 72,
      cartographyGridOpacity: 61,
      cartographyControlIdleOpacity: 44,
    });
    assert.throws(() => parseSettingsPatch({ cartographyGridEnabled: "yes" }), AppError);
    assert.throws(() => parseSettingsPatch({ cartographyRevealMode: "wide" }), AppError);
    assert.throws(() => parseSettingsPatch({ cartographyWalkabilityOpacity: 101 }), AppError);
    assert.throws(() => parseSettingsPatch({ cartographyGridOpacity: -1 }), AppError);
    assert.throws(() => parseSettingsPatch({ cartographyControlIdleOpacity: 14 }), AppError);
    assert.throws(() => parseSettingsPatch({
      cartographyPresetLibrary: {
        ...library,
        activePreset: { kind: "custom", id: "missing" },
      },
    }), AppError);
    assert.throws(() => parseSettingsPatch({ cartographyOverlayStyle: "contrast" }), AppError);
    assert.deepEqual(parseSettings({
      cartographyOverlayStyle: "contrast",
      cartographyOverlayOpacity: 99,
      cartographyOverlayCustomStyle: {},
    }).cartographyPresetLibrary, DEFAULT_SETTINGS.cartographyPresetLibrary);
  });

  it("accepts only the supported interface fonts", () => {
    assert.equal(parseSettings({ uiFont: "guild-wars" }).uiFont, "guild-wars");
    assert.equal(parseSettings({ uiFont: "inter" }).uiFont, "inter");
    assert.equal(parseSettings({ uiFont: "system" }).uiFont, "system");
    assert.equal(parseSettings({ uiFont: "avenir" }).uiFont, "avenir");
    assert.equal(parseSettings({ uiFont: "georgia" }).uiFont, "georgia");
    assert.equal(parseSettings({ uiFont: "palatino" }).uiFont, "palatino");
    assert.throws(() => parseSettings({ uiFont: "papyrus" }), AppError);
    assert.throws(() => parseSettings({ uiFont: false }), AppError);
  });

  it("accepts only the two supported controller prompt styles", () => {
    assert.equal(
      parseSettings({ controllerPromptStyle: "game-default" }).controllerPromptStyle,
      "game-default",
    );
    assert.equal(
      parseSettings({ controllerPromptStyle: "playstation" }).controllerPromptStyle,
      "playstation",
    );
    assert.throws(() => parseSettings({ controllerPromptStyle: "nintendo" }), AppError);
    assert.throws(() => parseSettings({ controllerPromptStyle: true }), AppError);
  });

  it("rejects unknown types", () => {
    assert.throws(() => parseSettings({ renderScale: 3 }), AppError);
    // The bounds are the setting's meaning: below 65% a panel stops being
    // readable over moving art.
    assert.throws(() => parseSettings({ uiPanelOpacity: 64 }), AppError);
    assert.throws(() => parseSettings({ uiPanelOpacity: 94.5 }), AppError);
    assert.equal("uiTheme" in parseSettings({ uiTheme: "jade" }), false);
    assert.equal("uiDensity" in parseSettings({ uiDensity: "compact" }), false);
    assert.equal("uiBorderWidth" in parseSettings({ uiBorderWidth: 4 }), false);
    assert.equal("uiRadius" in parseSettings({ uiRadius: 16 }), false);
    assert.equal("nativeCursor" in parseSettings({ nativeCursor: "yes" }), false);
    assert.equal(parseSettings({ dataStrategy: null }).dataStrategy, "full");
    assert.equal(parseSettings({ dataStrategy: "quick" }).dataStrategy, "full");
    assert.equal(parseSettings({ dataStrategy: "full" }).dataStrategy, "full");
    assert.throws(() => parseSettings({ dataStrategy: "automatic" }), AppError);
    assert.throws(() => parseSettings([]), AppError);
  });

  it("takes the update fields only in the shapes the renderer can produce", () => {
    assert.equal(parseSettings({ autoCheckUpdates: true }).autoCheckUpdates, true);
    assert.throws(() => parseSettings({ autoCheckUpdates: "yes" }), AppError);
    assert.equal(parseSettings({ updateTrack: "stable" }).updateTrack, "stable");
    assert.equal(parseSettings({ updateTrack: "beta" }).updateTrack, "beta");
    assert.throws(() => parseSettings({ updateTrack: "alpha" }), AppError);

    assert.equal(parseSettings({ lastUpdateCheckAt: null }).lastUpdateCheckAt, null);
    assert.equal(parseSettings({ lastUpdateCheckAt: 0 }).lastUpdateCheckAt, 0);
    assert.equal(
      parseSettings({ lastUpdateCheckAt: 1_800_000_000_000 }).lastUpdateCheckAt,
      1_800_000_000_000,
    );
    assert.equal(
      parseSettings({ lastUpdateCheckAt: LAST_UPDATE_CHECK_AT_MAX })
        .lastUpdateCheckAt,
      LAST_UPDATE_CHECK_AT_MAX,
    );
    // Epoch milliseconds, not a date, not a duration, not a negative.
    assert.throws(() => parseSettings({ lastUpdateCheckAt: -1 }), AppError);
    assert.throws(() => parseSettings({ lastUpdateCheckAt: 1.5 }), AppError);
    assert.throws(() => parseSettings({ lastUpdateCheckAt: Number.NaN }), AppError);
    assert.throws(
      () => parseSettings({ lastUpdateCheckAt: LAST_UPDATE_CHECK_AT_MAX + 1 }),
      AppError,
    );
    assert.throws(() => parseSettings({ lastUpdateCheckAt: 1e300 }), AppError);
    assert.throws(() => parseSettings({ lastUpdateCheckAt: "2026-07-26" }), AppError);
  });

  it("accepts only bounded shortcut overrides", () => {
    assert.deepEqual(parseSettings({
      shortcutOverrides: {
        "tools.toggle": { key: "k", shift: true, option: false },
        "storage.open": null,
      },
    }).shortcutOverrides, {
      "tools.toggle": { key: "k", shift: true, option: false },
      "storage.open": null,
    });
    assert.throws(() => parseSettings({
      shortcutOverrides: {
        "tools.toggle": { key: "F1", shift: false, option: false },
      },
    }), AppError);
    assert.throws(() => parseSettingsPatch({
      shortcutOverrides: { "unknown.action": null },
    }), AppError);
  });

  it("accepts exactly eight display-only skill bindings", () => {
    const binding = {
      input: { kind: "keyboard" as const, code: "KeyC" },
      modifiers: { control: true, option: true, shift: true, command: true },
    };
    const skillKeyBindings = [null, null, null, null, null, null, null, binding];
    assert.deepEqual(parseSettings({ skillKeyBindings }).skillKeyBindings, skillKeyBindings);
    assert.deepEqual(parseSettingsPatch({ skillKeyBindings }), { skillKeyBindings });
    assert.throws(() => parseSettings({ skillKeyBindings: skillKeyBindings.slice(1) }), AppError);
    assert.throws(() => parseSettings({
      skillKeyBindings: [{ ...binding, input: { kind: "keyboard", code: "Unknown" } },
        ...skillKeyBindings.slice(1)],
    }), AppError);
    assert.equal(parseSettings({ skillKeyBindings }).skillKeyLabelsEnabled, true);
    assert.equal(parseSettings({
      skillKeyBindings,
      skillKeyLabelsEnabled: false,
      chatFiltersEnabled: false,
      chatFilterAllyDrops: false,
      chatFilterHallOfHeroes: false,
      chatFilterTitleAchievements: false,
    }).skillKeyLabelsEnabled, false);
  });

  it("takes the acknowledged client build only as a client hash", () => {
    const hash = "b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483";
    assert.equal(
      parseSettings({ compatibilityNoticeSeenFor: hash })
        .compatibilityNoticeSeenFor,
      hash,
    );
    assert.equal(
      parseSettings({ compatibilityNoticeSeenFor: null })
        .compatibilityNoticeSeenFor,
      null,
    );
    // It names a build, so a boolean, a truncated hash or upper case — the
    // shapes a "notice shown" flag would arrive as — are all refused.
    assert.throws(() => parseSettings({ compatibilityNoticeSeenFor: true }), AppError);
    assert.throws(() => parseSettings({ compatibilityNoticeSeenFor: "b031" }), AppError);
    assert.throws(
      () => parseSettings({ compatibilityNoticeSeenFor: hash.toUpperCase() }),
      AppError,
    );
  });

  it("accepts one canonical cooldown switch and color", () => {
    assert.equal(parseSettings({ skillCooldownOverlayEnabled: false }).skillCooldownOverlayEnabled, false);
    assert.deepEqual(parseSettingsPatch({
      skillCooldownColor: { kind: "custom", value: "#12aBcF" },
    }), { skillCooldownColor: { kind: "custom", value: "#12aBcF" } });
    for (const value of [
      { kind: "custom", value: "#fff" },
      { kind: "custom", value: "#12345g" },
      { kind: "preset", preset: "green" },
      { kind: "preset", preset: "red", extra: true },
    ]) assert.throws(() => parseSettings({ skillCooldownColor: value }), AppError);
  });

  it("keeps Quick Item Move off by default and accepts its one switch", () => {
    assert.equal(parseSettings({}).quickItemMove, false);
    assert.deepEqual(parseSettingsPatch({ quickItemMove: true }), { quickItemMove: true });
  });

  it("validates patches without filling fields from defaults", () => {
    assert.throws(() => parseSettingsPatch({ nativeCursor: true }), AppError);
    assert.deepEqual(parseSettingsPatch({ lastUpdateCheckAt: 1_000 }), {
      lastUpdateCheckAt: 1_000,
    });
    assert.deepEqual(parseSettingsPatch({ updateTrack: "beta" }), {
      updateTrack: "beta",
    });
    assert.throws(() => parseSettingsPatch({ mystery: true }), AppError);
    assert.throws(() => parseSettingsPatch({ touchMode: "dbltap" }), AppError);
    // A renderer that still names a retired key is a bug, not a migration.
    assert.throws(() => parseSettingsPatch({ cursorTheme: "system" }), AppError);
    assert.deepEqual(parseSettingsPatch({ targetReadout: true }), {
      targetReadout: true,
    });
    assert.deepEqual(parseSettingsPatch({ extendedMemoryEnabled: true }), {
      extendedMemoryEnabled: true,
    });
    assert.deepEqual(parseSettingsPatch({ autoRelogAfterReload: true }), {
      autoRelogAfterReload: true,
    });
    assert.deepEqual(parseSettingsPatch({ uiStyle: "obsidian" }), {
      uiStyle: "obsidian",
    });
    assert.deepEqual(parseSettingsPatch({ uiCustomTheme: DEFAULT_CUSTOM_UI_THEME }), {
      uiCustomTheme: DEFAULT_CUSTOM_UI_THEME,
    });
    assert.deepEqual(parseSettingsPatch({ uiFont: "inter" }), {
      uiFont: "inter",
    });
    assert.deepEqual(parseSettingsPatch({ controllerPromptStyle: "playstation" }), {
      controllerPromptStyle: "playstation",
    });
  });

  it("keeps launcher policy off the game renderer settings channel", () => {
    assert.deepEqual(parseRendererSettingsPatch({ autoRelogAfterReload: true }), {
      autoRelogAfterReload: true,
    });
    assert.deepEqual(parseRendererSettingsPatch({
      cartographyPresetSelection: { kind: "builtin", id: "synthwave" },
    }), {
      cartographyPresetSelection: { kind: "builtin", id: "synthwave" },
    });
    assert.throws(
      () => parseRendererSettingsPatch({
        travelShortcuts: DEFAULT_SETTINGS.travelShortcuts,
      }),
      /cannot update "travelShortcuts"/u,
    );
    assert.throws(
      () => parseRendererSettingsPatch({ renderScale: 1.5 }),
      /cannot update "renderScale"/u,
    );
    assert.throws(
      () => parseRendererSettingsPatch({ gwonmacTools: true }),
      /cannot update "gwonmacTools"/u,
    );
    assert.throws(
      () => parseRendererSettingsPatch({
        cartographyPresetSelection: { kind: "builtin", id: "unknown" },
      }),
      /PresetSelection is invalid/u,
    );
    assert.throws(
      () => parseRendererSettingsPatch({
        cartographyPresetSelection: { kind: "builtin", id: "synthwave" },
        cartographyPresetLibrary: DEFAULT_SETTINGS.cartographyPresetLibrary,
      }),
      /cannot update "cartographyPresetLibrary"/u,
    );
  });

  it("loads defaults for missing or corrupt files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    const missing = await loadSettings(path);
    assert.deepEqual(missing, DEFAULT_SETTINGS);
    assert.equal(missing.renderScale, 2);
    await writeFile(path, "{not json");
    let backup = "";
    const corrupt = await loadSettings(path, (value) => {
      backup = value;
    });
    assert.deepEqual(corrupt, DEFAULT_SETTINGS);
    assert.equal(corrupt.renderScale, 2);
    assert.match(backup, /settings\.json\.corrupt-\d+-[0-9a-f-]{36}$/u);
    assert.equal(await readFile(backup, "utf8"), "{not json");
    assert.deepEqual(await readdir(dir), [backup.split("/").at(-1)]);
  });

  it("saves only known fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    const saved = await saveSettings(path, {
      ...DEFAULT_SETTINGS,
      showDiagnostics: true,
      autoRelogAfterReload: true,
      renderScale: 1.5,
      gwonmacTools: false,
      xunlaiStorage: false,
      travelPalette: false,
      travelShortcuts: DEFAULT_SETTINGS.travelShortcuts,
      targetReadout: false,
    });
    assert.equal(saved.showDiagnostics, true);
    assert.equal(saved.autoRelogAfterReload, true);
    assert.equal((await loadSettings(path)).autoRelogAfterReload, true);
    const disk = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(Object.keys(disk).sort(), [
      "autoCheckUpdates",
      "autoRelogAfterReload",
      "buildLibrary",
      "cartographyCompassGridEnabled",
      "cartographyControlIdleOpacity",
      "cartographyEnabled",
      "cartographyGridEnabled",
      "cartographyGridOpacity",
      "cartographyOverlayEnabled",
      "cartographyPresetLibrary",
      "cartographyRevealMode",
      "cartographyWalkabilityOpacity",
      "characterSwitchEnabled",
      "characterSwitchLevel",
      "characterSwitchLocation",
      "characterSwitchProfession",
      "chatFilterAllyDrops",
      "chatFilterHallOfHeroes",
      "chatFilterTitleAchievements",
      "chatFiltersEnabled",
      "compatibilityNoticeSeenFor",
      "controllerPromptStyle",
      "dataStrategy",
      "extendedMemoryEnabled",
      "formatVersion",
      "gwonmacTools",
      "lastUpdateCheckAt",
      "quickItemMove",
      "renderScale",
      "shortcutOverrides",
      "showDiagnostics",
      "skillCooldownColor",
      "skillCooldownOverlayEnabled",
      "skillKeyBindings",
      "skillKeyLabelsEnabled",
      "targetReadout",
      "teamManagement",
      "tradeChat",
      "travelPalette",
      "travelShortcuts",
      "uiCustomTheme",
      "uiFont",
      "uiPanelOpacity",
      "uiStyle",
      "updateTrack",
      "xunlaiStorage",
    ]);
    assert.equal(disk.formatVersion, 1);
    assert.equal(disk.teamManagement, saved.buildLibrary);
  });

  it("preserves the legacy Apply Team opt-out without restoring a second setting", () => {
    assert.equal(parseSettings({
      gwonmacTools: true,
      teamManagement: false,
    }).buildLibrary, false);
    assert.equal(parseSettings({
      gwonmacTools: true,
      teamManagement: true,
    }).buildLibrary, true);
    assert.equal(parseSettings({
      buildLibrary: true,
      teamManagement: false,
    }).buildLibrary, true, "the canonical key must win");
    assert.equal(parseSettings({
      buildLibrary: false,
      teamManagement: "malformed legacy shadow",
    }).buildLibrary, false, "the canonical key must bypass the legacy shadow");
    assert.throws(
      () => parseSettings({ teamManagement: "false" }),
      /settings\.teamManagement must be a boolean/u,
    );
  });

  it("writes the legacy Apply Team projection for Stable rollback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    const settings = { ...DEFAULT_SETTINGS, gwonmacTools: true, buildLibrary: false };

    assert.deepEqual(await saveSettings(path, settings), settings);
    const disk = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(disk.buildLibrary, false);
    assert.equal(disk.teamManagement, false);
    assert.equal("teamManagement" in await loadSettings(path), false);
    assert.equal((await loadSettings(path)).buildLibrary, false);
  });

  it("loads an alpha-written bare-JSON file with every value intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    // Byte-for-byte what v0.0.1-alpha.1 wrote: no formatVersion, and retired
    // cursor/input keys that build had and this one does not.
    const alpha = {
      renderScale: 1.5,
      gwonmacTools: false,
      teamManagement: true,
      xunlaiStorage: false,
      targetReadout: false,
      nativeCursor: true,
      touchMode: "translate",
      showDiagnostics: true,
      cursorTheme: "guild-wars-2",
    };
    await writeFile(path, JSON.stringify(alpha));

    let recovered = "";
    const loaded = await loadSettings(path, (backup) => {
      recovered = backup;
    });
    assert.equal(recovered, "", "an alpha profile must not be treated as corrupt");
    assert.equal("teamManagement" in loaded, false);
    assert.deepEqual(loaded, {
      uiPanelOpacity: 94,
      renderScale: 1.5,
      uiStyle: "guild-wars",
      uiCustomTheme: DEFAULT_CUSTOM_UI_THEME,
      uiFont: "guild-wars",
      controllerPromptStyle: "game-default",
      cartographyEnabled: true,
      characterSwitchEnabled: true,
      cartographyOverlayEnabled: false,
      cartographyGridEnabled: false,
      cartographyCompassGridEnabled: false,
      cartographyRevealMode: "off",
      cartographyPresetLibrary: DEFAULT_SETTINGS.cartographyPresetLibrary,
      cartographyWalkabilityOpacity: 55,
      cartographyGridOpacity: 65,
      cartographyControlIdleOpacity: 35,
      gwonmacTools: false,
      buildLibrary: true,
      tradeChat: true,
      xunlaiStorage: false,
      travelPalette: true,
      characterSwitchProfession: true,
      characterSwitchLevel: true,
      characterSwitchLocation: true,
      travelShortcuts: DEFAULT_SETTINGS.travelShortcuts,
      targetReadout: false,
      shortcutOverrides: {},
      skillKeyBindings: [null, null, null, null, null, null, null, null],
      skillKeyLabelsEnabled: false,
      chatFiltersEnabled: false,
      chatFilterAllyDrops: true,
      chatFilterHallOfHeroes: true,
      chatFilterTitleAchievements: true,
      skillCooldownOverlayEnabled: true,
      quickItemMove: false,
      skillCooldownColor: { kind: "preset", preset: "red" },
      extendedMemoryEnabled: false,
      autoRelogAfterReload: false,
      showDiagnostics: true,
      dataStrategy: "full",
      // Fields that alpha never wrote arrive at their defaults — deliberately
      // including the update check, which defaults on. A profile that never
      // stored the setting inherits the current default; an explicit opt-out
      // remains false on the ordinary parse path.
      autoCheckUpdates: true,
      updateTrack: "stable",
      lastUpdateCheckAt: null,
      compatibilityNoticeSeenFor: null,
    });
    // Nothing was moved aside, so the file the player had is still the file.
    assert.deepEqual(await readdir(dir), ["settings.json"]);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), alpha);

    // The next save is the only thing that rewrites it. Unrelated values stay;
    // retired input and cursor fields disappear without a migration marker.
    await saveSettings(path, loaded);
    const rewritten = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(rewritten, {
      formatVersion: 1,
      ...loaded,
      teamManagement: loaded.buildLibrary,
    });
    assert.equal("touchMode" in rewritten, false);
    assert.deepEqual(await loadSettings(path), loaded);
  });

  it("preserves released district shortcuts for Stable rollback compatibility", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    await writeFile(path, JSON.stringify({
      renderScale: 1.5,
      travelShortcuts: [
        { mapId: 55, district: "europe-english", districtNumber: 2 },
        null,
        { mapId: 449, district: "international", districtNumber: 0 },
      ],
    }));

    const loaded = await loadSettings(path);
    assert.equal(loaded.renderScale, 1.5);
    assert.deepEqual(loaded.travelShortcuts, [
      { mapId: 55, district: "europe-english", districtNumber: 2 },
      null,
      { mapId: 449, district: "international", districtNumber: 0 },
    ]);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")).travelShortcuts, [
      { mapId: 55, district: "europe-english", districtNumber: 2 },
      null,
      { mapId: 449, district: "international", districtNumber: 0 },
    ]);
    assert.deepEqual(parseSettingsPatch({ travelShortcuts: loaded.travelShortcuts }), {
      travelShortcuts: loaded.travelShortcuts,
    });
  });

  it("keeps the three newest corrupt backups and drops the rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    for (const epoch of [1000, 2000, 3000, 4000]) {
      await writeFile(`${path}.corrupt-${epoch}`, `stale ${epoch}`);
    }
    // Neighbours in the same profile directory that this must not touch.
    await writeFile(join(dir, "window-state.json"), "{}");
    await writeFile(`${path}.corrupt-not-an-epoch`, "hand-written");
    await writeFile(path, "{not json");

    let backup = "";
    await loadSettings(path, (value) => {
      backup = value;
    });
    const kept = (await readdir(dir)).sort();
    assert.deepEqual(kept, [
      "settings.json.corrupt-3000",
      "settings.json.corrupt-4000",
      "settings.json.corrupt-not-an-epoch",
      backup.split("/").at(-1),
      "window-state.json",
    ].sort());
    // The newest three are the new one and the two most recent older ones.
    assert.equal(await readFile(`${path}.corrupt-4000`, "utf8"), "stale 4000");
    assert.equal(await readFile(backup, "utf8"), "{not json");
  });

  it("moves aside a settings format this build cannot read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    const future = { formatVersion: 2, renderScale: 1, touchMode: "off" };
    await writeFile(path, JSON.stringify(future));
    assert.throws(() => parseSettings(future), AppError);

    let backup = "";
    assert.deepEqual(
      await loadSettings(path, (value) => {
        backup = value;
      }),
      DEFAULT_SETTINGS,
    );
    // Refused, not reinterpreted, and not destroyed: the bytes are still there.
    assert.deepEqual(JSON.parse(await readFile(backup, "utf8")), future);
  });
});
