/**
 * Owns the Core Command-E character palette, including focus and keyboard use.
 * It renders one bounded source and never reads game memory or native exports.
 */
import { installSearchEditing, resumeSearchInput } from "./search-input.js";
import { isHubBackKey } from "../shared/keyboard-shortcuts.js";
import { hubMatch, normaliseHubQuery, type HubViewFooter } from "../shared/hub.js";
import type {
  CharacterSummary,
} from "./companion-character-list-snapshot.js";
import { professionPresentation } from "../shared/profession-assets.js";
import { travelDestination } from "../shared/travel-destinations.js";
import type {
  CharacterSwitchFailureCode,
  CharacterSwitchSource,
} from "./character-switch-model.js";
import { currentCharacterIndex } from "./character-switch-model.js";
import { closeDisclosure } from "./surface-controller.js";
import { bindLeaveAreaChoice, leaveAreaCopy } from "./leave-area.js";
import { listIndexAfter, listKeyStep } from "../shared/ui/list-keys.js";

const failureMessage = (code: CharacterSwitchFailureCode): string => {
  switch (code) {
    case "play-path-unproved": return "This client build has no certified Play action yet.";
    case "list-unavailable": return "Waiting for the account character list.";
    case "current-target": return "This character is already active.";
    case "busy": return "A character switch is already running.";
    case "active-pvp": return "Character switching is unavailable during active PvP.";
    case "game-loading": return "Wait until Guild Wars finishes loading, then try again.";
    case "state-unavailable": return "Guild Wars is not ready for character switching.";
    case "focus-lost": return "Return focus to Guild Wars and try again.";
    case "logout-refused":
    case "logout-invalid":
    case "logout-timeout": return "Guild Wars did not return to the character selector. Try again.";
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

/** Refusals that follow a rule; an unexpected stop also offers Technical details (HUB-073). */
const RULE_REFUSALS: ReadonlySet<CharacterSwitchFailureCode> = new Set([
  "play-path-unproved", "list-unavailable", "current-target", "busy", "active-pvp",
  "game-loading", "state-unavailable", "focus-lost",
]);

/** Why the game state refuses any switch right now, before a card is chosen (HUB-073). */
export function characterSwitchRefusal(source: Pick<CharacterSwitchSource, "context" | "action">): string | null {
  if (source.action.status === "failed" && source.action.code === "play-path-unproved") return failureMessage("play-path-unproved");
  switch (source.context) {
    case "pvp-explorable": return failureMessage("active-pvp");
    case "loading": return failureMessage("game-loading");
    case "unavailable": return failureMessage("state-unavailable");
    default: return null;
  }
}

/** Keeps the observed character order and each account index together. */
export function characterRows(characters: readonly CharacterSummary[]) {
  return Object.freeze(characters.map((character, index) => Object.freeze({ character, index })));
}

export const CHARACTER_SEARCH_LIMIT = 40;
/** The narrowest readable card in the Hub, and the gap between cards (hub.css). */
const CARD_MIN_WIDTH = 100;
const CARD_GAP = 8;

const normaliseCharacterQuery = normaliseHubQuery;

export function searchCharacters(
  rows: ReturnType<typeof characterRows>,
  query: string,
): ReturnType<typeof characterRows> {
  if (query.length > CHARACTER_SEARCH_LIMIT) return Object.freeze([]);
  const term = normaliseCharacterQuery(query);
  if (term === "") return rows;
  return Object.freeze(rows.filter(({ character }) => {
    const profession = professionPresentation(character.primaryProfession);
    return hubMatch(character.name, term, profession ? [profession.name] : []) !== null;
  }));
}

const isDigitKey = (key: string) => /^[0-9]$/u.test(key);

export function numberedCharacterPosition(key: string, count: number): number | null {
  if (!isDigitKey(key)) return null;
  const position = key === "0" ? 9 : Number(key) - 1;
  return position < count ? position : null;
}

export function characterCarouselRows(
  selected: number,
  count: number,
  radius = 3,
): readonly (number | null)[] {
  const capacity = radius * 2 + 1;
  const start = Math.max(0, Math.min(selected - radius, count - capacity));
  return Object.freeze(Array.from({ length: capacity }, (_, offset) => {
    const row = start + offset;
    return row < count ? row : null;
  }));
}

export function createCharacterSwitchPalette(
  parent: HTMLElement,
  source: CharacterSwitchSource,
) {
  const document = parent.ownerDocument;
  const hub = window.gwHub;
  if (!hub) throw new Error("Hub is not installed");
  const canvas = document.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("game canvas is missing");
  const root = document.createElement("dialog");
  root.id = "character-switch-root";
  root.className = "ui-modal ui-modal-layer";
  root.setAttribute("aria-labelledby", "character-switch-title");
  root.innerHTML = `<div class="ui-frame character-switch-panel"><header class="character-switch-head"><h2 id="character-switch-title">Switch Character</h2><span class="character-switch-count" aria-live="polite" aria-atomic="true"></span><button class="ui-button character-switch-head-action character-switch-settings-toggle" type="button" aria-label="Character Switch settings" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg></button><button class="ui-button character-switch-head-action character-switch-close" type="button" aria-label="Close Switch Character"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button></header><div class="character-switch-carousel"><button class="ui-button character-switch-arrow character-switch-previous" type="button" aria-label="Previous character"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10.5 2.5-5 5 5 5"/></svg></button><ul id="character-switch-list" class="character-switch-list" aria-label="Characters"></ul><button class="ui-button character-switch-arrow character-switch-next" type="button" aria-label="Next character"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 2.5 5 5-5 5"/></svg></button></div><section class="character-switch-settings" aria-label="Character Switch settings" hidden><label class="character-switch-setting" for="character-switch-show-profession"><span><strong>Show profession</strong><small>Icon, primary, and secondary profession</small></span><input id="character-switch-show-profession" type="checkbox"></label><label class="character-switch-setting" for="character-switch-show-level"><span><strong>Show level</strong><small>Character level</small></span><input id="character-switch-show-level" type="checkbox"></label><label class="character-switch-setting" for="character-switch-show-location"><span><strong>Show known location</strong><small>Locations from the reviewed Travel catalogue</small></span><input id="character-switch-show-location" type="checkbox"></label></section><section class="character-switch-confirm" aria-describedby="character-switch-confirm-copy" hidden><p id="character-switch-confirm-copy">Switching characters will leave this explorable area. You may lose progress in this instance.</p><div class="character-switch-confirm-actions"><button type="button" id="character-switch-stay" class="ui-button character-switch-stay">Stay here</button><button type="button" id="character-switch-leave" class="ui-button character-switch-leave" data-variant="danger">Leave and switch</button></div></section><p class="character-switch-status" role="status" aria-live="polite" aria-atomic="true"></p><details class="character-switch-details"><summary>Technical details</summary><pre></pre><button type="button" class="ui-button character-switch-copy">Copy diagnostics</button></details></div>`;
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
  const confirmCopy = root.querySelector<HTMLElement>("#character-switch-confirm-copy")!;
  const stayButton = root.querySelector<HTMLButtonElement>(".character-switch-stay")!;
  const leaveButton = root.querySelector<HTMLButtonElement>(".character-switch-leave")!;
  // The shared leave-area step: its words, its arming and its ← → between the two choices (D-27).
  const leaveChoice = bindLeaveAreaChoice(stayButton, leaveButton);
  const settingsToggle = root.querySelector<HTMLButtonElement>(".character-switch-settings-toggle")!;
  const professionCheckbox = root.querySelector<HTMLInputElement>("#character-switch-show-profession")!;
  const levelCheckbox = root.querySelector<HTMLInputElement>("#character-switch-show-level")!;
  const locationCheckbox = root.querySelector<HTMLInputElement>("#character-switch-show-location")!;
  const previousButton = root.querySelector<HTMLButtonElement>(".character-switch-previous")!;
  const nextButton = root.querySelector<HTMLButtonElement>(".character-switch-next")!;
  const disposeSearchEditing = installSearchEditing(list, queryInput);
  const details = root.querySelector<HTMLDetailsElement>(".character-switch-details")!;
  const diagnostic = root.querySelector<HTMLElement>("pre")!;
  type ViewState =
    | Readonly<{ kind: "closed" }>
    | Readonly<{ kind: "characters" }>
    | Readonly<{ kind: "settings" }>
    | Readonly<{ kind: "confirming" }>;
  let view: ViewState = Object.freeze({ kind: "closed" });
  /** The card the current click run selected; only its own double-click switches. */
  let pressedKey: string | undefined;
  /**
   * The character a "Leave this area?" confirmation would switch to, and whether a Hub
   * row asked for it (HUB-034, HUB-075). Cancelling a row's confirmation returns to that row.
   */
  let confirmingTarget: Readonly<{ name: string; fromRow: boolean }> | null = null;
  let selected = 0;
  let query = "";
  /** The card chosen before a search began; clearing the search returns to it (HUB-197). */
  let preSearchKey: string | undefined;
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
  let rows: ReturnType<typeof characterRows> = [];
  let withdrawnForSwitch = false;
  /** The character the last switch asked for; after a failure the next opening starts on it (HUB-035). */
  let requestedKey: string | undefined;
  let attemptedKey: string | undefined;
  const busy = () => source.action.status === "switching";
  /**
   * In the Hub, as many cards as fit at 100 px or more in the carousel's own width, one, three
   * or five, whatever the window or the Hub's size (HUB-076).
   */
  const carouselRadius = () => {
    const width = list.clientWidth;
    if (!width) return 2;
    const fit = Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP));
    return fit >= 5 ? 2 : fit >= 3 ? 1 : 0;
  };
  // In the Hub the search leads the view, so it leads the Tab order too (HUB-138).
  panel.prepend(search);
  let hubBack: (() => void) | undefined;
  /** The Hub footer names the switch; Characters has no separate footer. */
  let hubFooter: HubViewFooter | undefined;
  const modal = {
    show() { hub.showView('Characters', (target, back, footer) => {
      hubFooter = footer;
      hubBack = back;
      target.append(root); root.open = true;
      if (view.kind === "closed") { view = Object.freeze({ kind: "characters" }); render(); }
      focusSelected();
      return () => { hubBack = undefined; hubFooter = undefined; root.open = false; parent.append(root); if (view.kind === 'confirming') source.cancelConfirmation(); view = { kind: 'closed' }; };
    }, () => !!window.gwToolsSettings?.().characterSwitchEnabled, "characters"); },
    close() { hub.close(); },
    pageChanged() { hub.pageChanged(); },
    dispose() { if (root.open) hub.close(); },
  };
  /**
   * While an accepted switch runs, one quiet line covers the game: it names the character and
   * absorbs pointer presses, so no click can reach the selector and redirect Play (D-30, HUB-247).
   * It holds no control and goes away on completion or failure; a failure names itself in the
   * Hub receipt.
   */
  const veil = document.createElement("div");
  veil.className = "character-switch-veil";
  veil.setAttribute("role", "status");
  veil.hidden = true;
  for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "wheel"]) {
    veil.addEventListener(type, (event) => { event.preventDefault(); event.stopPropagation(); }, { passive: false });
  }
  parent.append(veil);
  const paintVeil = () => {
    const switching = busy() && withdrawnForSwitch;
    const state = source.characters;
    const name = state.status === "ready"
      ? state.characters.find(({ characterKey }) => characterKey === requestedKey)?.name : undefined;
    const text = switching ? `Switching to ${name ?? "your character"}…` : "";
    if (veil.textContent !== text) veil.textContent = text;
    veil.hidden = !switching;
  };
  /** A refusal answered one request; choosing another card clears it (HUB-199). */
  const clearAnsweredFailure = () => {
    if (source.action.status === "failed" && view.kind === "characters") source.reset();
  };
  const updateRowSelection = () => {
    // One Tab stop for the cards, on the selected one (roving tabindex, HUB-138).
    for (const button of list.querySelectorAll<HTMLButtonElement>("button[data-row]")) {
      button.dataset.selected = String(Number(button.dataset.row) === selected);
      button.tabIndex = Number(button.dataset.row) === selected ? 0 : -1;
      if (list.getAttribute("role") === "listbox") {
        button.setAttribute("aria-selected", String(Number(button.dataset.row) === selected));
      } else button.removeAttribute("aria-selected");
    }
    const active = list.querySelector<HTMLButtonElement>(`button[data-row="${selected}"]`);
    if (active && list.getAttribute("role") === "listbox") {
      queryInput.setAttribute("aria-activedescendant", active.id);
    }
    else queryInput.removeAttribute("aria-activedescendant");
    // The footer names what Enter does; it disables instead of hiding, so nothing slides under the pointer.
    const row = view.kind === "characters" && source.characters.status === "ready" ? rows[selected] : undefined;
    const current = row !== undefined && row.index === currentCharacterIndex(source);
    const refused = characterSwitchRefusal(source) !== null;
    // The Hub footer: the switch on the cards, Done in the settings, and the safe Stay here while
    // a confirmation asks; the armed Leave and switch stays in the confirmation itself.
    hubFooter?.primary(view.kind === "settings" ? { label: "Done", run: () => settingsToggle.click() }
      : view.kind === "confirming" ? { label: "Stay here", run: () => stayButton.click() }
      : { label: row ? current ? "Current character" : `Switch to ${row.character.name}` : "Switch character", disabled: !row || current || busy() || refused, run: () => requestSelected() });
    // The ends hold, so the arrow that cannot move is disabled.
    previousButton.disabled = busy() || selected <= 0;
    nextButton.disabled = busy() || selected >= rows.length - 1;
  };
  const focusSelected = () => {
    list.querySelector<HTMLButtonElement>(`button[data-row="${selected}"]`)?.focus({ preventScroll: true });
  };
  const revealSelected = () => {
    list.querySelector<HTMLButtonElement>(`button[data-row="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };
  let renderedView: ViewState["kind"] = "closed";
  /** The palette opened before the account's character list arrived. */
  let awaitingList = false;
  let arrived = false;
  const render = (preserveCharacterFocus = true) => {
    if (view.kind !== renderedView) {
      // A new inner page (the cards, a confirmation, the settings) cancels a
      // click run that began before it, and "Leave and switch" arms anew (HUB-242).
      renderedView = view.kind;
      pressedKey = undefined;
      modal.pageChanged();
      if (view.kind === "confirming") leaveChoice.arm();
      else leaveChoice.disarm();
    }
    if (!enabled) {
      closePalette(true);
      return;
    }
    // An accepted switch leaves the current game state. Withdraw once from
    // the action itself, not from local view state: a blurred Hub can keep
    // this view mounted while it is hidden and resume it later.
    // A switch that fails after the palette withdrew is reported through the Hub's receipt, never
    // only inside the closed palette; the next opening starts on the attempted card (HUB-035).
    if (!busy() && withdrawnForSwitch && view.kind === "closed" && source.action.status === "failed") {
      attemptedKey = requestedKey;
      hub.notify(failureMessage(source.action.code), "failed");
    }
    if (!busy()) withdrawnForSwitch = false;
    else if (!withdrawnForSwitch) {
      withdrawnForSwitch = true;
      view = Object.freeze({ kind: "closed" });
      modal.close();
      paintVeil();
      return;
    }
    paintVeil();
    const state = source.characters;
    const searching = state.status === "ready" && normaliseCharacterQuery(query) !== "";
    root.dataset.layout = "horizontal";
    panel.dataset.layout = root.dataset.layout;
    const focusedCharacterKey = preserveCharacterFocus
      && document.activeElement instanceof HTMLButtonElement
      && list.contains(document.activeElement)
      ? document.activeElement.dataset.characterKey
      : undefined;
    list.replaceChildren();
    root.dataset.switching = String(busy());
    // Technical details belong to an unexpected stop, never to a refusal that follows a rule (HUB-073).
    const unexpected = source.action.status === "failed" && !RULE_REFUSALS.has(source.action.code);
    const enteringFailure = unexpected && details.hidden;
    details.hidden = !unexpected;
    if (enteringFailure) details.open = false;
    diagnostic.textContent = source.action.status === "failed"
      ? JSON.stringify(source.diagnostics(), null, 2)
      : "";
    if (source.action.status === "complete") return;
    const refusal = characterSwitchRefusal(source);
    if (state.status === "ready") {
      const selectedKey = rows[selected]?.character.characterKey;
      const orderedRows = characterRows(state.characters);
      list.setAttribute("role", "listbox");
      rows = searchCharacters(orderedRows, query);
      const preserved = selectedKey === undefined
        ? -1
        : rows.findIndex(({ character }) => character.characterKey === selectedKey);
      if (preserved >= 0) selected = preserved;
      // A list that arrives after the palette opened starts on the current character, like an
      // opening with the list at hand, and takes the keyboard unless the player is searching (HUB-074).
      else if (awaitingList) {
        const current = rows.findIndex(({ index }) => index === state.selectedIndex);
        if (current >= 0) selected = current;
        arrived = !searching;
      }
      awaitingList = false;
      selected = Math.min(selected, Math.max(0, rows.length - 1));
      const radius = carouselRadius();
      list.style.setProperty("--character-cards", String(radius * 2 + 1));
      const renderedRows = characterCarouselRows(selected, rows.length, radius);
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
        const current = index === currentCharacterIndex(source);
        const button = document.createElement("button");
        button.type = "button";
        button.id = `character-switch-option-${index}`;
        button.className = "character-switch-row";
        button.setAttribute("role", "option");
        button.dataset.index = String(index);
        button.dataset.row = String(rowIndex);
        button.dataset.characterKey = character.characterKey;
        button.dataset.selected = String(rowIndex === selected);
        button.setAttribute("aria-selected", String(rowIndex === selected));
        button.disabled = busy();
        if (refusal !== null) button.setAttribute("aria-disabled", "true");
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
          displayPreferences.characterSwitchProfession && character.characterType === "pvp" ? "PvP character" : undefined,
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
          // In the Hub the card names the profession pair, "Mo/Me", and a PvP character (HUB-194).
          meta.textContent = [displayPreferences.characterSwitchProfession && profession
                ? `${profession.code}${secondaryProfession ? `/${secondaryProfession.code}` : ""}${character.characterType === "pvp" ? " · PvP" : ""}` : '',
              displayPreferences.characterSwitchLevel ? `Lv ${character.level}` : '', destination?.name.split(',')[0]].filter(Boolean).join(' · ');
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
    const pending = confirming ? confirmingTarget : null;
    const copy = leaveAreaCopy("switch", pending?.name ?? "this character");
    title.textContent = confirming ? copy.question : "Switch Character";
    // In the Hub the breadcrumb names the page; the heading shows only the question it asks (HUB-199).
    title.classList.toggle("ui-sr-only", !confirming);
    confirmCopy.textContent = copy.detail;
    leaveButton.textContent = copy.leave;
    if (confirming) root.setAttribute("aria-describedby", "character-switch-confirm-copy");
    else root.removeAttribute("aria-describedby");
    list.hidden = settingsMode || confirming;
    carousel.hidden = settingsMode || confirming;
    previousButton.hidden = settingsMode || confirming;
    nextButton.hidden = settingsMode || confirming;
    search.hidden = settingsMode || confirming || busy();
    settingsPanel.hidden = !settingsMode;
    confirmPanel.hidden = !confirming;
    count.hidden = confirming;
    settingsToggle.hidden = confirming;
    // No switch hints while the list is still on its way: there is nothing to choose yet (HUB-074).
    settingsToggle.setAttribute("aria-pressed", String(settingsMode));
    settingsToggle.disabled = busy();
    professionCheckbox.checked = displayPreferences.characterSwitchProfession;
    levelCheckbox.checked = displayPreferences.characterSwitchLevel;
    locationCheckbox.checked = displayPreferences.characterSwitchLocation;
    for (const input of [
      professionCheckbox,
      levelCheckbox,
      locationCheckbox,
    ]) {
      input.disabled = preferencePending;
    }
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
      status.textContent = failureMessage(source.action.code);
    } else if (refusal !== null) {
      status.dataset.level = "warning";
      status.textContent = refusal;
    } else if (state.status !== "ready") status.textContent = "Waiting for the account character list…";
    else if (searching && rows.length === 0) status.textContent = "No characters match that search.";
    else status.textContent = "";
    if (arrived && view.kind === "characters" && !searching) { arrived = false; focusSelected(); }
    else if (focusedCharacterKey !== undefined && view.kind === "characters") {
      const replacement = [...list.querySelectorAll<HTMLButtonElement>("button[data-character-key]")]
        .find((button) => button.dataset.characterKey === focusedCharacterKey);
      if (replacement) replacement.focus({ preventScroll: true });
      else queryInput.focus({ preventScroll: true });
    }
  };
  const closePalette = (resetFailure: boolean) => {
    if (view.kind === "closed") return;
    if (view.kind === "confirming") source.cancelConfirmation();
    view = Object.freeze({ kind: "closed" });
    modal.close();
    if (resetFailure && source.action.status === "failed") source.reset();
  };
  /**
   * Opens on the current character, or on `characterKey` when a Hub row reveals one.
   * The rows are rebuilt first, so a search from before the close never picks the card (HUB-009).
   */
  const openPalette = (characterKey?: string) => {
    if (source.action.status === "switching") return;
    if (source.action.status === "complete") source.reset();
    query = "";
    queryInput.value = "";
    preferenceFailure = false;
    view = Object.freeze({ kind: "characters" });
    const state = source.characters;
    if (state.status === "ready") {
      rows = characterRows(state.characters);
      const wanted = characterKey ?? attemptedKey;
      attemptedKey = undefined;
      const opening = rows.findIndex(({ character, index }) => wanted === undefined
        ? index === state.selectedIndex : character.characterKey === wanted);
      selected = opening < 0 ? 0 : opening;
    } else {
      rows = [];
      selected = 0;
    }
    awaitingList = state.status !== "ready";
    modal.show();
    render();
    focusSelected();
    revealSelected();
  };
  const beginRequest = (characterKey: string) => {
    if (source.action.status === "failed") source.reset();
    requestedKey = characterKey;
    source.request(characterKey);
    if (source.action.status === "confirming") {
      const state = source.characters;
      const name = state.status === "ready"
        ? state.characters.find((character) => character.characterKey === characterKey)?.name : undefined;
      confirmingTarget = Object.freeze({ name: name ?? "this character", fromRow: view.kind === "closed" });
      if (view.kind === "closed") openPalette(characterKey);
      view = Object.freeze({ kind: "confirming" });
      render();
      stayButton.focus({ preventScroll: true });
    }
    else render();
  };
  const requestSelected = () => {
    const state = source.characters;
    const row = rows[selected];
    if (state.status !== "ready" || !row || row.index === currentCharacterIndex(source) || characterSwitchRefusal(source) !== null) return;
    beginRequest(row.character.characterKey);
  };
  /**
   * Esc, Stay here, and ⌘⌫ in the Hub: a confirmation cancels and the settings close, back to
   * the cards. A confirmation a Hub row asked for returns to that row instead (HUB-075).
   */
  const leaveInnerView = () => {
    const fromRow = view.kind === "confirming" && confirmingTarget?.fromRow === true;
    if (view.kind === "confirming") source.cancelConfirmation();
    view = Object.freeze({ kind: "characters" });
    if (fromRow && hubBack) { hubBack(); return; }
    render();
    focusSelected();
  };
  // The panel answers first; the surface controller's Escape rule on the dialog root runs after it.
  panel.addEventListener("keydown", (event) => {
    // Escape during composition cancels the composition, never the query (HUB-140).
    if (event.isComposing || event.defaultPrevented) return;
    // From the cards ⌘⌫ is the Hub's own Back; one level per physical press.
    if (isHubBackKey(event) && (view.kind === "confirming" || view.kind === "settings")) {
      event.preventDefault();
      if (!event.repeat) leaveInnerView();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // One step per physical press; an open disclosure is the innermost level.
      if (event.repeat || closeDisclosure(event.target, panel)) return;
      if (view.kind === "confirming" || view.kind === "settings") leaveInnerView();
      else if (normaliseCharacterQuery(query) !== "") {
        query = "";
        queryInput.value = "";
        render();
        selectKey(preSearchKey);
        queryInput.focus({ preventScroll: true });
        revealSelected();
      } else if (hubBack) hubBack(); else closePalette(true);
    }
    else if (view.kind !== "characters") return;
    else if (event.key === "ArrowDown" && event.target === queryInput) {
      event.preventDefault();
      focusSelected();
      revealSelected();
    }
    // The search is the top of the view: ↑ there stays, like at the top of every list.
    else if (event.key === "ArrowUp" && event.target === queryInput) event.preventDefault();
    else {
      // A digit selects and reveals its card; only Enter switches (D-5, HUB-002).
      if (normaliseCharacterQuery(query) !== "" || event.target instanceof HTMLInputElement
        || !isDigitKey(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      const position = numberedCharacterPosition(event.key, Math.min(rows.length, 10));
      if (position === null || event.repeat) return;
      clearAnsweredFailure();
      selected = position;
      render(false);
      focusSelected();
      revealSelected();
    }
  });
  /** Selects the card with this key when it is listed, else the first card. */
  const selectKey = (key: string | undefined) => {
    const index = rows.findIndex(({ character }) => character.characterKey === key);
    selected = index < 0 ? 0 : index;
    render(false);
  };
  /**
   * A search keeps the chosen card while it still matches, and clearing the search returns to
   * the card chosen before it began; a space or a paste never moves the selection (HUB-197).
   */
  queryInput.addEventListener("input", () => {
    const wasSearching = normaliseCharacterQuery(query) !== "";
    const chosen = rows[selected]?.character.characterKey;
    if (!wasSearching) preSearchKey = chosen;
    query = queryInput.value.slice(0, CHARACTER_SEARCH_LIMIT);
    render();
    selectKey(normaliseCharacterQuery(query) === "" ? preSearchKey : chosen);
    revealSelected();
  });
  queryInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || busy() || event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    requestSelected();
  });
  list.addEventListener("keydown", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-row]");
    if (!button || view.kind !== "characters") return;
    selected = Number(button.dataset.row);
    if (event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation(); queryInput.focus({ preventScroll: true }); return;
    }
    // The shared list move: arrows, ⌃N/⌃P, PgUp/PgDn by a visible page, Home/End; the carousel never wraps.
    const step = listKeyStep(event, Math.max(1, list.querySelectorAll("button[data-row]").length - 1), true);
    if (step !== null) {
      event.preventDefault();
      event.stopPropagation();
      clearAnsweredFailure();
      selected = listIndexAfter(selected, rows.length, step);
      render(false);
      focusSelected();
      revealSelected();
      return;
    }
    // Without a query a digit is a card number, never search text.
    if (normaliseCharacterQuery(query) === "" && isDigitKey(event.key)) return;
    resumeSearchInput(event, queryInput);
  });
  list.addEventListener("focusin", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-row]")
      : null;
    if (!button) return;
    selected = Number(button.dataset.row);
    updateRowSelection();
  });
  // A click selects a card; Enter, the footer primary or a double-click that
  // started on the same card switches (D-24). A keyboard activation (detail 0)
  // switches as before.
  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-index]");
    if (!button || button.disabled) return;
    selected = rows.findIndex(({ index }) => index === Number(button.dataset.index));
    if (event.detail === 1) {
      pressedKey = button.dataset.characterKey;
      clearAnsweredFailure();
      updateRowSelection();
    } else if (event.detail === 0 || (event.detail === 2 && pressedKey === button.dataset.characterKey)) requestSelected();
  });
  // Right-click selects a card like a click and switches nothing, even as part
  // of a later double-click (HUB-248). A card has no Actions of its own.
  list.addEventListener("contextmenu", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-index]");
    if (!button) return;
    event.preventDefault();
    if (button.disabled) return;
    selected = rows.findIndex(({ index }) => index === Number(button.dataset.index));
    pressedKey = undefined;
    updateRowSelection();
    button.focus({ preventScroll: true });
  });
  previousButton.addEventListener("click", () => {
    selected = listIndexAfter(selected, rows.length, -1);
    render();
    focusSelected();
  });
  nextButton.addEventListener("click", () => {
    selected = listIndexAfter(selected, rows.length, 1);
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
      professionCheckbox.focus({ preventScroll: true });
    }
    else focusSelected();
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
    if (view.kind === "confirming") leaveInnerView();
  });
  leaveButton.addEventListener("click", (event) => {
    if (view.kind !== "confirming" || !leaveChoice.accepts(event)) return;
    view = Object.freeze({ kind: "characters" });
    source.confirm();
    render();
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
    // A second request while one runs is answered, never silent (HUB-193).
    if (source.action.status === "switching") { hub.notify(failureMessage("busy")); return; }
    // In the Hub, ⌘E follows the Hub's direct-shortcut contract: it focuses or resumes
    // Characters and never closes the Hub (HUB-049).
    hub.direct("characters", () => openPalette());
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
    if (!root.open || view.kind !== "characters") return;
    render(false);
    focusSelected();
  };
  window.addEventListener("resize", resize);
  // The Hub can be resized without a window resize; the card count follows the carousel's width.
  let observedRadius = -1;
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    const radius = carouselRadius();
    if (radius !== observedRadius) { observedRadius = radius; if (root.open && view.kind === "characters") render(); }
  }) : null;
  resizeObserver?.observe(list);
  return Object.freeze({
    // Hub selects a character directly. The palette appears only when the
    // switch needs PvE departure confirmation; the caller reports a refusal.
    activate(characterKey: string): Error | undefined {
      if (!enabled) return new Error("Character switching is not available right now.");
      if (busy()) return new Error(failureMessage("busy"));
      beginRequest(characterKey);
      if (source.action.status !== "failed" || view.kind !== "closed") return undefined;
      const refusal = new Error(failureMessage(source.action.code));
      source.reset();
      return refusal;
    },
    /** A Hub row that names no single character opens the cards on it and switches nothing (HUB-033). */
    reveal(characterKey: string): Error | undefined {
      if (!enabled) return new Error("Character switching is not available right now.");
      if (busy()) return new Error(failureMessage("busy"));
      openPalette(characterKey);
      return undefined;
    },
    dispose() {
      disposeSearchEditing();
      unsubscribe();
      unsubscribeSettings();
      modal.dispose();
      window.removeEventListener("gw:character-toggle", onToggle);
      window.removeEventListener("resize", resize);
      resizeObserver?.disconnect();
      veil.remove();
      root.remove();
    },
  });
}
