/**
 * Owns where every setting lives and how a player finds it: its section, a stable control
 * ID, its label and the words players search with. Settings search and deep links (Hub search,
 * the memory warning) use these IDs; each rendered control carries `data-setting="<id>"`.
 * Labels and descriptions come from their owners (setting-copy, tool-presentation), so a
 * setting has one name everywhere (docs/settings.md).
 */
import { CHARACTER_DETAILS, CHAT_FILTERS, GAME_SETTINGS, REMINDER_GROUPS, REMINDER_SOUND, REMINDER_TIMING, type SettingApplies } from "./setting-copy.js";
import { GLOBAL_TOOLS, type GlobalTool } from "./launcher-contracts.js";
import { TOOL_PRESENTATION } from "./tool-presentation.js";

/** Settings sections in sidebar order: game settings first, by how often players change them. */
export const SETTINGS_SECTIONS = [
  { id: "tools", label: "Tools", group: "game", keywords: "features optional" },
  { id: "maps", label: "Maps", group: "game", keywords: "grid terrain compass elite cartographer" },
  { id: "appearance", label: "Appearance", group: "game", keywords: "theme look style colors font opacity panels" },
  { id: "game", label: "Game", group: "game", keywords: "graphics memory diagnostics controller quality" },
  { id: "texture-packs", label: "Texture packs", group: "game", keywords: "textures mods graphics" },
  { id: "game-files", label: "Game files", group: "game", keywords: "download repair disk space" },
  { id: "updates", label: "Updates", group: "app", keywords: "update version beta stable" },
  { id: "home", label: "Home screen", group: "app", keywords: "news dailies events launcher" },
  { id: "advanced", label: "Advanced", group: "app", keywords: "logs reset support" },
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]["id"];
export const SETTINGS_GROUP_LABELS = { game: "In game", app: "GWonMac" } as const;
/**
 * The sections the Hub draws in a game window (docs/settings.md). They change only what
 * src/shared/hub-settings.ts lets a game window change; the others open the launcher.
 */
export const HUB_SECTIONS: ReadonlySet<SettingsSection> = new Set(["tools", "maps", "appearance", "game"]);

export function parseSettingsSection(value: unknown): SettingsSection {
  const section = SETTINGS_SECTIONS.find(candidate => candidate.id === value);
  if (!section) throw new Error("Unknown settings section");
  return section.id;
}

export type SettingEntry = Readonly<{
  id: string;
  section: SettingsSection;
  label: string;
  detail?: string;
  keywords?: string;
  /** When a change takes effect; absent means now. */
  applies?: SettingApplies;
  /** The tool whose options hold this control; it shows only while that tool is on. */
  tool?: GlobalTool;
}>;

const KEYS = "keys shortcut hotkey keyboard";
const TOOL_KEYWORDS: Partial<Record<GlobalTool, string>> = {
  "call-target": "call target attack",
  whispers: "chat friends messages pm",
  "character-switch": "characters relog alts profession",
  "build-management": "builds templates skills",
  "quick-travel": "travel outposts map progress vanquish cartographer",
  "xunlai-storage": "chest bank storage",
  "quick-item-move": "items inventory stacks",
  "trade-chat": "kamadan prices trading market",
  maps: "grid terrain compass",
  "target-readout": "distance range",
  "skill-cooldowns": "recharge timer skill bar",
  "chat-filters": "chat filter spam",
  "alcohol-timer": "drunk alcohol timer",
  reminders: "cons pcons alcohol reminder chime",
  "effect-timers": "effects buffs timers",
};

const toolEntry = (tool: GlobalTool): SettingEntry => {
  const { label, description, action } = TOOL_PRESENTATION[tool];
  return { id: `tool:${tool}`, section: "tools", label, detail: description, keywords: [TOOL_KEYWORDS[tool], action && KEYS].filter(Boolean).join(" ") };
};
const option = (tool: GlobalTool, entries: readonly { key: string; label: string; detail?: string }[], keywords: string): SettingEntry[] =>
  entries.map(({ key, label, detail }) => ({ id: key, section: "tools", label, keywords, tool, ...(detail ? { detail } : {}) }));
const game = (key: keyof typeof GAME_SETTINGS): SettingEntry => ({ id: key, section: "game", ...GAME_SETTINGS[key] });

