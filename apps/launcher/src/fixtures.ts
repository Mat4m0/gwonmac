import type { LauncherSnapshot } from "@shared/launcher-contracts";
import { DEFAULT_SETTINGS } from "@shared/contracts";
import { resolveShortcuts } from "@shared/keyboard-shortcuts";
import { DEFAULT_CARTOGRAPHY_PRESET_LIBRARY } from "@shared/cartography-overlay";
import { LEGACY_PRIMARY_PROFILE_ID, parseProfileId } from "@shared/multiple-accounts";

export const fixtureSnapshot: LauncherSnapshot = {
  revision: 1,
  experience: {
    installationKind: "migrated-single",
    setup: "complete",
    introduction: "complete",
    showMigrationNotice: true,
    preferencesReset: false,
  },
  readiness: {
    state: "playable",
    backgroundDownload: {
      status: "running",
      received: 8_400_000_000,
      total: 9_100_000_000,
      bytesPerSecond: 12_500_000,
      secondsRemaining: 56,
    },
  },
  appUpdate: { phase: "idle", currentVersion: "2026.8.10" },
  tools: {
    configured: false,
    loaded: false,
    restartRequired: false,
    features: {
      "character-switch": { enabled: true },
      "build-management": { enabled: true },
      "quick-travel": { enabled: true },
      "xunlai-storage": { enabled: false },
      "quick-item-move": { enabled: false },
      "trade-chat": { enabled: false },
      maps: { enabled: true },
      "target-readout": { enabled: false },
      "skill-key-labels": { enabled: false },
      "skill-cooldowns": { enabled: true },
      "chat-filters": { enabled: false },
    },
  },
  shortcuts: resolveShortcuts({}),
  settings: {
    uiStyle: DEFAULT_SETTINGS.uiStyle,
    uiFont: DEFAULT_SETTINGS.uiFont,
    uiCustomTheme: DEFAULT_SETTINGS.uiCustomTheme,
    uiPanelOpacity: DEFAULT_SETTINGS.uiPanelOpacity,
    controllerPromptStyle: DEFAULT_SETTINGS.controllerPromptStyle,
    autoRelogAfterReload: DEFAULT_SETTINGS.autoRelogAfterReload,
    characterSwitchProfession: DEFAULT_SETTINGS.characterSwitchProfession,
    characterSwitchLevel: DEFAULT_SETTINGS.characterSwitchLevel,
    characterSwitchLocation: DEFAULT_SETTINGS.characterSwitchLocation,
    skillKeyBindings: DEFAULT_SETTINGS.skillKeyBindings,
    skillCooldownColor: DEFAULT_SETTINGS.skillCooldownColor,
    chatFilterAllyDrops: DEFAULT_SETTINGS.chatFilterAllyDrops,
    chatFilterHallOfHeroes: DEFAULT_SETTINGS.chatFilterHallOfHeroes,
    chatFilterTitleAchievements: DEFAULT_SETTINGS.chatFilterTitleAchievements,
    autoCheckUpdates: true,
    updateTrack: "stable",
    renderScale: 2,
    extendedMemoryEnabled: false,
    showDiagnostics: false,
    cartographyOverlayEnabled: false,
    cartographyGridEnabled: false,
    cartographyCompassGridEnabled: false,
    compassRangeIndicatorsEnabled: false,
    compassRangeEarshotEnabled: true,
    compassRangeCastEnabled: true,
    compassRangeSpiritEnabled: true,
    compassRangeSpiritExtendedEnabled: true,
    compassRangeEarshotOpacity: 95,
    compassRangeCastOpacity: 95,
    compassRangeSpiritOpacity: 95,
    compassRangeSpiritExtendedOpacity: 95,
    compassRangeTheme: "color",
    cartographyRevealMode: "off",
    cartographyPresetLibrary: DEFAULT_CARTOGRAPHY_PRESET_LIBRARY,
    cartographyWalkabilityOpacity: 55,
    cartographyGridOpacity: 65,
    cartographyControlIdleOpacity: 35,
  },
  texturePacks: {
    selectedPackId: null,
    packs: [],
  },
  profiles: [
    { id: LEGACY_PRIMARY_PROFILE_ID, name: "Main account", archived: false, state: "ready", appearance: { icon: "swords", color: "#8a5a32" } },
    { id: parseProfileId("ba46cb0e-55c2-4c05-9808-5c35ce83b0b0"), name: "Storage account", archived: false, state: "running", appearance: { icon: "archive", color: "#496b58" } },
  ],
  selectedProfileIds: [LEGACY_PRIMARY_PROFILE_ID],
  preferences: {
    content: { news: true, dailies: true, first: "news", officialNews: true, reforgedNews: true, eventNews: true, autoRotateNews: true },
  },
  news: {
    status: "ready",
    refreshedAt: "2026-09-02T08:00:00Z",
    stories: [
      { id: "guild-wars-update-2026-09-01", source: "game", channel: "all", title: "Seven skill fixes in the latest update", summary: "Mirage Cloak, Focused Shot, Soul Twisting, and four more skills were corrected.", publishedAt: "2026-09-01T12:00:00Z", featured: true, action: "external", body: [] },
      { id: "guild-wars-pirate-week-2026", source: "event", channel: "all", title: "Pirate Week begins September 13", summary: "Pirate NPCs and Bottle of Grog drops return for one week.", publishedAt: "2026-09-01T11:00:00Z", featured: true, action: "external", startsAt: "2026-09-13T19:00:00Z", endsAt: "2026-09-20T19:00:00Z", body: [] },
      { id: "gwonmac-2026-8-10", source: "launcher", channel: "stable", title: "GWonMac 2026.8.10 is ready", summary: "Compatibility with the latest Guild Wars client and restored Tools overlays.", publishedAt: "2026-08-27T12:00:00Z", featured: true, action: "article", body: [
        { type: "paragraph", content: [{ text: "This maintenance release keeps GWonMac compatible with the latest Guild Wars client. " }, { text: "Technical record", actionId: "news-link-deadbeef" }, { text: "." }] },
        { type: "heading", text: "What changed" },
        { type: "list", items: [[{ text: "Restored the GWonMac Tools overlays." }], [{ text: "Improved client compatibility diagnostics." }]] },
      ] },
    ],
  },
  contentAvailability: { news: "fixture", dailies: "fixture", knownIssues: "fixture", feedback: "fixture" },
};

