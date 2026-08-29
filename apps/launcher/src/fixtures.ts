import type { LauncherSnapshot } from "@shared/launcher-contracts";
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
  readiness: { state: "playable", backgroundDownload: { status: "running" } },
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
    extendedMemoryEnabled: false,
    showDiagnostics: false,
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
