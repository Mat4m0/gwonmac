/**
 * Owns the Core Command-R character palette, including focus and keyboard use.
 * It renders one bounded source and never reads game memory or native exports.
 */
import type {
  CharacterSummary,
  CompanionCharacterListState,
} from "./companion-character-list-snapshot.js";
import { professionPresentation } from "../shared/profession-assets.js";
import { travelDestination } from "../shared/travel-destinations.js";
import {
  EMPTY_CHARACTER_SWITCH_USAGE,
  type CharacterSwitchUsageDocument,
} from "../shared/character-switch-usage.js";

export type CharacterSwitchFailureCode =
  | "play-path-unproved"
  | "list-unavailable"
  | "current-target"
  | "busy"
  | "active-pvp"
  | "game-loading"
  | "character-select"
  | "state-unavailable"
  | "explorable-confirmation-required"
  | "focus-lost"
  | "stale-snapshot"
  | "target-missing"
  | "logout-refused"
  | "logout-invalid"
  | "logout-timeout"
  | "selector-timeout"
  | "selector-refused"
  | "selector-invalid"
  | "selector-frame-missing"
  | "selector-child-missing"
  | "selector-index-invalid"
  | "selector-context-invalid"
  | "selector-array-invalid"
  | "selector-target-missing"
  | "selector-parent-invalid"
  | "selection-not-confirmed"
  | "play-refused"
  | "play-invalid"
  | "play-frame-missing"
  | "play-parent-invalid"
  | "play-timeout"
  | "confirmation-timeout";

export type CharacterSwitchActionState = Readonly<{
  status: "idle" | "switching" | "failed" | "complete";
  stage?: "logout" | "selector" | "selection" | "play" | "confirmation";
  code?: CharacterSwitchFailureCode;
  retryable?: boolean;
}>;

export interface CharacterSwitchSource {
  readonly characters: CompanionCharacterListState;
  readonly action: CharacterSwitchActionState;
  readonly usage: CharacterSwitchUsageDocument;
  readonly context: CharacterSwitchContext;
  request(sequence: number, index: number, explorableConfirmed?: boolean): void;
  reset(): void;
  diagnostics(): Readonly<Record<string, unknown>>;
  subscribe(listener: () => void): () => void;
}

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
    case "explorable-confirmation-required": return "Confirm before leaving this explorable area.";
    case "focus-lost": return "Return focus to Guild Wars and try again.";
    case "stale-snapshot": return "The character list changed. Reopen the palette.";
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
  usage: CharacterSwitchUsageDocument = EMPTY_CHARACTER_SWITCH_USAGE,
): readonly Readonly<{ character: CharacterSummary; index: number }>[] {
  const byKey = new Map(usage.entries.map((entry) => [entry.characterKey, entry]));
  return Object.freeze(characters
    .map((character, index) => Object.freeze({ character, index }))
    .sort((left, right) => {
      const leftUsage = byKey.get(left.character.characterKey);
      const rightUsage = byKey.get(right.character.characterKey);
      return (rightUsage?.successfulSwitches ?? 0) - (leftUsage?.successfulSwitches ?? 0)
        || (rightUsage?.lastUsedSequence ?? 0) - (leftUsage?.lastUsedSequence ?? 0)
        || left.character.name.localeCompare(right.character.name);
    }));
}

export const CHARACTER_SEARCH_LIMIT = 40;

function normaliseCharacterQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function searchCharacters(
  rows: ReturnType<typeof orderCharacters>,
  query: string,
): ReturnType<typeof orderCharacters> {
  if (query.length > CHARACTER_SEARCH_LIMIT) return Object.freeze([]);
  const term = normaliseCharacterQuery(query);
  if (term === "") return rows;
  return Object.freeze(rows
    .flatMap((row) => {
      const name = row.character.name.toLocaleLowerCase();
      const score = name.startsWith(term) ? 0 : name.includes(term) ? 1 : null;
      return score === null ? [] : [{ row, score }];
    })
    .sort((left, right) => left.score - right.score)
    .map(({ row }) => row));
}

