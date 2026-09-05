/**
 * Owns the Core Command-R character palette, including focus and keyboard use.
 * It renders one bounded source and never reads game memory or native exports.
 */
import type {
  CharacterSummary,
} from "./companion-character-list-snapshot.js";
import { professionPresentation } from "../shared/profession-assets.js";
import { travelDestination } from "../shared/travel-destinations.js";
import type {
  CharacterSwitchFailureCode,
  CharacterSwitchSource,
} from "./character-switch-model.js";

const failureMessage = (code: CharacterSwitchFailureCode): string => {
  switch (code) {
    case "play-path-unproved": return "This client build has no certified Play action yet.";
    case "list-unavailable": return "Waiting for the account character list.";
    case "current-target": return "This character is already active.";
    case "busy": return "A character switch is already running.";
    case "active-pvp": return "Character switching is unavailable during active PvP.";
    case "game-loading": return "Wait until Guild Wars finishes loading, then try again.";
    case "character-select": return "Continue from the Guild Wars character selector.";
    case "state-unavailable": return "Guild Wars is not ready for character switching.";
    case "focus-lost": return "Return focus to Guild Wars and try again.";
    case "logout-refused":
    case "logout-invalid":
    case "logout-timeout": return "Guild Wars could not leave this area. Return to an outpost and try again.";
    case "target-missing":
    case "selector-timeout":
    case "selector-refused":
    case "selector-invalid":
    case "selector-frame-missing":
    case "selector-child-missing":
    case "selector-index-invalid":
    case "selector-context-invalid":
    case "selector-array-invalid":
    case "selector-target-missing":
    case "selector-parent-invalid":
    case "selection-not-confirmed":
    case "play-refused":
    case "play-invalid":
    case "play-frame-missing":
    case "play-parent-invalid":
    case "play-timeout":
    case "confirmation-timeout": return "Automatic switching stopped. Continue from the Guild Wars character selector.";
  }
};

export function orderCharacters(
  characters: readonly CharacterSummary[],
): readonly Readonly<{ character: CharacterSummary; index: number }>[] {
  return Object.freeze(characters
    .map((character, index) => Object.freeze({ character, index }))
    .sort((left, right) => left.character.name.localeCompare(
      right.character.name,
      undefined,
      { sensitivity: "base" },
    )));
}

export const CHARACTER_SEARCH_LIMIT = 40;

function normaliseCharacterQuery(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .trim()
    .toLocaleLowerCase();
}

export function searchCharacters(
  rows: ReturnType<typeof orderCharacters>,
  query: string,
): ReturnType<typeof orderCharacters> {
  if (query.length > CHARACTER_SEARCH_LIMIT) return Object.freeze([]);
  const term = normaliseCharacterQuery(query);
  if (term === "") return rows;
  const terms = term.split(/\s+/u);
  return Object.freeze(rows.filter(({ character }) => {
    const name = normaliseCharacterQuery(character.name);
    return terms.every((candidate) => name.includes(candidate));
  }));
}

export function numberedCharacterPosition(key: string, count: number): number | null {
  if (!/^[0-9]$/u.test(key)) return null;
  const position = key === "0" ? 9 : Number(key) - 1;
  return position < count ? position : null;
}

export function moveCharacterSelection(
  current: number,
  count: number,
  direction: -1 | 1,
  disabled = -1,
): number {
  if (count <= 1) return current;
  let next = current;
  for (let attempts = 0; attempts < count; attempts += 1) {
    next = (next + direction + count) % count;
    if (next !== disabled) return next;
  }
  return current;
}

export function characterCarouselRows(
  selected: number,
  count: number,
  radius = 3,
): readonly (number | null)[] {
  const capacity = radius * 2 + 1;
  if (count <= capacity) {
    const leadingSlots = Math.floor((capacity - count) / 2);
    return Object.freeze(Array.from(
      { length: capacity },
      (_, offset) => {
        const row = offset - leadingSlots;
        return row >= 0 && row < count ? row : null;
      },
    ));
  }
  return Object.freeze(Array.from(
    { length: capacity },
    (_, offset) => {
      const row = selected + offset - radius;
      return row >= 0 && row < count ? row : null;
    },
  ));
}

