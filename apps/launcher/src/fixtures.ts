import type { LauncherSnapshot } from "@shared/launcher-contracts";
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
      "build-management": { enabled: true, shortcut: { key: "b", shift: false, option: false } },
      "quick-travel": { enabled: true, shortcut: { key: "t", shift: false, option: false } },
      "xunlai-storage": { enabled: false, shortcut: { key: "c", shift: true, option: false } },
    },
  },
  settings: {
    autoCheckUpdates: true,
    updateTrack: "stable",
    renderScale: 2,
    extendedMemoryEnabled: false,
    showDiagnostics: false,
    cartographyOverlayEnabled: false,
    cartographyGridEnabled: false,
    cartographyRevealMode: "off",
    cartographyPresetLibrary: DEFAULT_CARTOGRAPHY_PRESET_LIBRARY,
    cartographyWalkabilityOpacity: 55,
    cartographyGridOpacity: 65,
    cartographyControlIdleOpacity: 35,
  },
  profiles: [
    { id: LEGACY_PRIMARY_PROFILE_ID, name: "Main account", archived: false, state: "ready", appearance: { icon: "swords", color: "#8a5a32" } },
    { id: parseProfileId("ba46cb0e-55c2-4c05-9808-5c35ce83b0b0"), name: "Storage account", archived: false, state: "running", appearance: { icon: "archive", color: "#496b58" } },
  ],
  selectedProfileIds: [LEGACY_PRIMARY_PROFILE_ID],
  preferences: {
    content: { news: true, dailies: true, first: "news", officialNews: true, reforgedNews: true },
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
        preferences: {
          content: {
            ...fixtureSnapshot.preferences.content,
            news: false,
            dailies: false,
          },
        },
        contentAvailability: { news: "placeholder", dailies: "placeholder", knownIssues: "placeholder", feedback: "placeholder" },
      };
    default:
      return fixtureSnapshot;
  }
}