export function visibleCharacterRows(
  rows: ReturnType<typeof orderCharacters>,
  accountSize: number,
  query: string,
): ReturnType<typeof orderCharacters> {
  if (accountSize <= 10) return rows;
  return normaliseCharacterQuery(query) === "" ? Object.freeze(rows.slice(0, 10))
    : searchCharacters(rows, query);
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

export function createCharacterSwitchPalette(
  parent: HTMLElement,
  source: CharacterSwitchSource,
) {
  const document = parent.ownerDocument;
  const canvas = document.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("game canvas is missing");
  const style = document.createElement("style");
  style.textContent = `
    #character-switch-root{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;overflow:visible;background:transparent;color:var(--ui-text)}
    #character-switch-root::backdrop{background:var(--ui-overlay-fill)}
    .character-switch-panel{position:fixed;top:clamp(160px,23vh,280px);left:50%;width:min(430px,calc(100vw - 48px));max-height:min(620px,calc(77vh - 24px));display:flex;min-height:0;flex-direction:column;overflow:hidden;transform:translateX(-50%);color:var(--ui-text);background:var(--ui-panel-fill);box-shadow:var(--ui-shadow);font:var(--ui-font-size)/var(--ui-line-height) var(--ui-font);-webkit-font-smoothing:antialiased;animation:character-switch-enter calc(var(--ui-duration) * 1.5) var(--ui-ease-out)}
    .character-switch-panel,.character-switch-panel *{box-sizing:border-box}
    .character-switch-head{min-height:52px;display:flex;align-items:center;gap:var(--ui-space-2);padding:var(--ui-space-2) var(--ui-space-3);border-bottom:1px solid var(--ui-line)}.character-switch-head h2{margin:0;color:var(--ui-text-bright);font:inherit;font-size:var(--ui-font-size-lg);font-weight:var(--ui-font-weight-semibold)}.character-switch-count{margin-left:auto;color:var(--ui-text-faint);font-size:var(--ui-font-size-sm);font-variant-numeric:tabular-nums}.character-switch-head-action{width:34px;min-width:34px;min-height:34px;padding:0;border-color:transparent;background:transparent;box-shadow:none}.character-switch-head-action:hover:not(:disabled),.character-switch-head-action[aria-pressed=true]{background:var(--ui-hover)}.character-switch-head-action svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.75}
    .character-switch-search{position:relative;padding:var(--ui-space-2) var(--ui-space-3);border-bottom:1px solid var(--ui-line-soft)}.character-switch-search svg{position:absolute;left:calc(var(--ui-space-3) + 10px);top:50%;width:16px;height:16px;transform:translateY(-50%);fill:none;stroke:currentColor;stroke-width:1.5;color:var(--ui-text-faint);pointer-events:none}.character-switch-search .ui-input{width:100%;padding-left:34px}
    .character-switch-list{list-style:none;min-height:0;margin:0;padding:var(--ui-space-1);overflow:auto;overscroll-behavior:contain}.character-switch-row{width:100%;min-height:42px;display:flex;align-items:center;gap:var(--ui-space-2);padding:var(--ui-space-1) var(--ui-space-2);border:0;border-radius:var(--ui-radius-sm);background:transparent;color:inherit;text-align:left;font:inherit}.character-switch-row:hover:not(:disabled){background:var(--ui-hover)}.character-switch-row[data-selected=true]{background:var(--ui-selection-fill)}.character-switch-row:focus-visible{outline:2px solid var(--ui-focus);outline-offset:-2px;box-shadow:none}.character-switch-row:active:not(:disabled){transform:scale(.96)}.character-switch-row:disabled{cursor:default;opacity:.52}.character-switch-row img{width:28px;height:28px;flex:none;outline:1px solid oklch(1 0 0 / .1)}.character-switch-key{width:20px;flex:none;color:var(--ui-text-faint);font-size:var(--ui-font-size-sm);font-variant-numeric:tabular-nums;text-align:center}.character-switch-copyline{min-width:0;flex:1}.character-switch-primary,.character-switch-meta{display:flex;min-width:0;align-items:center;gap:var(--ui-space-2)}.character-switch-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.character-switch-current{font-size:var(--ui-font-size-sm);color:var(--ui-text-muted)}.character-switch-meta{min-width:0;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ui-text-faint);font-size:var(--ui-font-size-sm)}
    .character-switch-settings{display:grid;gap:var(--ui-space-2);padding:var(--ui-space-4)}.character-switch-setting{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--ui-space-3);padding:var(--ui-space-2);border-radius:var(--ui-radius-sm)}.character-switch-setting:hover{background:var(--ui-hover)}.character-switch-setting strong,.character-switch-setting small{display:block}.character-switch-setting strong{color:var(--ui-text-bright);font-weight:var(--ui-font-weight-semibold)}.character-switch-setting small{margin-top:2px;color:var(--ui-text-faint);font-size:var(--ui-font-size-sm)}
    .character-switch-confirm{display:grid;gap:var(--ui-space-2);padding:var(--ui-space-4)}.character-switch-confirm p{margin:0;color:var(--ui-text-muted)}.character-switch-confirm-actions{display:flex;justify-content:flex-end;gap:var(--ui-space-2);padding-top:var(--ui-space-2)}
    .character-switch-status{margin:0;padding:var(--ui-space-2) var(--ui-space-3);border-top:1px solid var(--ui-line-soft);color:var(--ui-text-muted);font-size:var(--ui-font-size-sm)}.character-switch-status[data-level=warning]{color:var(--ui-warning)}.character-switch-details{padding:0 var(--ui-space-3) var(--ui-space-2);color:var(--ui-text-muted);font-size:var(--ui-font-size-sm)}.character-switch-details summary{padding-block:var(--ui-space-2);cursor:pointer}.character-switch-details pre{max-height:130px;margin:0;overflow:auto;white-space:pre-wrap;font-size:11px}.character-switch-copy{margin-top:var(--ui-space-2)}
    .character-switch-footer{display:flex;align-items:center;justify-content:flex-end;gap:var(--ui-space-1);padding:var(--ui-space-2) var(--ui-space-3);border-top:1px solid var(--ui-line-soft);color:var(--ui-text-faint);font-size:var(--ui-font-size-sm)}.character-switch-details[hidden],.character-switch-status[hidden],.character-switch-list[hidden],.character-switch-search[hidden],.character-switch-settings[hidden],.character-switch-confirm[hidden],.character-switch-hints[hidden]{display:none}
    .character-switch-panel ::selection{background:var(--ui-accent-strong);color:var(--ui-text-bright)}
    @keyframes character-switch-enter{from{opacity:.72;transform:translateX(-50%) translateY(-5px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    @media(prefers-reduced-motion:reduce){.character-switch-panel{animation:none}}
    @media(max-height:560px){.character-switch-panel{top:clamp(96px,23vh,160px);max-height:calc(100vh - clamp(96px,23vh,160px) - 12px)}}
  `;
  const root = document.createElement("dialog");
  root.id = "character-switch-root";
  root.setAttribute("aria-labelledby", "character-switch-title");
  root.innerHTML = `<div class="ui-frame character-switch-panel"><header class="character-switch-head"><h2 id="character-switch-title">Switch Character</h2><span class="character-switch-count"></span><button class="ui-button character-switch-head-action character-switch-settings-toggle" type="button" aria-label="Character Switch settings" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg></button><button class="ui-button character-switch-head-action character-switch-close" type="button" aria-label="Close Switch Character"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button></header><ul id="character-switch-list" class="character-switch-list" aria-label="Characters"></ul><section class="character-switch-settings" aria-label="Character Switch settings" hidden><label class="character-switch-setting" for="character-switch-show-details"><span><strong>Show character details</strong><small>Profession, level, and known location</small></span><input id="character-switch-show-details" type="checkbox"></label></section><section class="character-switch-confirm" aria-describedby="character-switch-confirm-copy" hidden><p id="character-switch-confirm-copy">Switching characters will leave this explorable area. You may lose progress in this instance.</p><div class="character-switch-confirm-actions"><button type="button" class="ui-button character-switch-stay">Stay here</button><button type="button" class="ui-button character-switch-leave" data-variant="primary">Leave and switch</button></div></section><p class="character-switch-status" role="status" aria-live="polite"></p><details class="character-switch-details"><summary>Technical details</summary><pre></pre><button type="button" class="ui-button character-switch-copy">Copy diagnostics</button></details><footer class="character-switch-footer"><span class="character-switch-hints character-switch-list-hints"><kbd class="ui-kbd">tab</kbd> or <kbd class="ui-kbd">↑↓</kbd> choose <kbd class="ui-kbd">return</kbd> switch <kbd class="ui-kbd">esc</kbd> close</span><span class="character-switch-hints character-switch-settings-hints" hidden><kbd class="ui-kbd">esc</kbd> back</span><span class="character-switch-hints character-switch-confirm-hints" hidden><kbd class="ui-kbd">esc</kbd> back</span></footer></div>`;
  parent.append(style, root);
  const list = root.querySelector<HTMLUListElement>(".character-switch-list")!;
  list.classList.add("ui-scroll");
  list.setAttribute("role", "listbox");
  const search = document.createElement("label");
  search.className = "character-switch-search";
  search.htmlFor = "character-switch-query";
  search.hidden = true;
  search.innerHTML = `<span class="ui-sr-only">Search characters</span><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25"/><path d="m12.4 12.4 4.1 4.1"/></svg><input id="character-switch-query" class="ui-input" type="search" role="combobox" aria-controls="character-switch-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" maxlength="${CHARACTER_SEARCH_LIMIT}" placeholder="Search characters…">`;
  list.before(search);
  const queryInput = search.querySelector<HTMLInputElement>("#character-switch-query")!;
  const settingDescription = root.querySelector<HTMLElement>(".character-switch-setting small");
  if (settingDescription) settingDescription.textContent = "Professions, level, and known location";
  const status = root.querySelector<HTMLElement>(".character-switch-status")!;
  const title = root.querySelector<HTMLElement>("#character-switch-title")!;
  const count = root.querySelector<HTMLElement>(".character-switch-count")!;
  const settingsPanel = root.querySelector<HTMLElement>(".character-switch-settings")!;
  const confirmPanel = root.querySelector<HTMLElement>(".character-switch-confirm")!;
  const stayButton = root.querySelector<HTMLButtonElement>(".character-switch-stay")!;
  const leaveButton = root.querySelector<HTMLButtonElement>(".character-switch-leave")!;
  const settingsToggle = root.querySelector<HTMLButtonElement>(".character-switch-settings-toggle")!;
  const detailsCheckbox = root.querySelector<HTMLInputElement>("#character-switch-show-details")!;
  const listHints = root.querySelector<HTMLElement>(".character-switch-list-hints")!;
  const settingsHints = root.querySelector<HTMLElement>(".character-switch-settings-hints")!;
  const confirmHints = root.querySelector<HTMLElement>(".character-switch-confirm-hints")!;
  const details = root.querySelector<HTMLDetailsElement>(".character-switch-details")!;
  const diagnostic = root.querySelector<HTMLElement>("pre")!;
  type ViewState =
    | Readonly<{ kind: "closed" }>
    | Readonly<{ kind: "characters" }>
    | Readonly<{ kind: "settings" }>
    | Readonly<{
        kind: "confirming";
        sequence: number;
        index: number;
        characterKey: string;
      }>;
  let view: ViewState = Object.freeze({ kind: "closed" });
  let selected = 0;
  let query = "";
  let showDetails = true;
  let preferencePending = false;
  let preferenceFailure = false;
  let rows: ReturnType<typeof orderCharacters> = [];
  let allRows: ReturnType<typeof orderCharacters> = [];
  const busy = () => source.action.status === "switching";
  const surface = window.gwSurfaces.register({
    root,
    priority: 7,
    transient: true,
    dismiss: () => closePalette(true),
  });
  const updateRowSelection = () => {
    for (const button of list.querySelectorAll<HTMLButtonElement>("button[data-row]")) {
      button.dataset.selected = String(Number(button.dataset.row) === selected);
      button.setAttribute("aria-selected", String(Number(button.dataset.row) === selected));
    }
    const active = list.querySelector<HTMLButtonElement>(`button[data-row="${selected}"]`);
    if (active) queryInput.setAttribute("aria-activedescendant", active.id);
    else queryInput.removeAttribute("aria-activedescendant");
  };
  const focusSelected = () => {
    list.querySelector<HTMLButtonElement>(`button[data-row="${selected}"]`)?.focus({ preventScroll: true });
  };
  const render = () => {
    if (source.action.status === "switching" && root.open) {
      closePalette(false);
      return;
    }
    const state = source.characters;
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
      allRows = orderCharacters(state.characters, source.usage);
      const searching = state.characters.length > 10 && normaliseCharacterQuery(query) !== "";
      rows = visibleCharacterRows(allRows, state.characters.length, query);
      const preserved = selectedKey === undefined
        ? -1
        : rows.findIndex(({ character }) => character.characterKey === selectedKey);
      if (preserved >= 0) selected = preserved;
      selected = Math.min(selected, Math.max(0, rows.length - 1));
      const currentRow = rows.findIndex(({ index }) => index === state.selectedIndex);
      if (selected === currentRow) {
        selected = rows.findIndex(({ index }) => index !== state.selectedIndex);
        if (selected < 0) selected = 0;
      }
      rows.forEach(({ character, index }, rowIndex) => {
        const profession = professionPresentation(character.primaryProfession);
        const current = index === state.selectedIndex;
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.id = `character-switch-option-${index}`;
        button.className = "character-switch-row";
        button.setAttribute("role", "option");
        button.dataset.index = String(index);
        button.dataset.row = String(rowIndex);
        button.dataset.selected = String(rowIndex === selected);
        button.setAttribute("aria-selected", String(rowIndex === selected));
        button.disabled = current || busy();
        if (current) button.setAttribute("aria-current", "true");
        const shortcut = !searching && rowIndex < 9 ? rowIndex + 1
          : !searching && rowIndex === 9 ? 0 : null;
        const secondaryProfession = professionPresentation(character.secondaryProfession);
        const professionLabel = profession === null ? ""
          : `, ${profession.name}${secondaryProfession === null ? "" : ` and ${secondaryProfession.name}`}`;
        button.setAttribute("aria-label", current
          ? `${character.name}${professionLabel}, current character`
          : `Switch to ${character.name}${professionLabel}${shortcut === null ? "" : `, shortcut ${shortcut}`}`);
        if (current) button.title = "Already active";
        const key = document.createElement("span");
        key.className = "character-switch-key";
        key.textContent = shortcut === null ? "" : String(shortcut);
        button.append(key);
        if (profession) {
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
        const destination = travelDestination(character.mapId);
        if (showDetails && profession !== null) {
          const meta = document.createElement("span");
          meta.className = "character-switch-meta";
          meta.textContent = [
            secondaryProfession === null
              ? profession.name
              : `${profession.name} / ${secondaryProfession.name}`,
            `Level ${character.level}`,
            destination?.name,
          ].filter((value): value is string => value !== undefined).join(" · ");
          meta.title = meta.textContent;
          copy.append(meta);
        }
        button.append(copy);
        item.append(button);
        list.append(item);
      });
    }
    const largeAccount = state.status === "ready" && state.characters.length > 10;
    const hasQuery = largeAccount && normaliseCharacterQuery(query) !== "";
    count.textContent = state.status === "ready"
      ? hasQuery ? `${rows.length} of ${state.characters.length}` : `${state.characters.length} characters`
      : "";
    const settingsMode = view.kind === "settings";
    const confirming = view.kind === "confirming";
    title.textContent = confirming ? "Leave this area?" : "Switch Character";
    list.hidden = settingsMode || confirming;
    search.hidden = settingsMode || confirming || !largeAccount || busy();
    settingsPanel.hidden = !settingsMode;
    confirmPanel.hidden = !confirming;
    count.hidden = confirming;
    settingsToggle.hidden = confirming;
    listHints.hidden = settingsMode || confirming;
    settingsHints.hidden = !settingsMode;
    confirmHints.hidden = !confirming;
    settingsToggle.setAttribute("aria-pressed", String(settingsMode));
    settingsToggle.disabled = busy();
    detailsCheckbox.checked = showDetails;
    detailsCheckbox.disabled = preferencePending;
    queryInput.setAttribute("aria-expanded", String(rows.length > 0));
    updateRowSelection();
    status.hidden = false;
    delete status.dataset.level;
    if (confirming) status.hidden = true;
    else if (settingsMode && preferenceFailure) {
      status.dataset.level = "warning";
      status.textContent = "The display preference could not be saved. Try again.";
    } else if (settingsMode) status.hidden = true;
    else if (source.action.status === "failed" && source.action.code) {
      status.dataset.level = "warning";
      status.textContent = `${failureMessage(source.action.code)} (${source.action.code})`;
    } else if (state.status !== "ready") status.textContent = "Waiting for the account character list…";
    else if (hasQuery && rows.length === 0) status.textContent = "No characters match that search.";
    else status.hidden = true;
  };
  const focusCharacters = () => {
    if (source.characters.status === "ready" && source.characters.characters.length > 10) {
      queryInput.focus({ preventScroll: true });
    } else focusSelected();
  };
  const closePalette = (resetFailure: boolean) => {
    if (view.kind === "closed") return;
    view = Object.freeze({ kind: "closed" });
    surface.setOpen(false);
    if (root.open) root.close();
    if (resetFailure && source.action.status === "failed") source.reset();
    canvas.focus({ preventScroll: true });
  };
  const openPalette = () => {
    if (source.action.status === "switching") return;
    if (source.action.status === "complete") source.reset();
    if (source.context === "character-select" && source.action.status !== "failed") return;
    if (document.pointerLockElement !== null) void document.exitPointerLock();
    selected = 0;
    query = "";
    queryInput.value = "";
    preferenceFailure = false;
    view = Object.freeze({ kind: "characters" });
    surface.setOpen(true);
    if (!root.open) root.showModal();
    render();
    focusCharacters();
  };
  const beginRequest = (sequence: number, index: number, explorableConfirmed = false) => {
    if (source.action.status === "failed") source.reset();
    source.request(sequence, index, explorableConfirmed);
    if (source.action.status === "switching") closePalette(false);
    else render();
  };
  const requestSelected = () => {
    const state = source.characters;
    const row = rows[selected];
    if (state.status !== "ready" || !row || row.index === state.selectedIndex) return;
    if (source.action.status === "failed") source.reset();
    if (source.context === "pve-explorable") {
      view = Object.freeze({
        kind: "confirming",
        sequence: state.sequence,
        index: row.index,
        characterKey: row.character.characterKey,
      });
      render();
      stayButton.focus({ preventScroll: true });
      return;
    }
    beginRequest(state.sequence, row.index);
  };
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (view.kind === "confirming" || view.kind === "settings") {
        view = Object.freeze({ kind: "characters" });
        render();
        focusCharacters();
      } else if (query !== "") {
        query = "";
        queryInput.value = "";
        selected = 0;
        render();
        queryInput.focus({ preventScroll: true });
      } else closePalette(true);
    }
    else if (view.kind !== "characters") return;
    else if ((event.key === "ArrowDown" || event.key === "ArrowUp")
      && (event.target === queryInput
        || (event.target instanceof Node && list.contains(event.target)))) {
      event.preventDefault();
      if (event.target instanceof HTMLButtonElement && event.target.dataset.row !== undefined) {
        selected = Number(event.target.dataset.row);
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const characterState = source.characters;
      const currentRow = characterState.status === "ready"
        ? rows.findIndex(({ index }) => index === characterState.selectedIndex)
        : -1;
      selected = moveCharacterSelection(selected, rows.length, delta, currentRow);
      render();
      if (event.target !== queryInput) focusSelected();
    }
    else {
      if (query !== "") return;
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
  });
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && query !== "") {
      event.preventDefault();
      event.stopPropagation();
      query = "";
      queryInput.value = "";
      selected = 0;
      render();
      queryInput.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Enter" || busy()) return;
    event.preventDefault();
    requestSelected();
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
  root.querySelector(".character-switch-close")!.addEventListener("click", () => closePalette(true));
  settingsToggle.addEventListener("click", () => {
    if (busy()) return;
    view = Object.freeze({ kind: view.kind === "settings" ? "characters" : "settings" });
    preferenceFailure = false;
    render();
    if (view.kind === "settings") detailsCheckbox.focus({ preventScroll: true });
    else focusCharacters();
  });
  detailsCheckbox.addEventListener("change", () => {
    const next = detailsCheckbox.checked;
    const previous = showDetails;
    showDetails = next;
    preferencePending = true;
    preferenceFailure = false;
    render();
    void window.gwNative.settings.set({ characterSwitchDetails: next }).then((settings) => {
      showDetails = settings.characterSwitchDetails;
    }).catch(() => {
      showDetails = previous;
      preferenceFailure = true;
    }).finally(() => {
      preferencePending = false;
      render();
      if (view.kind === "settings") detailsCheckbox.focus({ preventScroll: true });
    });
  });
  stayButton.addEventListener("click", () => {
    if (view.kind !== "confirming") return;
    view = Object.freeze({ kind: "characters" });
    render();
    focusCharacters();
  });
  leaveButton.addEventListener("click", () => {
    if (view.kind !== "confirming") return;
    const confirmation = view;
    const state = source.characters;
    const target = state.status === "ready" ? state.characters[confirmation.index] : undefined;
    if (state.status !== "ready"
      || state.sequence !== confirmation.sequence
      || target?.characterKey !== confirmation.characterKey) {
      beginRequest(confirmation.sequence, confirmation.index, true);
      return;
    }
    beginRequest(state.sequence, confirmation.index, true);
  });
  root.querySelector(".character-switch-copy")!.addEventListener("click", () => {
    void navigator.clipboard.writeText(JSON.stringify(source.diagnostics()));
  });
  details.addEventListener("toggle", () => {
    if (details.open) diagnostic.textContent = JSON.stringify(source.diagnostics(), null, 2);
  });
  root.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePalette(true);
  });
  root.addEventListener("click", (event) => {
    if (event.target !== root) return;
    event.preventDefault();
    event.stopPropagation();
    closePalette(true);
  });
  const stop = (event: Event) => event.stopPropagation();
  for (const name of [
    "keydown", "keyup", "pointerdown", "pointerup", "pointermove",
    "mousedown", "mouseup", "mousemove", "click", "wheel", "contextmenu",
  ]) root.addEventListener(name, stop);
  const onToggle = (event: Event) => {
    event.preventDefault();
    if (source.action.status === "switching") return;
    if (root.open) closePalette(true);
    else openPalette();
  };
  window.addEventListener("gw:character-toggle", onToggle);
  const unsubscribeSettings = window.gwNative.settings.onChange((settings) => {
    showDetails = settings.characterSwitchDetails;
    render();
  });
  void window.gwNative.settings.get().then((settings) => {
    showDetails = settings.characterSwitchDetails;
    render();
  }).catch(() => { /* The default remains usable; saving reports its own failure. */ });
  const unsubscribe = source.subscribe(render);
  return Object.freeze({ dispose() {
    unsubscribe();
    unsubscribeSettings();
    surface.dispose();
    window.removeEventListener("gw:character-toggle", onToggle);
    root.remove();
    style.remove();
  } });
}
