/** The two catalogue choices that belong to the player, not to a saved build. */

export type CataloguePreferences = Readonly<{
  placeableOnly: boolean;
  unlockedOnly: boolean;
}>;

const STORAGE_KEY = "gwonmac.tools.catalogue-preferences.v1";
const DEFAULTS: CataloguePreferences = Object.freeze({
  placeableOnly: false,
  unlockedOnly: false,
});

function localStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadCataloguePreferences(): CataloguePreferences {
  try {
    const saved = localStorageOrNull()?.getItem(STORAGE_KEY);
    if (!saved) return DEFAULTS;
    const value = JSON.parse(saved) as Partial<CataloguePreferences>;
    if (typeof value.placeableOnly !== "boolean" || typeof value.unlockedOnly !== "boolean") {
      return DEFAULTS;
    }
    return Object.freeze({
      placeableOnly: value.placeableOnly,
      unlockedOnly: value.unlockedOnly,
    });
  } catch {
    return DEFAULTS;
  }
}

export function saveCataloguePreferences(value: CataloguePreferences): void {
  try {
    localStorageOrNull()?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A denied storage surface makes the preference session-only; authoring stays usable.
  }
}