export function createCharacterSwitchPalette(
  parent: HTMLElement,
  source: CharacterSwitchSource,
) {
  const document = parent.ownerDocument;
  const canvas = document.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("game canvas is missing");
  const root = document.createElement("dialog");
  root.id = "character-switch-root";
  root.className = "ui-modal ui-modal-layer";
  root.setAttribute("aria-labelledby", "character-switch-title");
  root.innerHTML = `<div class="ui-frame character-switch-panel"><header class="character-switch-head"><h2 id="character-switch-title">Switch Character</h2><span class="character-switch-count" aria-live="polite" aria-atomic="true"></span><button class="ui-button character-switch-head-action character-switch-settings-toggle" type="button" aria-label="Character Switch settings" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg></button><button class="ui-button character-switch-head-action character-switch-close" type="button" aria-label="Close Switch Character"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button></header><div class="character-switch-carousel"><button class="ui-button character-switch-arrow character-switch-previous" type="button" aria-label="Previous character"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10.5 2.5-5 5 5 5"/></svg></button><ul id="character-switch-list" class="character-switch-list" aria-label="Characters"></ul><button class="ui-button character-switch-arrow character-switch-next" type="button" aria-label="Next character"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 2.5 5 5-5 5"/></svg></button></div><section class="character-switch-settings" aria-label="Character Switch settings" hidden><fieldset class="character-switch-layout-setting"><legend>Layout</legend><div><label class="ui-choice-row"><input type="radio" name="character-switch-layout" value="horizontal"><span><strong>Horizontal</strong><small>Selection-screen order</small></span></label><label class="ui-choice-row"><input type="radio" name="character-switch-layout" value="vertical"><span><strong>Vertical</strong><small>Alphabetical list</small></span></label></div></fieldset><label class="character-switch-setting" for="character-switch-enable-search"><span><strong>Show search bar</strong><small>Type from a character to search</small></span><input id="character-switch-enable-search" type="checkbox"></label><label class="character-switch-setting" for="character-switch-show-profession"><span><strong>Show profession</strong><small>Icon, primary, and secondary profession</small></span><input id="character-switch-show-profession" type="checkbox"></label><label class="character-switch-setting" for="character-switch-show-level"><span><strong>Show level</strong><small>Character level</small></span><input id="character-switch-show-level" type="checkbox"></label><label class="character-switch-setting" for="character-switch-show-location"><span><strong>Show known location</strong><small>Locations from the reviewed Travel catalogue</small></span><input id="character-switch-show-location" type="checkbox"></label></section><section class="character-switch-confirm" aria-describedby="character-switch-confirm-copy" hidden><p id="character-switch-confirm-copy">Switching characters will leave this explorable area. You may lose progress in this instance.</p><div class="character-switch-confirm-actions"><button type="button" class="ui-button character-switch-stay">Stay here</button><button type="button" class="ui-button character-switch-leave" data-variant="primary">Leave and switch</button></div></section><p class="character-switch-status" role="status" aria-live="polite" aria-atomic="true"></p><details class="character-switch-details"><summary>Technical details</summary><pre></pre><button type="button" class="ui-button character-switch-copy">Copy diagnostics</button></details><footer class="character-switch-footer"><span class="character-switch-hints character-switch-list-hints"></span><span class="character-switch-hints character-switch-settings-hints" hidden><kbd class="ui-kbd">esc</kbd> back</span><span class="character-switch-hints character-switch-confirm-hints" hidden><kbd class="ui-kbd">esc</kbd> back</span></footer></div>`;
  parent.append(root);
  const panel = root.querySelector<HTMLElement>(".character-switch-panel")!;
  const carousel = root.querySelector<HTMLElement>(".character-switch-carousel")!;
  const list = root.querySelector<HTMLUListElement>(".character-switch-list")!;
  list.classList.add("ui-scroll");
  const search = document.createElement("label");
  search.className = "character-switch-search";
  search.htmlFor = "character-switch-query";
  search.hidden = true;
  search.innerHTML = `<span class="ui-sr-only">Search characters</span><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25"/><path d="m12.4 12.4 4.1 4.1"/></svg><input id="character-switch-query" class="ui-input" type="search" role="combobox" aria-controls="character-switch-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" maxlength="${CHARACTER_SEARCH_LIMIT}" placeholder="Search characters…">`;
  carousel.before(search);
  const queryInput = search.querySelector<HTMLInputElement>("#character-switch-query")!;
  const status = root.querySelector<HTMLElement>(".character-switch-status")!;
  const title = root.querySelector<HTMLElement>("#character-switch-title")!;
  const count = root.querySelector<HTMLElement>(".character-switch-count")!;
  const settingsPanel = root.querySelector<HTMLElement>(".character-switch-settings")!;
  const confirmPanel = root.querySelector<HTMLElement>(".character-switch-confirm")!;
  const stayButton = root.querySelector<HTMLButtonElement>(".character-switch-stay")!;
  const leaveButton = root.querySelector<HTMLButtonElement>(".character-switch-leave")!;
  const settingsToggle = root.querySelector<HTMLButtonElement>(".character-switch-settings-toggle")!;
  const searchCheckbox = root.querySelector<HTMLInputElement>("#character-switch-enable-search")!;
  const professionCheckbox = root.querySelector<HTMLInputElement>("#character-switch-show-profession")!;
  const levelCheckbox = root.querySelector<HTMLInputElement>("#character-switch-show-level")!;
  const locationCheckbox = root.querySelector<HTMLInputElement>("#character-switch-show-location")!;
  const layoutInputs = [...root.querySelectorAll<HTMLInputElement>('input[name="character-switch-layout"]')];
  const previousButton = root.querySelector<HTMLButtonElement>(".character-switch-previous")!;
  const nextButton = root.querySelector<HTMLButtonElement>(".character-switch-next")!;
  const listHints = root.querySelector<HTMLElement>(".character-switch-list-hints")!;
  const settingsHints = root.querySelector<HTMLElement>(".character-switch-settings-hints")!;
  const confirmHints = root.querySelector<HTMLElement>(".character-switch-confirm-hints")!;
  const details = root.querySelector<HTMLDetailsElement>(".character-switch-details")!;
  const diagnostic = root.querySelector<HTMLElement>("pre")!;
  type ViewState =
    | Readonly<{ kind: "closed" }>
    | Readonly<{ kind: "characters" }>
    | Readonly<{ kind: "settings" }>
    | Readonly<{ kind: "confirming" }>;
  let view: ViewState = Object.freeze({ kind: "closed" });
  let selected = 0;
  let query = "";
  let layout: "horizontal" | "vertical" = "horizontal";
  let searchEnabled = true;
  type DisplayPreferences = Readonly<{
    characterSwitchProfession: boolean;
    characterSwitchLevel: boolean;
    characterSwitchLocation: boolean;
  }>;
  const displayPreferencesFrom = (settings: DisplayPreferences): DisplayPreferences => Object.freeze({
    characterSwitchProfession: settings.characterSwitchProfession,
    characterSwitchLevel: settings.characterSwitchLevel,
    characterSwitchLocation: settings.characterSwitchLocation,
  });
  let displayPreferences = displayPreferencesFrom({
    characterSwitchProfession: true,
    characterSwitchLevel: true,
    characterSwitchLocation: true,
  });
  let preferencePending = false;
  let preferenceFailure = false;
  let enabled = false;
  let rows: ReturnType<typeof orderCharacters> = [];
  const busy = () => source.action.status === "switching";
  const carouselRadius = () => window.innerWidth <= 680 ? 1 : window.innerWidth <= 1050 ? 2 : 3;
  const modal = window.gwSurfaces.registerDialog({
    root,
    priority: 7,
    transient: true,
    dismiss: () => closePalette(true),
    restoreFocus: () => canvas,
  });
  const updateRowSelection = () => {
    for (const button of list.querySelectorAll<HTMLButtonElement>("button[data-row]")) {
      button.dataset.selected = String(Number(button.dataset.row) === selected);
      if (list.getAttribute("role") === "listbox") {
        button.setAttribute("aria-selected", String(Number(button.dataset.row) === selected));
      } else button.removeAttribute("aria-selected");
    }
    const active = list.querySelector<HTMLButtonElement>(`button[data-row="${selected}"]`);
    if (active && list.getAttribute("role") === "listbox") {
      queryInput.setAttribute("aria-activedescendant", active.id);
    }
    else queryInput.removeAttribute("aria-activedescendant");
  };
  const focusSelected = () => {
    list.querySelector<HTMLButtonElement>(`button[data-row="${selected}"]`)?.focus({ preventScroll: true });
  };
  const revealSelected = () => {
    list.querySelector<HTMLButtonElement>(`button[data-row="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const render = (preserveCharacterFocus = true) => {
    if (!enabled) {
      closePalette(true);
      return;
    }
    if (source.action.status === "switching" && root.open) {
      closePalette(false);
      return;
    }
    const state = source.characters;
    const searching = state.status === "ready" && normaliseCharacterQuery(query) !== "";
    const horizontal = layout === "horizontal";
    root.dataset.layout = layout;
    panel.dataset.layout = layout;
    const focusedCharacterKey = preserveCharacterFocus
      && document.activeElement instanceof HTMLButtonElement
      && list.contains(document.activeElement)
      ? document.activeElement.dataset.characterKey
      : undefined;
    list.replaceChildren();
    root.dataset.switching = String(busy());
    const enteringFailure = source.action.status === "failed" && details.hidden;
    details.hidden = source.action.status !== "failed";
    if (enteringFailure) details.open = false;
    diagnostic.textContent = source.action.status === "failed"
      ? JSON.stringify(source.diagnostics(), null, 2)
      : "";
    if (source.action.status === "complete") return;
    if (state.status === "ready") {
      const selectedKey = rows[selected]?.character.characterKey;
      const orderedRows = horizontal
        ? state.characters.map((character, index) => Object.freeze({ character, index }))
        : orderCharacters(state.characters);
      if (horizontal || searching) list.setAttribute("role", "listbox");
      else list.removeAttribute("role");
      rows = searchCharacters(orderedRows, query);
      const preserved = selectedKey === undefined
        ? -1
        : rows.findIndex(({ character }) => character.characterKey === selectedKey);
      if (preserved >= 0) selected = preserved;
      selected = Math.min(selected, Math.max(0, rows.length - 1));
      const renderedRows = horizontal
        ? characterCarouselRows(selected, rows.length, carouselRadius())
        : rows.map((_row, rowIndex) => rowIndex);
      renderedRows.forEach((rowIndex) => {
        const item = document.createElement("li");
        item.setAttribute("role", "presentation");
        if (rowIndex === null) {
          item.className = "character-switch-slot";
          item.setAttribute("aria-hidden", "true");
          list.append(item);
          return;
        }
        const row = rows[rowIndex];
        if (!row) {
          item.className = "character-switch-slot";
          item.setAttribute("aria-hidden", "true");
          list.append(item);
          return;
        }
        const { character, index } = row;
        const profession = professionPresentation(character.primaryProfession);
        const current = index === state.selectedIndex;
        const button = document.createElement("button");
        button.type = "button";
        button.id = `character-switch-option-${index}`;
        button.className = "character-switch-row";
        if (horizontal || searching) {
          button.setAttribute("role", "option");
          button.tabIndex = -1;
        }
        button.dataset.index = String(index);
        button.dataset.row = String(rowIndex);
        button.dataset.characterKey = character.characterKey;
        button.dataset.selected = String(rowIndex === selected);
        if (horizontal || searching) button.setAttribute("aria-selected", String(rowIndex === selected));
        button.disabled = busy();
        if (current) {
          button.setAttribute("aria-current", "true");
        }
        const shortcut = !searching && rowIndex < 9 ? rowIndex + 1
          : !searching && rowIndex === 9 ? 0 : null;
        const secondaryProfession = professionPresentation(character.secondaryProfession);
        if (current) button.title = "Already active";
        const key = document.createElement("span");
        key.className = "character-switch-key";
        key.textContent = shortcut === null ? "" : String(shortcut);
        button.append(key);
        if (displayPreferences.characterSwitchProfession && profession) {
          const image = document.createElement("img");
          image.src = profession.icon;
          image.alt = "";
          image.setAttribute("aria-hidden", "true");
          button.append(image);
        }
        const name = document.createElement("span");
        name.className = "character-switch-name";
        name.textContent = character.name;
        const copy = document.createElement("span");
        copy.className = "character-switch-copyline";
        const primary = document.createElement("span");
        primary.className = "character-switch-primary";
        primary.append(name);
        if (current) {
          const marker = document.createElement("span");
          marker.className = "character-switch-current";
          marker.textContent = "Current";
          primary.append(marker);
        }
        copy.append(primary);
        const destination = displayPreferences.characterSwitchLocation
          ? travelDestination(character.mapId)
          : undefined;
        const metaParts = [
          displayPreferences.characterSwitchProfession && profession !== null
            ? secondaryProfession === null
              ? profession.name
              : `${profession.name} / ${secondaryProfession.name}`
            : undefined,
          displayPreferences.characterSwitchLevel ? `Level ${character.level}` : undefined,
          destination?.name,
        ].filter((value): value is string => value !== undefined);
        const detailLabel = metaParts.length === 0 ? "" : `, ${metaParts.join(", ")}`;
        button.setAttribute("aria-label", current
          ? `${character.name}${detailLabel}, current character`
          : `Switch to ${character.name}${detailLabel}${shortcut === null ? "" : `, shortcut ${shortcut}`}`);
        if (metaParts.length > 0) {
          const meta = document.createElement("span");
          meta.className = "character-switch-meta";
          meta.textContent = metaParts.join(" · ");
          meta.title = meta.textContent;
          copy.append(meta);
        }
        button.append(copy);
        item.append(button);
        list.append(item);
      });
    }
    count.textContent = state.status === "ready"
      ? searching
        ? `${rows.length} of ${state.characters.length}`
        : `${state.characters.length} ${state.characters.length === 1 ? "character" : "characters"}`
      : "";
    const settingsMode = view.kind === "settings";
    const confirming = view.kind === "confirming";
    title.textContent = confirming ? "Leave this area?" : "Switch Character";
    if (confirming) root.setAttribute("aria-describedby", "character-switch-confirm-copy");
    else root.removeAttribute("aria-describedby");
    list.hidden = settingsMode || confirming;
    carousel.hidden = settingsMode || confirming;
    previousButton.hidden = !horizontal || settingsMode || confirming;
    nextButton.hidden = !horizontal || settingsMode || confirming;
    previousButton.disabled = busy() || rows.length < 2;
    nextButton.disabled = busy() || rows.length < 2;
    search.hidden = !searchEnabled || settingsMode || confirming || busy();
    settingsPanel.hidden = !settingsMode;
    confirmPanel.hidden = !confirming;
    count.hidden = confirming;
    settingsToggle.hidden = confirming;
    listHints.hidden = settingsMode || confirming;
    settingsHints.hidden = !settingsMode;
    confirmHints.hidden = !confirming;
    settingsToggle.setAttribute("aria-pressed", String(settingsMode));
    settingsToggle.disabled = busy();
    searchCheckbox.checked = searchEnabled;
    professionCheckbox.checked = displayPreferences.characterSwitchProfession;
    levelCheckbox.checked = displayPreferences.characterSwitchLevel;
    locationCheckbox.checked = displayPreferences.characterSwitchLocation;
    for (const input of [
      ...layoutInputs,
      searchCheckbox,
      professionCheckbox,
      levelCheckbox,
      locationCheckbox,
    ]) {
      input.disabled = preferencePending;
    }
    for (const input of layoutInputs) input.checked = input.value === layout;
    const searchHint = searchEnabled ? ' <kbd class="ui-kbd">type</kbd> search' : "";
    listHints.innerHTML = `<kbd class="ui-kbd">←↑</kbd> <kbd class="ui-kbd">→↓</kbd> choose${searchHint} <kbd class="ui-kbd">return</kbd> switch <kbd class="ui-kbd">esc</kbd> close`;
    queryInput.setAttribute("aria-expanded", String(searching && rows.length > 0));
    if (searching) queryInput.setAttribute("aria-controls", "character-switch-list");
    else queryInput.removeAttribute("aria-controls");
    updateRowSelection();
    status.textContent = "";
    delete status.dataset.level;
    if (settingsMode && preferenceFailure) {
      status.dataset.level = "warning";
      status.textContent = "The display preference could not be saved. Try again.";
    } else if (settingsMode || confirming) status.textContent = "";
    else if (source.action.status === "failed" && source.action.code) {
      status.dataset.level = "warning";
      status.textContent = `${failureMessage(source.action.code)} (${source.action.code})`;
    } else if (state.status !== "ready") status.textContent = "Waiting for the account character list…";
    else if (searching && rows.length === 0) status.textContent = "No characters match that search.";
    else status.textContent = "";
    if (focusedCharacterKey !== undefined && view.kind === "characters") {
      const replacement = [...list.querySelectorAll<HTMLButtonElement>("button[data-character-key]")]
        .find((button) => button.dataset.characterKey === focusedCharacterKey);
      if (replacement) replacement.focus({ preventScroll: true });
      else if (searchEnabled) queryInput.focus({ preventScroll: true });
      else focusSelected();
    }
  };
  const closePalette = (resetFailure: boolean) => {
    if (view.kind === "closed") return;
    if (view.kind === "confirming") source.cancelConfirmation();
    view = Object.freeze({ kind: "closed" });
    modal.close();
    if (resetFailure && source.action.status === "failed") source.reset();
  };
  const openPalette = () => {
    if (source.action.status === "switching") return;
    if (source.action.status === "complete") source.reset();
    if (source.context === "character-select" && source.action.status !== "failed") return;
    query = "";
    queryInput.value = "";
    preferenceFailure = false;
    view = Object.freeze({ kind: "characters" });
    const state = source.characters;
    if (state.status === "ready") {
      const openingRows = layout === "horizontal"
        ? state.characters.map((character, index) => Object.freeze({ character, index }))
        : orderCharacters(state.characters);
      const current = openingRows.findIndex(({ index }) => index === state.selectedIndex);
      selected = current < 0 ? 0 : current;
    } else selected = 0;
    modal.show();
    render();
    focusSelected();
    revealSelected();
  };
  const beginRequest = (characterKey: string) => {
    if (source.action.status === "failed") source.reset();
    source.request(characterKey);
    if (source.action.status === "switching") closePalette(false);
    else if (source.action.status === "confirming") {
      view = Object.freeze({ kind: "confirming" });
      render();
      stayButton.focus({ preventScroll: true });
    }
    else render();
  };
  const requestSelected = () => {
    const state = source.characters;
    const row = rows[selected];
    if (state.status !== "ready" || !row || row.index === state.selectedIndex) return;
    beginRequest(row.character.characterKey);
  };
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (view.kind === "confirming" || view.kind === "settings") {
        if (view.kind === "confirming") source.cancelConfirmation();
        view = Object.freeze({ kind: "characters" });
        render();
        focusSelected();
      } else if (normaliseCharacterQuery(query) !== "") {
        query = "";
        queryInput.value = "";
        selected = 0;
        render();
        queryInput.focus({ preventScroll: true });
        revealSelected();
      } else closePalette(true);
    }
    else if (view.kind !== "characters") return;
    else if (event.key === "ArrowDown" && event.target === queryInput) {
      event.preventDefault();
      focusSelected();
      revealSelected();
    }
    else {
      if (normaliseCharacterQuery(query) !== "") return;
      const position = numberedCharacterPosition(event.key, Math.min(rows.length, 10));
      if (position === null) return;
      event.preventDefault();
      selected = position;
      requestSelected();
    }
  });
  queryInput.addEventListener("input", () => {
    query = queryInput.value.slice(0, CHARACTER_SEARCH_LIMIT);
    selected = 0;
    render();
    revealSelected();
  });
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && normaliseCharacterQuery(query) !== "") {
      event.preventDefault();
      event.stopPropagation();
      query = "";
      queryInput.value = "";
      selected = 0;
      render();
      queryInput.focus({ preventScroll: true });
      revealSelected();
      return;
    }
    if (event.key !== "Enter" || busy()) return;
    event.preventDefault();
    requestSelected();
  });
  list.addEventListener("keydown", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-row]");
    if (!button || view.kind !== "characters") return;
    selected = Number(button.dataset.row);
    const arrowMove = event.key === "ArrowLeft" || event.key === "ArrowRight"
      || event.key === "ArrowUp" || event.key === "ArrowDown";
    if (arrowMove) {
      event.preventDefault();
      event.stopPropagation();
      const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
      selected = moveCharacterSelection(selected, rows.length, backwards ? -1 : 1);
      render(false);
      focusSelected();
      revealSelected();
      return;
    }
    if (normaliseCharacterQuery(query) === ""
      && numberedCharacterPosition(event.key, Math.min(rows.length, 10)) !== null) return;
    if (searchEnabled && event.key.length === 1
      && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      query = event.key.slice(0, CHARACTER_SEARCH_LIMIT);
      queryInput.value = query;
      selected = 0;
      render(false);
      queryInput.focus({ preventScroll: true });
      revealSelected();
    }
  });
  list.addEventListener("focusin", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-row]")
      : null;
    if (!button) return;
    selected = Number(button.dataset.row);
    updateRowSelection();
  });
  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-index]");
    if (!button || button.disabled) return;
    selected = rows.findIndex(({ index }) => index === Number(button.dataset.index));
    requestSelected();
  });
  previousButton.addEventListener("click", () => {
    selected = moveCharacterSelection(selected, rows.length, -1);
    render();
    focusSelected();
  });
  nextButton.addEventListener("click", () => {
    selected = moveCharacterSelection(selected, rows.length, 1);
    render();
    focusSelected();
  });
  root.querySelector(".character-switch-close")!.addEventListener("click", () => closePalette(true));
  settingsToggle.addEventListener("click", () => {
    if (busy()) return;
    view = Object.freeze({ kind: view.kind === "settings" ? "characters" : "settings" });
    preferenceFailure = false;
    render();
    if (view.kind === "settings") {
      layoutInputs.find((input) => input.checked)?.focus({ preventScroll: true });
    }
    else focusSelected();
  });
  for (const input of layoutInputs) input.addEventListener("change", () => {
    if (!input.checked) return;
    layout = input.value === "vertical" ? "vertical" : "horizontal";
    preferenceFailure = false;
    render();
    input.focus({ preventScroll: true });
  });
  searchCheckbox.addEventListener("change", () => {
    searchEnabled = searchCheckbox.checked;
    if (!searchEnabled) {
      query = "";
      queryInput.value = "";
    }
    render();
    searchCheckbox.focus({ preventScroll: true });
  });
  const preferenceFields = [
    {
      key: "characterSwitchProfession",
      checkbox: professionCheckbox,
      patch: (value: boolean) => ({ characterSwitchProfession: value }),
    },
    {
      key: "characterSwitchLevel",
      checkbox: levelCheckbox,
      patch: (value: boolean) => ({ characterSwitchLevel: value }),
    },
    {
      key: "characterSwitchLocation",
      checkbox: locationCheckbox,
      patch: (value: boolean) => ({ characterSwitchLocation: value }),
    },
  ] as const;
  for (const field of preferenceFields) field.checkbox.addEventListener("change", () => {
    const next = field.checkbox.checked;
    const previous = displayPreferences[field.key];
    displayPreferences = Object.freeze({ ...displayPreferences, [field.key]: next });
    preferencePending = true;
    preferenceFailure = false;
    render();
    void window.gwNative.settings.set(field.patch(next)).then((settings) => {
      displayPreferences = displayPreferencesFrom(settings);
    }).catch(() => {
      displayPreferences = Object.freeze({ ...displayPreferences, [field.key]: previous });
      preferenceFailure = true;
    }).finally(() => {
      preferencePending = false;
      render();
      if (view.kind === "settings") field.checkbox.focus({ preventScroll: true });
    });
  });
  stayButton.addEventListener("click", () => {
    if (view.kind !== "confirming") return;
    source.cancelConfirmation();
    view = Object.freeze({ kind: "characters" });
    render();
    focusSelected();
  });
  leaveButton.addEventListener("click", () => {
    if (view.kind !== "confirming") return;
    view = Object.freeze({ kind: "characters" });
    source.confirm();
    if (source.action.status === "switching") closePalette(false);
    else render();
  });
  root.querySelector(".character-switch-copy")!.addEventListener("click", () => {
    void navigator.clipboard.writeText(JSON.stringify(source.diagnostics()));
  });
  details.addEventListener("toggle", () => {
    if (details.open) diagnostic.textContent = JSON.stringify(source.diagnostics(), null, 2);
  });
  const onToggle = (event: Event) => {
    if (!enabled) return;
    event.preventDefault();
    if (source.action.status === "switching") return;
    if (root.open) closePalette(true);
    else openPalette();
  };
  window.addEventListener("gw:character-toggle", onToggle);
  const unsubscribeSettings = window.gwNative.settings.onChange((settings) => {
    enabled = settings.characterSwitchEnabled;
    displayPreferences = displayPreferencesFrom(settings);
    render();
  });
  void window.gwNative.settings.get().then((settings) => {
    enabled = settings.characterSwitchEnabled;
    displayPreferences = displayPreferencesFrom(settings);
    render();
  }).catch(() => { /* Keep the surface closed until its enable setting is known. */ });
  const unsubscribe = source.subscribe(render);
  const resize = () => {
    if (!root.open || layout !== "horizontal" || view.kind !== "characters") return;
    render(false);
    focusSelected();
  };
  window.addEventListener("resize", resize);
  return Object.freeze({ dispose() {
    unsubscribe();
    unsubscribeSettings();
    modal.dispose();
    window.removeEventListener("gw:character-toggle", onToggle);
    window.removeEventListener("resize", resize);
    root.remove();
  } });
}