/** Every setting a player can find by name, in display order within its section. */
export const SETTINGS: readonly SettingEntry[] = [
  { id: "hub", section: "tools", label: "Hub", detail: "Search everything in game. Always on, even with Tools off.", keywords: `search command palette ${KEYS}` },
  { id: "gwonmacTools", section: "tools", label: "Enable Tools", detail: "Optional game features. Character Switch works independently.", keywords: "features optional" },
  ...GLOBAL_TOOLS.map(toolEntry),
  ...option("character-switch", CHARACTER_DETAILS, "character details"),
  ...option("chat-filters", CHAT_FILTERS, "chat filter spam"),
  ...option("reminders", [...REMINDER_GROUPS, ...REMINDER_TIMING, REMINDER_SOUND], "reminder"),
  { id: "skillCooldownColor", section: "tools", label: "Timer color", tool: "skill-cooldowns", keywords: "skill cooldown colour" },
  { id: "alcoholTimerPosition", section: "tools", label: "Alcohol Timer position", tool: "alcohol-timer", keywords: "move reset position" },
  { id: "skillKeyBindings", section: "tools", label: "Skill labels", tool: "skill-key-labels", keywords: "skill key labels bindings" },

  { id: "cartographyGridEnabled", section: "maps", label: "Exploration grid", detail: "Shows remaining exploration on the Mission Map and World Map.", keywords: `cartographer explore ${KEYS}` },
  { id: "cartographyCompassGridEnabled", section: "maps", label: "Markers on Compass", keywords: "unexplored cells" },
  { id: "compassRangeIndicatorsEnabled", section: "maps", label: "Compass ranges", detail: "Range rings on the Compass.", keywords: "earshot shout cast casting spirit aggro rings" },
  { id: "cartographyOverlayEnabled", section: "maps", label: "Walkable terrain", detail: "Shade areas you cannot walk on.", keywords: `walkability ${KEYS}` },
  { id: "eliteSkillsEnabled", section: "maps", label: "Elite skill planner", detail: "Adds the planner to the World Map and your Hunt list to the Mission Map.", keywords: "elite capture hunt boss signet" },
  { id: "eliteMissionMapMarkers", section: "maps", label: "Mission Map markers", keywords: "elite hunt" },
  { id: "cartographyPresetLibrary", section: "maps", label: "Map style", keywords: "colors theme cartographer" },
  { id: "cartographyBoundaryWidth", section: "maps", label: "Terrain border thickness", keywords: "outline" },
  { id: "cartographyGridOpacity", section: "maps", label: "Grid opacity", keywords: "transparency" },
  { id: "cartographyRevealMode", section: "maps", label: "Reveal range", keywords: "explore stand diamonds" },
  { id: "cartographyWalkabilityOpacity", section: "maps", label: "Walkable terrain opacity", keywords: "transparency" },
  { id: "cartographyControlIdleOpacity", section: "maps", label: "Compass control visibility", keywords: "compass opacity idle" },

  { id: "uiStyle", section: "appearance", label: "Panel style", keywords: "theme modern classic look custom colors colours" },
  { id: "uiFont", section: "appearance", label: "Panel font", keywords: "text typeface" },
  { id: "uiTextSize", section: "appearance", label: "Text size", keywords: "scale zoom bigger larger" },
  { id: "uiPanelOpacity", section: "appearance", label: "Panel opacity", keywords: "transparency" },

  game("renderScale"),
  game("extendedMemoryEnabled"),
  game("autoRelogAfterReload"),
  game("controllerPromptStyle"),
  game("showDiagnostics"),

  { id: "autoCheckUpdates", section: "updates", label: "Automatically check for launcher updates", keywords: "automatic update" },
  { id: "updateTrack", section: "updates", label: "Launcher update channel", keywords: "beta stable" },

  { id: "content.news", section: "home", label: "News", keywords: "home news" },
  { id: "content.dailies", section: "home", label: "Dailies", keywords: "daily weekly schedule" },

  { id: "openLogs", section: "advanced", label: "Open logs", keywords: "logs diagnostics support bug" },
  { id: "resetAllSettings", section: "advanced", label: "Reset all app settings", keywords: "reset defaults" },
];

export type SettingsTarget = Readonly<{ section: SettingsSection; control?: string }>;

/** Validates a deep link from another window: a known section, and a control of that section. */
export function parseSettingsTarget(value: unknown): SettingsTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings target");
  const { section, control, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length) throw new Error("Invalid settings target");
  const parsed = parseSettingsSection(section);
  if (control === undefined) return { section: parsed };
  if (!SETTINGS.some(entry => entry.id === control && entry.section === parsed)) throw new Error("Unknown setting");
  return { section: parsed, control: control as string };
}

/**
 * Settings whose label, words, description or section contain every typed word, best
 * first: a label that starts with the query, then a label that contains it, then the rest.
 */
export function searchSettings(query: string): SettingEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const phrase = words.join(" ");
  const sectionLabel = (entry: SettingEntry) => SETTINGS_SECTIONS.find(section => section.id === entry.section)!.label;
  const rank = (entry: SettingEntry) => {
    const label = entry.label.toLowerCase();
    return label.startsWith(phrase) ? 0 : label.includes(phrase) ? 1 : 2;
  };
  return SETTINGS
    .filter(entry => {
      const text = `${entry.label} ${entry.keywords ?? ""} ${entry.detail ?? ""} ${sectionLabel(entry)}`.toLowerCase();
      return words.every(word => text.includes(word));
    })
    .map((entry, order) => ({ entry, order, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ entry }) => entry);
}
