/**
 * What the Settings page's in-game sections (Tools, Maps, Appearance, Game) read and change.
 * The launcher passes its whole snapshot and bridge; the Hub passes the game window's bounded
 * copy (src/shared/hub-settings.ts), so these sections may use only the fields main lets the
 * game window change. Only the launcher can restart itself.
 */
import type { LauncherNativeApi } from "@shared/launcher-contracts";
import type { HubSettingsPatch, HubSettingsSnapshot } from "@shared/hub-settings";

export type InGameSnapshot = HubSettingsSnapshot;
export type InGameSettings = HubSettingsSnapshot["settings"];
export type InGamePatch = HubSettingsPatch;
export type InGameTools = Omit<LauncherNativeApi["tools"], "restartToApply"> & Partial<Pick<LauncherNativeApi["tools"], "restartToApply">>;
export type InGameNative = Readonly<{ settings: Readonly<{ update(patch: InGamePatch): Promise<void> }>; tools: InGameTools }>;
