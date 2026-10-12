/**
 * Defines the bounded in-game settings capability and validates its requests.
 * The existing preferences owner persists changes; launcher administration is excluded.
 */
import { parseGlobalTool, parseLauncherSettingsPatch, type GlobalToolUpdate, type LauncherSettings, type LauncherSnapshot, type ShortcutReplacement, type LauncherShortcutCaptureResult } from './launcher-contracts.js';
import type { ExtendedMemoryRuntimeStatus } from './contracts.js';
import type { SettingsTarget } from './settings-catalogue.js';
import { isShortcutBinding, parseShortcutAction, type ShortcutAction } from './keyboard-shortcuts.js';
export const HUB_SETTINGS_FIELDS = ['extendedMemoryEnabled', 'showDiagnostics', 'uiStyle', 'uiFont', 'uiCustomTheme', 'uiPanelOpacity', 'uiTextSize', 'controllerPromptStyle', 'renderScale', 'autoRelogAfterReload', 'characterSwitchProfession', 'characterSwitchLevel', 'characterSwitchLocation', 'skillKeyBindings', 'skillCooldownColor', 'chatFilterAllyDrops', 'chatFilterHallOfHeroes', 'chatFilterTitleAchievements', 'reminderCons', 'reminderPcons', 'reminderAlcohol', 'reminderBeforeEnd', 'reminderAtEnd', 'reminderSound', 'cartographyOverlayEnabled', 'cartographyGridEnabled', 'cartographyCompassGridEnabled', 'compassRangeIndicatorsEnabled', 'compassRangeEarshotEnabled', 'compassRangeCastEnabled', 'compassRangeSpiritEnabled', 'compassRangeSpiritExtendedEnabled', 'compassRangeEarshotOpacity', 'compassRangeCastOpacity', 'compassRangeSpiritOpacity', 'compassRangeSpiritExtendedOpacity', 'compassRangeTheme', 'cartographyRevealMode', 'cartographyPresetLibrary', 'cartographyWalkabilityOpacity', 'cartographyGridOpacity', 'cartographyControlIdleOpacity', 'eliteSkillsEnabled', 'eliteMissionMapMarkers', 'alcoholTimerPosition'] as const satisfies readonly (keyof LauncherSettings)[];
/** The settings the game window reads and changes: those of the Settings page's in-game sections. */
export type HubSettings = Pick<LauncherSettings, typeof HUB_SETTINGS_FIELDS[number]>;
export type HubSettingsPatch = Partial<HubSettings>;
export type HubSettingsSnapshot = Pick<LauncherSnapshot, 'tools' | 'shortcuts'> & { settings: HubSettings };
export type HubSettingsChange = { kind: 'settings'; patch: HubSettingsPatch } | { kind: 'tool'; tool: GlobalToolUpdate['tool']; enabled: boolean } | { kind: 'master'; enabled: boolean } | { kind: 'shortcut'; action: ShortcutReplacement['action']; binding: ShortcutReplacement['binding'] };
export interface HubSettingsApi {
  get(): Promise<HubSettingsSnapshot>;
  update(change: HubSettingsChange): Promise<void>;
  capture(action: ShortcutAction): Promise<LauncherShortcutCaptureResult>;
  /** Ends this window's capture, if any; it resolves `cancelled`. */
  cancelCapture(): Promise<void>;
}
export function hubSettingsSnapshot(snapshot: LauncherSnapshot): HubSettingsSnapshot {
  const settings = Object.fromEntries(HUB_SETTINGS_FIELDS.map(key => [key, snapshot.settings[key]])) as HubSettings;
  return { settings, tools: snapshot.tools, shortcuts: snapshot.shortcuts };
}
export function parseHubSettingsChange(value: unknown): HubSettingsChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Hub settings change');
  const keys = Object.keys(value);
  const only = (...allowed: string[]) => keys.every(key => allowed.includes(key));
  if ('kind' in value) {
    if (value.kind === 'settings' && only('kind', 'patch') && 'patch' in value && value.patch && typeof value.patch === 'object' && !Array.isArray(value.patch)) {
      if (!Object.keys(value.patch).every(key => HUB_SETTINGS_FIELDS.some(field => field === key))) throw new Error('This setting belongs to the launcher');
      return { kind: 'settings', patch: parseLauncherSettingsPatch(value.patch) };
    }
    if (value.kind === 'master' && only('kind', 'enabled') && 'enabled' in value && typeof value.enabled === 'boolean') return { kind: 'master', enabled: value.enabled };
    if (value.kind === 'tool' && only('kind', 'tool', 'enabled') && 'tool' in value && 'enabled' in value && typeof value.enabled === 'boolean') return { kind: 'tool', tool: parseGlobalTool(value.tool), enabled: value.enabled };
    if (value.kind === 'shortcut' && only('kind', 'action', 'binding') && 'action' in value && 'binding' in value && (value.binding === null || isShortcutBinding(value.binding))) return { kind: 'shortcut', action: parseShortcutAction(value.action), binding: value.binding };
  }
  throw new Error('Invalid Hub settings change');
}

/** The exports of the Hub's Settings module (`apps/launcher/src/hub-entry.ts`, built to `settings/settings-app.js`). */
export type EmbeddedSettings<Target> = Readonly<{
  mountSettings(target: Target, options: Readonly<{
    api: HubSettingsApi;
    /** Where to open; `null` reopens the last section. */
    target: SettingsTarget | null;
    /** What this game session's memory module is; the Game section says so beside Extended memory. */
    extendedMemory(): Promise<ExtendedMemoryRuntimeStatus | null>;
    /** Shows a section only the launcher draws, at its control when named. */
    openInLauncher(target: SettingsTarget): void | Promise<unknown>;
  }>): Readonly<{
    /** Shows a section, at its control when named, on the page that is already open. */
    open(target: SettingsTarget): void;
    /** Reads settings again after a change saved elsewhere. */
    refresh(): void;
    dispose(): void;
  }>;
}>;
