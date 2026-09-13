/**
 * Defines the bounded in-game settings capability and validates its requests.
 * The existing preferences owner persists changes; launcher administration is excluded.
 */
import { parseGlobalTool, parseLauncherSettingsPatch, type GlobalToolUpdate, type LauncherSettings, type LauncherSnapshot, type ShortcutReplacement, type LauncherShortcutCaptureResult } from './launcher-contracts.js';
import { isShortcutBinding, parseShortcutAction, type ShortcutAction } from './keyboard-shortcuts.js';
export const HUB_SETTINGS_FIELDS = ['uiStyle', 'uiFont', 'uiCustomTheme', 'uiPanelOpacity', 'controllerPromptStyle', 'renderScale', 'autoRelogAfterReload', 'characterSwitchProfession', 'characterSwitchLevel', 'characterSwitchLocation', 'skillKeyBindings', 'skillCooldownColor', 'chatFilterAllyDrops', 'chatFilterHallOfHeroes', 'chatFilterTitleAchievements', 'cartographyOverlayEnabled', 'cartographyGridEnabled', 'cartographyCompassGridEnabled', 'compassRangeIndicatorsEnabled', 'compassRangeEarshotEnabled', 'compassRangeCastEnabled', 'compassRangeSpiritEnabled', 'compassRangeSpiritExtendedEnabled', 'compassRangeEarshotOpacity', 'compassRangeCastOpacity', 'compassRangeSpiritOpacity', 'compassRangeSpiritExtendedOpacity', 'compassRangeTheme', 'cartographyRevealMode', 'cartographyPresetLibrary', 'cartographyWalkabilityOpacity', 'cartographyGridOpacity', 'cartographyControlIdleOpacity'] as const satisfies readonly (keyof LauncherSettings)[];
export type HubSettingsPatch = Partial<Pick<LauncherSettings, typeof HUB_SETTINGS_FIELDS[number]>>;
export type HubSettingsSnapshot = Pick<LauncherSnapshot, 'tools' | 'shortcuts'> & { settings: HubSettingsPatch };
export type HubSettingsChange = { kind: 'settings'; patch: HubSettingsPatch } | { kind: 'tool'; tool: GlobalToolUpdate['tool']; enabled: boolean } | { kind: 'master'; enabled: boolean } | { kind: 'shortcut'; action: ShortcutReplacement['action']; binding: ShortcutReplacement['binding'] };
export interface HubSettingsApi {
  get(): Promise<HubSettingsSnapshot>;
  update(change: HubSettingsChange): Promise<void>;
  capture(action: ShortcutAction): Promise<LauncherShortcutCaptureResult>;
}
export function hubSettingsSnapshot(snapshot: LauncherSnapshot): HubSettingsSnapshot {
  const settings: HubSettingsPatch = {};
  for (const key of HUB_SETTINGS_FIELDS) Object.assign(settings, { [key]: snapshot.settings[key] });
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
