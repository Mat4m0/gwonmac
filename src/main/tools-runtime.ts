/**
 * Owns every optional main-process Tools implementation for one Tools-capable
 * launch. Core never imports this module, its stores, or its network client.
 */
import type { BrowserWindow } from "electron";
import type { AppSettings, SettingsResetOutcome } from "../shared/contracts.js";
import { featureActivationRequested } from "../shared/feature-contracts.js";
import { AllowlistError } from "../shared/errors.js";
import type { PreferencesCoordinator } from "./core/preferences-coordinator.js";
import type { MultipleAccountsController } from "./multiple-accounts-controller.js";
import type { GamePaths } from "./paths.js";
import type { WindowRegistry } from "./window-registry.js";
import { BuildLibraryCoordinator } from "./core/build-library-coordinator.js";
import { TradeChatService } from "./core/trade-chat-service.js";
import { TradeSavedStore } from "./core/trade-saved-store.js";
import { TravelHistoryStore } from "./core/travel-history.js";
import { registerToolsIpcHandlers } from "./tools-ipc.js";
import { Mutex } from "./core/mutex.js";

export interface ToolsRuntime {
  applySettings(settings: AppSettings): Promise<void>;
  resetSettings(): Promise<SettingsResetOutcome>;
  dispose(): Promise<void>;
}

export function createToolsRuntime(input: Readonly<{
  paths: GamePaths;
  windows: WindowRegistry;
  accounts: MultipleAccountsController;
  preferences: PreferencesCoordinator;
  initialSettings: AppSettings;
}>): ToolsRuntime {
  const buildLibraries = new BuildLibraryCoordinator();
  const tradeChat = new TradeChatService();
  const tradeSaved = new TradeSavedStore(input.paths.tradeSaved);
  const travelHistory = new TravelHistoryStore(input.paths.travelHistory);
  let settings = input.initialSettings;
  const fileGates = {
    buildLibrary: new Mutex(),
    travelPalette: new Mutex(),
  } as const;
  let tradeEnabled = featureActivationRequested("tradeChat", settings);
  const isFeatureEnabled = (
    feature: "buildLibrary" | "travelPalette" | "tradeChat",
  ): boolean => featureActivationRequested(
    feature === "travelPalette" ? "travel" : feature,
    settings,
  );

  registerToolsIpcHandlers({
    windows: input.windows,
    isFeatureEnabled,
    runFeature: (feature, label, operation) => fileGates[feature].run(async () => {
      if (!isFeatureEnabled(feature)) {
        throw new AllowlistError(`${label} is disabled`);
      }
      return operation();
    }),
    getBuildLibrary: (win: BrowserWindow) =>
      buildLibraries.get(win, input.accounts.buildLibraryPathFor(win)),
    setBuildLibrary: (win: BrowserWindow, library) =>
      buildLibraries.set(win, input.accounts.buildLibraryPathFor(win), library),
    getTravelPreferences: () => input.preferences.getTravelPreferences(),
    setTravelPreferences: (update) => input.preferences.updateTravelPreferences(update),
    getTravelHistory: (characterKey) => travelHistory.get(characterKey),
    recordTravelHistory: (characterKey, mapId) =>
      travelHistory.record(characterKey, mapId),
    tradeChat,
    getTradeSaved: () => tradeSaved.get(),
    setTradeSaved: (value) => tradeSaved.set(value),
  });

  return Object.freeze({
    async applySettings(nextSettings: AppSettings) {
      const nextTradeEnabled = featureActivationRequested("tradeChat", nextSettings);
      settings = nextSettings;
      if (tradeEnabled && !nextTradeEnabled) tradeChat.dispose();
      tradeEnabled = nextTradeEnabled;
      await Promise.all([
        fileGates.buildLibrary.settled,
        fileGates.travelPalette.settled,
      ]);
    },
    resetSettings: () => input.preferences.resetSettings(),
    async dispose() {
      settings = { ...settings, gwonmacTools: false };
      tradeEnabled = false;
      tradeChat.dispose();
      await Promise.all([
        fileGates.buildLibrary.settled,
        fileGates.travelPalette.settled,
      ]);
    },
  });
}