export type LauncherFixtureScenario = "default" | "fresh" | "preparing" | "repair" | "offline" | "update" | "failed" | "production";

export function fixtureSnapshotFor(search: string): LauncherSnapshot {
  const requested = new URLSearchParams(search).get("fixture") as LauncherFixtureScenario | null;
  switch (requested) {
    case "fresh":
      return {
        ...fixtureSnapshot,
        experience: { installationKind: "fresh", setup: "pending", introduction: "pending", showMigrationNotice: false, preferencesReset: false },
        profiles: [fixtureSnapshot.profiles[0]!],
        selectedProfileIds: [fixtureSnapshot.profiles[0]!.id],
        tools: {
          ...fixtureSnapshot.tools,
          configured: false,
          loaded: false,
          features: {
            ...fixtureSnapshot.tools.features,
            "build-management": { ...fixtureSnapshot.tools.features["build-management"], enabled: false },
            "quick-travel": { ...fixtureSnapshot.tools.features["quick-travel"], enabled: false },
            "xunlai-storage": { ...fixtureSnapshot.tools.features["xunlai-storage"], enabled: false },
          },
        },
      };
    case "preparing":
      return { ...fixtureSnapshot, readiness: { state: "preparing", progress: { phase: "client", label: "Downloading the playable client", received: 620_000_000, total: 1_100_000_000, bytesPerSecond: 12_500_000, secondsRemaining: 38 } } };
    case "repair":
      return { ...fixtureSnapshot, readiness: { state: "repair-required", reason: "artifact_unverified" } };
    case "offline":
      return { ...fixtureSnapshot, readiness: { state: "offline-playable" } };
    case "update":
      return { ...fixtureSnapshot, readiness: { state: "playable", backgroundDownload: null }, appUpdate: { phase: "ready", currentVersion: "2026.8.10", latestVersion: "2026.8.11", checkedAt: "2026-08-29T12:00:00.000Z" } };
    case "failed":
      return { ...fixtureSnapshot, profiles: fixtureSnapshot.profiles.map((profile, index) => index === 0 ? { ...profile, state: "failed", failure: "renderer-crash" } : profile) };
    case "production":
      return {
        ...fixtureSnapshot,
        experience: { ...fixtureSnapshot.experience, showMigrationNotice: false },
        readiness: { state: "playable", backgroundDownload: null },
        news: { status: "offline", stories: fixtureSnapshot.news.stories },
        contentAvailability: { news: "placeholder", dailies: "placeholder", knownIssues: "placeholder", feedback: "placeholder" },
      };
    default:
      return fixtureSnapshot;
  }
}
