/**
 * Owns serialized settings and Travel preference access.
 * One lock prevents two windows from losing a read-modify-write across the
 * Stable-owned settings file and the Travel-owned preference document.
 */
import type {
  AppSettings,
  AppSettingsPatch,
  RendererSettingsPatch,
  SettingsResetOutcome,
} from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import { selectCartographyPreset } from "../../shared/cartography-presets.js";
import { isDeepStrictEqual } from "node:util";
import type {
  TravelPreferencesDocument,
  TravelUserPreferences,
  TravelUserPreferencesUpdate,
} from "../../shared/travel.js";
import { AtomicPublicationUnconfirmedError } from "./atomic-file.js";
import { Mutex } from "./mutex.js";
import { DEFAULT_SETTINGS } from "../../shared/contracts.js";
import { loadSettings, saveSettings } from "./settings.js";

async function travelDomain() {
  const [shared, stored] = await Promise.all([
    import("../../shared/travel.js"),
    import("./travel-preferences.js"),
  ]);
  return { shared, stored };
}

type TravelDomain = Awaited<ReturnType<typeof travelDomain>>;

export type PreferencesPaths = Readonly<{
  settings: string;
  travelPreferences: string;
}>;

function composeTravelPreferences(
  settings: AppSettings,
  travel: TravelPreferencesDocument,
  shared: TravelDomain["shared"],
): TravelUserPreferences {
  return Object.freeze({
    shortcuts: shared.travelShortcutsFromStored(settings.travelShortcuts),
    synonyms: travel.synonyms,
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
): Promise<AppSettings> {
  try {
    return await saveSettings(path, intended);
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
    if (isDeepStrictEqual(active, intended)) return active;
    throw new Error(
      "Settings were published, but gwonmac found different active values; review them before retrying.",
      { cause: error },
    );
  }
}

export class PreferencesCoordinator {
  readonly #lock = new Mutex();
  readonly #publication = new Mutex();
  readonly #paths: () => PreferencesPaths;
  readonly #onTravelRecovered:
    | ((backupPath: string) => void | Promise<void>)
    | undefined;
  readonly #publishSettings: (settings: AppSettings) => void | Promise<void>;

  constructor(
    paths: () => PreferencesPaths,
    onTravelRecovered?: (backupPath: string) => void | Promise<void>,
    publishSettings: (settings: AppSettings) => void | Promise<void> = () => undefined,
  ) {
    this.#paths = paths;
    this.#onTravelRecovered = onTravelRecovered;
    this.#publishSettings = publishSettings;
  }

  #publish(settings: AppSettings): Promise<void> {
    return this.#publication.run(async () => {
      await this.#publishSettings(settings);
    });
  }

  getSettings(): Promise<AppSettings> {
    return this.#lock.run(() => loadSettings(this.#paths().settings));
  }

  async #commitSettings(
    update: (current: AppSettings) => AppSettings,
  ): Promise<AppSettings> {
    const settings = await this.#lock.run(async () => {
      const path = this.#paths().settings;
      const current = await loadSettings(path);
      return saveSettingsAndReconcile(path, update(current));
    });
    await this.#publish(settings);
    return settings;
  }

  updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.#commitSettings((current) => ({ ...current, ...patch }));
  }

  updateRendererSettings(patch: RendererSettingsPatch): Promise<AppSettings> {
    const { cartographyPresetSelection, ...storedPatch } = patch;
    if (
      cartographyPresetSelection !== undefined
      && Object.hasOwn(storedPatch, "cartographyPresetLibrary")
    ) {
      throw new AppError(
        "bad_settings",
        "Cartography selection and library replacement are mutually exclusive",
      );
    }
    return this.#commitSettings((current) => {
      if (cartographyPresetSelection === undefined) {
        return { ...current, ...storedPatch };
      }
      const library = selectCartographyPreset(
        current.cartographyPresetLibrary,
        cartographyPresetSelection,
      );
      if (library === null) {
        throw new AppError(
          "bad_settings",
          "The selected Cartography preset no longer exists",
        );
      }
      return {
        ...current,
        ...storedPatch,
        cartographyPresetLibrary: library,
      };
    });
  }

  async resetSettings(): Promise<SettingsResetOutcome> {
    const outcome = await this.#lock.run(async () => {
      const paths = this.#paths();
      const { shared, stored } = await travelDomain();
      const settings = await saveSettingsAndReconcile(
        paths.settings,
        { ...DEFAULT_SETTINGS },
      );
      let currentTravel: TravelPreferencesDocument;
      try {
        currentTravel = await stored.loadTravelPreferences(
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
      if (isDeepStrictEqual(currentTravel, shared.DEFAULT_TRAVEL_PREFERENCES)) {
        return Object.freeze({
          status: "complete",
          settings,
          travelPreferences: composeTravelPreferences(settings, currentTravel, shared),
        });
      }
      let travel: TravelPreferencesDocument;
      try {
        travel = await stored.updateTravelPreferences(
          paths.travelPreferences,
          {
            synonyms: shared.DEFAULT_TRAVEL_PREFERENCES.synonyms,
          },
          this.#onTravelRecovered,
        );
      } catch (error) {
        if (error instanceof AtomicPublicationUnconfirmedError) {
          try {
            travel = await stored.loadTravelPreferences(
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
          if (isDeepStrictEqual(travel, shared.DEFAULT_TRAVEL_PREFERENCES)) {
            return Object.freeze({
              status: "complete",
              settings,
              travelPreferences: composeTravelPreferences(settings, travel, shared),
            });
          }
        } else {
          travel = currentTravel;
        }
        return Object.freeze({
          status: "partial",
          settings,
          travelPreferences: composeTravelPreferences(settings, travel, shared),
          pending: "travel",
        });
      }
      return Object.freeze({
        status: "complete",
        settings,
        travelPreferences: composeTravelPreferences(settings, travel, shared),
      });
    });
    await this.#publish(outcome.settings);
    return outcome;
  }

  /**
   * Resets only Core-owned settings. A Core launch must not import Travel just
   * because the player reset ordinary application preferences.
   */
  async resetCoreSettings(): Promise<SettingsResetOutcome> {
    const outcome = await this.#lock.run(async () => {
      const settingsPath = this.#paths().settings;
      const current = await loadSettings(settingsPath);
      return Object.freeze({
        status: "complete" as const,
        settings: await saveSettingsAndReconcile(settingsPath, {
          ...DEFAULT_SETTINGS,
          travelShortcuts: current.travelShortcuts,
        }),
        travelPreferences: null,
      });
    });
    await this.#publish(outcome.settings);
    return outcome;
  }

  getTravelPreferences(): Promise<TravelUserPreferences> {
    return this.#lock.run(async () => {
      const paths = this.#paths();
      const { shared, stored } = await travelDomain();
      return composeTravelPreferences(
        await loadSettings(paths.settings),
        await stored.loadTravelPreferences(
          paths.travelPreferences,
          this.#onTravelRecovered,
        ),
        shared,
      );
    });
  }

  async updateTravelPreferences(
    update: TravelUserPreferencesUpdate,
  ): Promise<TravelUserPreferences> {
    const result = await this.#lock.run(async () => {
      const paths = this.#paths();
      const { shared, stored } = await travelDomain();
      const settings = await loadSettings(paths.settings);
      const travel = await stored.loadTravelPreferences(
        paths.travelPreferences,
        this.#onTravelRecovered,
      );
      const current = composeTravelPreferences(settings, travel, shared);
      if (!shared.sameTravelUserPreferences(current, update.expected)) {
        throw new AppError(
          "validation",
          "Travel preferences changed in another window; reload before saving",
        );
      }
      try {
        if (update.patch.shortcuts !== undefined) {
          const saved = await saveSettingsAndReconcile(paths.settings, {
            ...settings,
            travelShortcuts: shared.storeTravelShortcuts(
              update.patch.shortcuts,
              settings.travelShortcuts,
            ),
          });
          return composeTravelPreferences(saved, travel, shared);
        }
        const saved = await stored.updateTravelPreferences(
          paths.travelPreferences,
          update.patch,
          this.#onTravelRecovered,
        );
        return composeTravelPreferences(settings, saved, shared);
      } catch (error) {
        if (error instanceof AtomicPublicationUnconfirmedError) {
          throw unconfirmedTravelWrite(error);
        }
        throw error;
      }
    });
    if (update.patch.shortcuts !== undefined) {
      await this.#publish(await this.getSettings());
    }
    return result;
  }
}
