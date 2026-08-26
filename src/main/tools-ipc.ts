/**
 * Owns the optional Tools renderer-to-main channels. Main imports this module
 * only for a Tools-capable launch, so Core registers no tool implementation.
 */
import type { BrowserWindow } from "electron";
import type { ToolsInvokeChannel } from "../shared/contracts.js";
import type { BuildLibrary } from "../shared/builds/library.js";
import { parseBuildLibrary } from "../shared/builds/parse-library.js";
import {
  parseTravelUserPreferencesUpdate,
  type TravelUserPreferences,
  type TravelUserPreferencesUpdate,
} from "../shared/travel.js";
import {
  parseTravelHistoryCharacter,
  parseTravelHistoryRecord,
  type TravelCharacterKey,
  type TravelHistory,
} from "../shared/travel-history.js";
import { ValidationError } from "../shared/errors.js";
import {
  channel,
  registerChannelDefinitions,
  type AnyChannelDef,
  type Parser,
} from "./ipc-channel-registry.js";
import {
  tradeChannelDefinitions,
  type TradeIpcContext,
} from "./trade-ipc.js";
import type { WindowRegistry } from "./window-registry.js";

export type { ToolsInvokeChannel } from "../shared/contracts.js";

export interface ToolsIpcContext extends TradeIpcContext {
  readonly windows: WindowRegistry;
  getBuildLibrary(win: BrowserWindow): Promise<{
    readonly library: BuildLibrary;
    readonly recovered: boolean;
  }>;
  setBuildLibrary(win: BrowserWindow, library: BuildLibrary): Promise<BuildLibrary>;
  getTravelPreferences(): Promise<TravelUserPreferences>;
  setTravelPreferences(update: TravelUserPreferencesUpdate): Promise<TravelUserPreferences>;
  getTravelHistory(characterKey: TravelCharacterKey): Promise<TravelHistory>;
  recordTravelHistory(characterKey: TravelCharacterKey, mapId: number): Promise<TravelHistory>;
  isFeatureEnabled(feature: "buildLibrary" | "travelPalette" | "tradeChat"): boolean;
  runFeature<Value>(
    feature: "buildLibrary" | "travelPalette",
    label: string,
    operation: () => Promise<Value>,
  ): Promise<Value>;
}

const nothing: Parser<void> = (args) => {
  if (args.length !== 0) throw new ValidationError("expected 0 IPC arguments");
};

const one = <Input>(parse: (value: unknown) => Input): Parser<Input> => (args) => {
  if (args.length !== 1) throw new ValidationError("expected 1 IPC argument");
  return parse(args[0]);
};

export function registerToolsIpcHandlers(ctx: ToolsIpcContext): void {
  const handlers = {
    ...tradeChannelDefinitions(ctx),
    buildLibraryGet: channel(nothing, (win) => ctx.runFeature(
      "buildLibrary", "build library", () => ctx.getBuildLibrary(win),
    )),
    buildLibrarySet: channel(one(parseBuildLibrary), (win, library) => ctx.runFeature(
      "buildLibrary", "build library", () => ctx.setBuildLibrary(win, library),
    )),
    travelPreferencesGet: channel(nothing, () => ctx.runFeature(
      "travelPalette", "travel", () => ctx.getTravelPreferences(),
    )),
    travelPreferencesSet: channel(one(parseTravelUserPreferencesUpdate), (_win, update) =>
      ctx.runFeature("travelPalette", "travel", () => ctx.setTravelPreferences(update))),
    travelHistoryGet: channel(one(parseTravelHistoryCharacter), (_win, value) =>
      ctx.runFeature("travelPalette", "travel", () => ctx.getTravelHistory(value.characterKey))),
    travelHistoryRecord: channel(one(parseTravelHistoryRecord), (_win, value) =>
      ctx.runFeature("travelPalette", "travel", () =>
        ctx.recordTravelHistory(value.characterKey, value.mapId))),
  } satisfies Record<ToolsInvokeChannel, AnyChannelDef>;
  registerChannelDefinitions(ctx.windows, handlers);
}
