export type RouteName = "home" | "news" | "settings" | "issues" | "accounts";
export type Scenario = "ready" | "updating" | "degraded" | "offline";
export type FundingPlacement = "home" | "bar" | "dock" | "hidden";
export type SettingsSection = "updates" | "tools" | "display" | "shortcuts";
export type AccountStatus = "ready" | "running" | "login-required";

export interface Account {
  id: string;
  name: string;
  note: string;
  initial: string;
  status: AccountStatus;
}

export interface LauncherSettings {
  automaticUpdates: boolean;
  releaseTrack: "stable" | "beta";
  toolsEnabled: boolean;
  quickTravel: boolean;
  xunlaiStorage: boolean;
  applyTeams: boolean;
  multipleWindows: boolean;
  renderScale: "2" | "1.5" | "1";
  interfaceStyle: "guild-wars" | "reforged" | "modern";
}

export interface NewsArticle {
  id: string;
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
  multipleWindows: true,
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
  },
  {
    id: "storage",
    name: "Storage account",
    note: "Last played 4 days ago",
    initial: "S",
    status: "ready",
  },
  {
    id: "pvp",
    name: "PvP account",
    note: "Sign in before playing",
    initial: "P",
    status: "login-required",
  },
];
