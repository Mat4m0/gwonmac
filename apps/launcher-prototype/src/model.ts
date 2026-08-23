export type RouteName = "home" | "news" | "settings" | "issues" | "accounts";
export type Scenario = "ready" | "updating" | "degraded" | "offline";
export type FundingPlacement = "home" | "bar" | "dock" | "hidden";
export type SettingsSection = "updates" | "home" | "tools" | "display";
export type AccountStatus = "ready" | "running";
export type AccountIcon = "user" | "chest" | "swords" | "shield" | "crown";
export type AccountColor = "amber" | "red" | "blue" | "green" | "violet";
export type HomePanel = "news" | "dailies";
export type DailyActivityKind =
  | "mission"
  | "bounty"
  | "combat"
  | "vanquish"
  | "shining-blade"
  | "vanguard"
  | "sandford";

export interface Account {
  id: string;
  name: string;
  note: string;
  icon: AccountIcon;
  color: AccountColor;
  status: AccountStatus;
  quickStart: boolean;
}

export interface AccountProfile {
  name: string;
  icon: AccountIcon;
  color: AccountColor;
}

export interface LauncherSettings {
  automaticUpdates: boolean;
  downloadAllGameFiles: boolean;
  releaseTrack: "stable" | "beta";
  toolsEnabled: boolean;
  buildManagement: boolean;
  quickTravel: boolean;
  xunlaiStorage: boolean;
  shortcuts: {
    buildManagement: string;
    quickTravel: string;
    xunlaiStorage: string;
  };
  showGuildWarsNews: boolean;
  showMacNews: boolean;
  showDailies: boolean;
  defaultHomePanel: HomePanel;
  dailyActivityVisibility: Record<DailyActivityKind, boolean>;
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
  downloadAllGameFiles: true,
  releaseTrack: "stable",
  toolsEnabled: true,
  buildManagement: true,
  quickTravel: true,
  xunlaiStorage: true,
  shortcuts: {
    buildManagement: "⌘B",
    quickTravel: "⌘T",
    xunlaiStorage: "⇧⌘C",
  },
  showGuildWarsNews: true,
  showMacNews: true,
  showDailies: true,
  defaultHomePanel: "news",
  dailyActivityVisibility: {
    mission: true,
    bounty: true,
    combat: true,
    vanquish: true,
    "shining-blade": true,
    vanguard: true,
    sandford: true,
  },
  renderScale: "2",
  interfaceStyle: "guild-wars",
});

export const createDefaultAccounts = (): Account[] => [
  {
    id: "main",
    name: "Main account",
    note: "Last played today",
    icon: "user",
    color: "amber",
    status: "ready",
    quickStart: true,
  },
];
