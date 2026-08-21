/**
 * Owns serialized settings and Travel preference access.
 * One lock prevents two windows from losing a read-modify-write across the
 * Stable-owned settings file and the Travel-owned preference document.
 */
import type {
  AppSettings,
  AppSettingsPatch,
  SettingsResetOutcome,
} from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import { isDeepStrictEqual } from "node:util";
import {
  DEFAULT_TRAVEL_PREFERENCES,
  sameTravelUserPreferences,
  storeTravelShortcuts,
  travelShortcutsFromStored,
  type TravelPreferencesDocument,
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

async function saveSettingsAndReconcile(
  path: string,
  intended: AppSettings,
  publish: (settings: AppSettings) => void,
): Promise<AppSettings> {
  try {
    const saved = await saveSettings(path, intended);
    publish(saved);
    return saved;
  } catch (error) {
    if (!(error instanceof AtomicPublicationUnconfirmedError)) throw error;
    let active: AppSettings;
    try {
      active = await loadSettings(path);
    } catch (reloadError) {
      throw new Error(
        "Settings were published, but gwonmac could not confirm which values are active; reload before retrying.",
        { cause: reloadError },
      );
    }
    publish(active);
    if (isDeepStrictEqual(active, intended)) return active;
    throw new Error(
      "Settings were published, but gwonmac found different active values; review them before retrying.",
      { cause: error },
    );
  }
}

export class PreferencesCoordinator {
  readonly #lock = new Mutex();
  readonly #paths: () => PreferencesPaths;
  readonly #onTravelRecovered:
    | ((backupPath: string) => void | Promise<void>)
    | undefined;
  readonly #publishSettings: (settings: AppSettings) => void;

  constructor(
    paths: () => PreferencesPaths,
    onTravelRecovered?: (backupPath: string) => void | Promise<void>,
    publishSettings: (settings: AppSettings) => void = () => undefined,
  ) {
    this.#paths = paths;
    this.#onTravelRecovered = onTravelRecovered;
    this.#publishSettings = publishSettings;
  }

  getSettings(): Promise<AppSettings> {
    return this.#lock.run(() => loadSettings(this.#paths().settings));
  }

  updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.#lock.run(async () => {
      const path = this.#paths().settings;
      const current = await loadSettings(path);
      return saveSettingsAndReconcile(
        path,
        { ...current, ...patch },
        this.#publishSettings,
      );
    });
  }

  resetSettings(): Promise<SettingsResetOutcome> {
    return this.#lock.run(async () => {
      const paths = this.#paths();
      const settings = await saveSettingsAndReconcile(
        paths.settings,
        { ...DEFAULT_SETTINGS },
        this.#publishSettings,
      );
      let currentTravel: TravelPreferencesDocument;
      try {
        currentTravel = await loadTravelPreferences(
          paths.travelPreferences,
          this.#onTravelRecovered,
        );
      } catch {
        return Object.freeze({
          status: "partial",
          settings,
          travelPreferences: null,
          pending: "travel",
        });
      }
      if (isDeepStrictEqual(currentTravel, DEFAULT_TRAVEL_PREFERENCES)) {
        return Object.freeze({
          status: "complete",
          settings,
          travelPreferences: composeTravelPreferences(settings, currentTravel),
        });
      }
      let travel: TravelPreferencesDocument;
      try {
        travel = await updateTravelPreferences(
          paths.travelPreferences,
          {
            synonyms: DEFAULT_TRAVEL_PREFERENCES.synonyms,
            recentLimit: DEFAULT_TRAVEL_PREFERENCES.recentLimit,
            recentMapIds: DEFAULT_TRAVEL_PREFERENCES.recentMapIds,
          },
          this.#onTravelRecovered,
        );
      } catch (error) {
        if (error instanceof AtomicPublicationUnconfirmedError) {
          try {
            travel = await loadTravelPreferences(
              paths.travelPreferences,
              this.#onTravelRecovered,
            );
          } catch {
            return Object.freeze({
              status: "partial",
              settings,
              travelPreferences: null,
              pending: "travel",
            });
          }
          if (isDeepStrictEqual(travel, DEFAULT_TRAVEL_PREFERENCES)) {
            return Object.freeze({
              status: "complete",
              settings,
              travelPreferences: composeTravelPreferences(settings, travel),
            });
          }
        } else {
          travel = currentTravel;
        }
        return Object.freeze({
          status: "partial",
          settings,
          travelPreferences: composeTravelPreferences(settings, travel),
          pending: "travel",
        });
      }
      return Object.freeze({
        status: "complete",
        settings,
        travelPreferences: composeTravelPreferences(settings, travel),
      });
    });
  }

  getTravelPreferences(): Promise<TravelUserPreferences> {
    return this.#lock.run(async () => {
      const paths = this.#paths();
      return composeTravelPreferences(
        await loadSettings(paths.settings),
        await loadTravelPreferences(
          paths.travelPreferences,
          this.#onTravelRecovered,
        ),
      );
    });
  }

  updateTravelPreferences(
    update: TravelUserPreferencesUpdate,
  ): Promise<TravelUserPreferences> {
    return this.#lock.run(async () => {
      const paths = this.#paths();
      const settings = await loadSettings(paths.settings);
      const travel = await loadTravelPreferences(
        paths.travelPreferences,
        this.#onTravelRecovered,
      );
      const current = composeTravelPreferences(settings, travel);
      if (!sameTravelUserPreferences(current, update.expected)) {
        throw new AppError(
          "validation",
          "Travel preferences changed in another window; reload before saving",
        );
      }
      try {
        if (update.patch.shortcuts !== undefined) {
          const saved = await saveSettingsAndReconcile(paths.settings, {
            ...settings,
            travelShortcuts: storeTravelShortcuts(
              update.patch.shortcuts,
              settings.travelShortcuts,
            ),
          }, this.#publishSettings);
          return composeTravelPreferences(saved, travel);
        }
        const saved = await updateTravelPreferences(
          paths.travelPreferences,
          update.patch,
          this.#onTravelRecovered,
        );
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
          await recordConfirmedTravel(
            paths.travelPreferences,
            mapId,
            this.#onTravelRecovered,
          ),
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
