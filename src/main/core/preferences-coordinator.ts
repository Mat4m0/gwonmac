/**
 * Owns serialized settings and Travel preference access.
 * One lock prevents two windows from losing a read-modify-write across the
 * Stable-owned settings file and the Travel-owned preference document.
 */
import type { AppSettings, AppSettingsPatch } from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import {
  sameTravelUserPreferences,
  storeTravelShortcuts,
  travelShortcutsFromStored,
  type TravelUserPreferences,
  type TravelUserPreferencesUpdate,
} from "../../shared/travel.js";
import { AtomicPublicationUnconfirmedError } from "./atomic-file.js";
import { Mutex } from "./mutex.js";
import { DEFAULT_SETTINGS } from "../../shared/contracts.js";
import { loadSettings, saveSettings } from "./settings.js";
import {
  loadTravelPreferences,
  recordConfirmedTravel,
  updateTravelPreferences,
} from "./travel-preferences.js";

export type PreferencesPaths = Readonly<{
  settings: string;
  travelPreferences: string;
}>;

function composeTravelPreferences(
  settings: AppSettings,
  travel: Awaited<ReturnType<typeof loadTravelPreferences>>,
): TravelUserPreferences {
  return Object.freeze({
    shortcuts: travelShortcutsFromStored(settings.travelShortcuts),
    synonyms: travel.synonyms,
    recentLimit: travel.recentLimit,
    recentMapIds: travel.recentMapIds,
  });
}

function unconfirmedTravelWrite(cause: unknown): Error {
  return new Error(
    "Travel preferences could not be saved. gwonmac could not confirm whether the new value is active; reload before retrying.",
    { cause },
  );
}

export class PreferencesCoordinator {
  readonly #lock = new Mutex();
  readonly #paths: () => PreferencesPaths;

  constructor(paths: () => PreferencesPaths) {
    this.#paths = paths;
  }

  getSettings(): Promise<AppSettings> {
    return this.#lock.run(() => loadSettings(this.#paths().settings));
  }

  updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.#lock.run(async () => {
      const path = this.#paths().settings;
      const current = await loadSettings(path);
      return saveSettings(path, { ...current, ...patch });
    });
  }

  resetSettings(): Promise<AppSettings> {
    return this.#lock.run(() =>
      saveSettings(this.#paths().settings, { ...DEFAULT_SETTINGS })
    );
  }

  getTravelPreferences(): Promise<TravelUserPreferences> {
    return this.#lock.run(async () => {
      const paths = this.#paths();
      return composeTravelPreferences(
        await loadSettings(paths.settings),
        await loadTravelPreferences(paths.travelPreferences),
      );
    });
  }

  updateTravelPreferences(
    update: TravelUserPreferencesUpdate,
  ): Promise<TravelUserPreferences> {
    return this.#lock.run(async () => {
      const paths = this.#paths();
      const settings = await loadSettings(paths.settings);
      const travel = await loadTravelPreferences(paths.travelPreferences);
      const current = composeTravelPreferences(settings, travel);
      if (!sameTravelUserPreferences(current, update.expected)) {
        throw new AppError(
          "validation",
          "Travel preferences changed in another window; reload before saving",
        );
      }
      try {
        if (update.patch.shortcuts !== undefined) {
          const saved = await saveSettings(paths.settings, {
            ...settings,
            travelShortcuts: storeTravelShortcuts(
              update.patch.shortcuts,
              settings.travelShortcuts,
            ),
          });
          return composeTravelPreferences(saved, travel);
        }
        const saved = await updateTravelPreferences(paths.travelPreferences, update.patch);
        return composeTravelPreferences(settings, saved);
      } catch (error) {
        if (error instanceof AtomicPublicationUnconfirmedError) {
          throw unconfirmedTravelWrite(error);
        }
        throw error;
      }
    });
  }

  recordTravelConfirmation(mapId: number): Promise<TravelUserPreferences> {
    return this.#lock.run(async () => {
      const paths = this.#paths();
      const settings = await loadSettings(paths.settings);
      try {
        return composeTravelPreferences(
          settings,
          await recordConfirmedTravel(paths.travelPreferences, mapId),
        );
      } catch (error) {
        if (error instanceof AtomicPublicationUnconfirmedError) {
          throw unconfirmedTravelWrite(error);
        }
        throw error;
      }
    });
  }
}
