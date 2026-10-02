/**
 * Owns the words for settings that both the launcher and Hub Settings show: one
 * label, one description and one "when it applies" note per stored value, so the
 * two surfaces can never name the same setting differently (docs/settings.md).
 */

/** When a saved change takes effect. `now` needs no note. */
export type SettingApplies = "now" | "next-game" | "restart";

export const SETTING_APPLIES_NOTE: Readonly<Record<SettingApplies, string>> = {
  now: "",
  "next-game": "Applies when you next open or reload a game window.",
  restart: "Applies after you restart gwonmac.",
};

type Copy = Readonly<{ label: string; detail: string; applies: SettingApplies; keywords?: string }>;

/** Settings › Game, in display order. */
export const GAME_SETTINGS = {
  renderScale: { label: "Render quality", detail: "Higher quality uses more graphics power.", applies: "now", keywords: "graphics resolution scale sharp" },
  extendedMemoryEnabled: { label: "Extended memory", detail: "Allow longer sessions to use up to 4 GB instead of 2 GB. Experimental.", applies: "restart", keywords: "memory ram 4gb out of memory crash" },
  autoRelogAfterReload: { label: "Return to character after reload", detail: "Sign in and return to the last character after reloading the game.", applies: "now", keywords: "relog login reload automatic" },
  controllerPromptStyle: { label: "Controller symbols", detail: "Button symbols shown for a game controller.", applies: "next-game", keywords: "gamepad playstation xbox buttons" },
  showDiagnostics: { label: "Diagnostics overlay", detail: "Show frame and memory diagnostics in open game windows.", applies: "now", keywords: "fps debug performance" },
} as const satisfies Readonly<Record<string, Copy>>;

export const RENDER_SCALE_OPTIONS = [
  { label: "Standard · 1×", value: 1 },
  { label: "High · 1.5×", value: 1.5 },
  { label: "Very high · 2×", value: 2 },
] as const;

export const CONTROLLER_SYMBOL_OPTIONS = [
  { label: "Game default", value: "game-default" },
  { label: "PlayStation", value: "playstation" },
] as const;

/** Character Switch options, shown under that tool. */
export const CHARACTER_DETAILS = [
  { key: "characterSwitchProfession", label: "Show profession" },
  { key: "characterSwitchLevel", label: "Show level" },
  { key: "characterSwitchLocation", label: "Show location" },
] as const;

/** Chat Filters options, shown under that tool. On hides those messages. */
export const CHAT_FILTERS = [
  { key: "chatFilterAllyDrops", label: "Hide other party members' item drops" },
  { key: "chatFilterHallOfHeroes", label: "Hide Hall of Heroes winner announcements" },
  { key: "chatFilterTitleAchievements", label: "Hide player title achievements" },
] as const;

/** The full note for a setting: its description, then when it applies. */
export function settingDetail(copy: Copy): string {
  return [copy.detail, SETTING_APPLIES_NOTE[copy.applies]].filter(Boolean).join(" ");
}
