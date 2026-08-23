export type RouteName = "home" | "news" | "settings" | "issues" | "accounts";
export type Scenario = "ready" | "updating" | "degraded" | "offline";
export type FundingPlacement = "home" | "bar" | "dock" | "hidden";
export type SettingsSection = "updates" | "news" | "tools" | "display" | "shortcuts";
export type AccountStatus = "ready" | "running";

export interface Account {
  id: string;
  name: string;
  note: string;
  initial: string;
  status: AccountStatus;
  quickStart: boolean;
}

export interface LauncherSettings {
  automaticUpdates: boolean;
  releaseTrack: "stable" | "beta";
  toolsEnabled: boolean;
  quickTravel: boolean;
  xunlaiStorage: boolean;
  applyTeams: boolean;
  showGuildWarsNews: boolean;
  showMacNews: boolean;
  renderScale: "2" | "1.5" | "1";
  interfaceStyle: "guild-wars" | "reforged" | "modern";
}

export interface NewsArticle {
  id: string;
  sourceKey: "guild-wars" | "macos";
  source: string;
  date: string;
  title: string;
  summary: string;
  image: string;
  paragraphs: string[];
  bullets: string[];
}

export const createDefaultSettings = (): LauncherSettings => ({
  automaticUpdates: true,
  releaseTrack: "stable",
  toolsEnabled: true,
  quickTravel: true,
  xunlaiStorage: true,
  applyTeams: false,
  showGuildWarsNews: true,
  showMacNews: true,
  renderScale: "2",
  interfaceStyle: "guild-wars",
});

export const createDefaultAccounts = (): Account[] => [
  {
    id: "main",
    name: "Main account",
    note: "Last played today",
    initial: "M",
    status: "ready",
    quickStart: true,
  },
];
