/**
 * Owns the Core command palette, its search focus and transient modal lifetime.
 * Optional Tools contributes local results and views without entering Core's imports.
 */
import { resumeSearchInput } from './search-input.js';
import { installHubWindow } from './hub-window.js';
import { attachClassicFrame } from '../shared/ui/frame.js';
import { isHubBackKey, resolveShortcuts, shortcutKeycaps, type ShortcutAction } from '../shared/keyboard-shortcuts.js';
import { FINDABLE_SETTINGS, focusHubSetting, openHubSettings, type HubSettingsFocus } from "./hub-settings.js";
import { createHubAccounts } from './hub-accounts.js';
import { hubIcon } from "./hub-icons.js";
import { openHubMaps } from './hub-maps.js';
import { editHubShortcut, hubPhraseReserved, manageHubShortcuts } from './hub-preferences.js';
import { isHubShortcuts, type HubShortcut } from '../shared/hub-preferences.js';
import { createHubCalculator } from './hub-calculator.js';
import { armConfirmation, closeDisclosure, focusable, focusableElements } from './surface-controller.js';
import { listIndexAfter, listKeyStep } from '../shared/ui/list-keys.js';
import { createHoverSelection } from '../shared/ui/hover-selection.js';
import { matchHubRows, parseHubQuery, normaliseHubQuery, type HubDestination, type HubRow, type HubSource, type HubSummary, type HubTask, type HubViewAction, type HubViewFooter, type HubViewMount } from '../shared/hub.js';
export function createHub(parent: HTMLElement) {
  const document = parent.ownerDocument;
  const root = document.createElement('dialog');
  root.id = 'hub';
  root.className = 'ui-modal ui-modal-layer';
  root.dataset.page = "home";
  root.setAttribute('aria-label', 'Hub');
  root.innerHTML = `<section class="hub-panel ui-frame">
    <header class="hub-heading ui-window-head"><button class="ui-button hub-back" data-variant="quiet" aria-label="Back" hidden>← Back</button><span class="hub-name">Hub</span><nav class="hub-breadcrumbs" aria-label="Hub breadcrumb"><span class="hub-caption">Home</span></nav><span class="hub-context"></span><button class="ui-window-lock hub-lock" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="5" y="11" width="14" height="10" rx="2"/></svg></button><button class="ui-window-close hub-close" aria-label="Close Hub" title="Close Hub">×</button></header>
    <section class="hub-summary" aria-label="Build to apply" hidden></section>
    <div class="hub-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 8 10-8 10L4 12 12 2Zm0 5v10M8 12h8"/></svg><span class="hub-scope" hidden></span><input type="text" role="combobox" aria-label="Search people, places, builds" aria-autocomplete="list" aria-controls="hub-results" aria-expanded="true" placeholder="Search people, places, builds…" autocomplete="off" spellcheck="false" maxlength="120"><span class="hub-progress" aria-hidden="true"></span></div>
    <p class="hub-hint" id="hub-hint" hidden></p><div class="hub-rate-controls" hidden></div><div class="hub-results ui-scroll" id="hub-results" role="listbox" aria-label="Results" tabindex="-1"></div>
    <pre class="hub-preview ui-scroll" hidden></pre><div class="hub-view" hidden></div><p class="hub-status" role="status" hidden></p><p class="hub-lifecycle" hidden></p><p class="hub-announce ui-sr-only" aria-live="polite" aria-atomic="true"></p>
    <footer class="hub-footer"><span class="hub-legend"></span><span class="hub-count"></span><button class="hub-primary ui-button" data-variant="primary"></button><button class="hub-actions ui-button" data-variant="quiet" aria-haspopup="menu" aria-expanded="false">Actions</button></footer>
    <div class="hub-menu" role="menu" aria-label="Actions" hidden></div>
    <button class="ui-window-resize hub-resize" aria-label="Resize Hub" title="Drag to resize, or use arrow keys" hidden></button>
  </section>`;
  parent.append(root);
  const receipt = document.createElement('output'); receipt.className = 'hub-receipt ui-well'; receipt.setAttribute('role', 'status'); receipt.hidden = true; parent.append(receipt);
  let receiptTimer: ReturnType<typeof setTimeout> | undefined;
  // Where the Hub frame last stood: a receipt after closing appears in its footprint, not as a window toast.
  let frame: DOMRect | null = null;
  const required = <T extends Element>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Hub control missing: ${selector}`);
    return element;
  };
  const disposeFrame = attachClassicFrame(required<HTMLElement>('.hub-panel'));
  const hubWindow = installHubWindow(required<HTMLElement>('.hub-panel'), required<HTMLElement>('.hub-heading'), required<HTMLButtonElement>('.hub-lock'), required<HTMLElement>('.hub-resize'));
  const input = required<HTMLInputElement>('input');
  const search = required<HTMLElement>('.hub-search');
  const list = required<HTMLElement>('.hub-results');
  const content = required<HTMLElement>('.hub-view');
  const backButton = required<HTMLButtonElement>('[aria-label="Back"]');
  const caption = required<HTMLElement>('.hub-caption');
  const breadcrumbs = required<HTMLElement>('.hub-breadcrumbs');
  const status = required<HTMLElement>('.hub-status');
  const footer = required<HTMLElement>('footer');
  const primary = required<HTMLButtonElement>('.hub-primary');
  const actionsButton = required<HTMLButtonElement>('.hub-actions');
  const menu = required<HTMLElement>('.hub-menu');
  /** The row whose Actions menu is open. */
  let menuRow: string | null = null;
  const count = required<HTMLElement>('.hub-count');
  const legend = required<HTMLElement>('.hub-legend');
  const lifecycle = required<HTMLElement>('.hub-lifecycle');
  const announcer = required<HTMLElement>('.hub-announce');
  let rows: readonly HubRow[] = [];
  let shortcutRevision = '';
  let navigationRevision = '';
  let selected: string | null = null;
  /** The query found no results yet; results that arrive for it later, e.g. from a loading source, get its initial selection. */
  let awaitingResults = false;
  const sources = new Map<HubSource, () => void>();
  const sourceEnabled = (source: HubSource) => !source.feature || ((source.feature === 'characterSwitchEnabled' || !!window.gwToolsSettings?.().gwonmacTools) && !!window.gwToolsSettings?.()[source.feature]);
  type RowScope = Readonly<{ title: string; rows: () => readonly HubRow[]; summary?: HubSummary; destination?: HubDestination }>;
  let scope: RowScope | null = null;
  type MountedView = { title: string; mount: HubViewMount<HTMLElement>; available?: () => boolean; destination?: HubDestination };
  let activeView: MountedView | null = null;
  /** The mounted view's footer: its named primary and secondary, or its own footer (Travel, Characters). */
  type ViewFooter = { primary: HubViewAction | null; secondary: HubViewAction | null; own: boolean };
  let viewFooter: ViewFooter | null = null;
  let viewRunning = false;
  let viewArming: { label: string; arming: ReturnType<typeof armConfirmation> } | null = null;
  let disposeView: (() => void) | null = null;
  let viewAvailable: (() => boolean) | null = null;
  let restoreQuery = '';
  type FocusPlace = { selector: string; range?: readonly [number, number] };
  type Page = { scope: RowScope | null; query: string; selected: string | null; scroll: number; view: MountedView | null; focus: FocusPlace };
  const history: Page[] = [];
  let suspended: Page | null = null;
  /**
   * A suspended page resumes for this long (D-11): a quick trip to another window or a popout
   * returns to it with the query selected; later, the Hub starts fresh at Home.
   */
  const RESUME_MS = 90_000;
  let suspendedAt = 0;
  let restoringFocus: MutationObserver | null = null;
  const focusPlace = (): FocusPlace => {
    const active = document.activeElement;
    let selector = '.hub-search input';
    if (active instanceof HTMLElement && root.contains(active) && active !== input) {
      for (const attribute of ['id', 'data-character-key', 'data-section', 'aria-label']) {
        const value = active.getAttribute(attribute);
        if (value) { selector = `[${attribute}="${CSS.escape(value)}"]`; break; }
      }
      if (active === primary) selector = '.hub-primary';
      if (active === required('.hub-actions')) selector = '.hub-actions';
    }
    return { selector, ...(active instanceof HTMLInputElement && active.selectionStart !== null
      ? { range: [active.selectionStart, active.selectionEnd ?? active.selectionStart] as const } : {}) };
  };
  // List stages keep DOM focus in search; the selection moves by aria-activedescendant (D-2).
  const focusResult = () => input.focus({ preventScroll: true });
  /** Where typing goes: the Hub search on list stages, else a list view's own search (Travel, Characters). */
  const searchField = () => !search.hidden ? input
    : [...content.querySelectorAll<HTMLInputElement>('input[type=search],input[role=combobox]')].find(field => field.getClientRects().length > 0 && !field.disabled) ?? null;
  /** A view's first usable control, else Back, so focus never falls to <body> (a disabled button refuses it). */
  const firstControl = () => focusableElements(content)[0] ?? backButton;
  function restoreFocus(place: FocusPlace) {
    restoringFocus?.disconnect();
    const attempt = () => {
      const control = root.querySelector<HTMLElement>(place.selector);
      if (!control || !focusable(control)) return false;
      control.focus({ preventScroll: true });
      if (place.range && control instanceof HTMLInputElement && control.selectionStart !== null) control.setSelectionRange(...place.range);
      restoringFocus?.disconnect(); restoringFocus = null;
      return true;
    };
    if (!attempt()) {
      if (!content.hidden) firstControl().focus();
      else focusResult();
      restoringFocus = new MutationObserver(attempt);
      restoringFocus.observe(content, { childList: true, subtree: true });
    }
  }
  /** Where the keyboard was when the running view action started: a page it opens returns there (HUB-019). */
  let actionFocus: FocusPlace | null = null;
  const capture = (): Page => ({ scope, query: input.value, selected, scroll: list.scrollTop, view: activeView, focus: actionFocus ?? focusPlace() });
  const pageTitle = (page: Pick<Page, 'scope' | 'view'>) => page.view?.title ?? page.scope?.title ?? 'Home';
  /**
   * Form drafts last the session, keyed by page path and field name: leaving a form keeps what
   * was typed and returning restores it, unless the stored value the field started from changed.
   */
  const drafts = new Map<string, { initial: string; value: string }>();
  const draftInitials = new Map<string, string>();
  let draftPage: string | null = null;
  const draftFields = () => [...content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'form input:not([type]), form input[type=text], form input[type=search], form textarea, form select')]
    .flatMap(field => { const name = field.getAttribute('aria-label') || field.name || field.id; return name ? [[`${draftPage} › ${name}`, field] as const] : []; });
  function restoreDrafts(path: string) {
    draftPage = path; draftInitials.clear();
    for (const [key, field] of draftFields()) {
      draftInitials.set(key, field.value);
      const draft = drafts.get(key);
      if (draft && draft.initial !== field.value) drafts.delete(key);
      else if (draft) { field.value = draft.value; field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }
    }
  }
  function keepDrafts() {
    if (draftPage === null) return;
    for (const [key, field] of draftFields()) {
      const initial = draftInitials.get(key) ?? field.value;
      if (field.value === initial) drafts.delete(key); else drafts.set(key, { initial, value: field.value });
    }
    draftPage = null;
  }
  function remember() { history.push(capture()); }
  function restorePage(page: Page) {
    resetView(); scope = page.scope;
    if (page.view) {
      if (page.view.available && !page.view.available()) { restoreParent(); return; }
      mountView(page.view);
    } else {
      input.value = page.query; caption.textContent = scope?.title ?? 'Home'; root.dataset.page = scope ? 'section' : 'home';
      input.placeholder = scope ? 'Search actions…' : 'Search people, places, builds…'; report(''); refresh(true);
      select(rows.some(row => row.id === page.selected) ? page.selected : null); list.scrollTop = page.scroll;
      if (page.selected && selected === null) report('The previous selection is no longer available. Choose a result.');
    }
    restoreFocus(page.focus);
  }
  /**
   * Esc's step out of a page and a view's own way out ("Done", Travel or Characters leaving):
   * the parent page, or a close where there is none. A page opened directly by its shortcut
   * has no artificial Home step for Esc.
   */
  function restoreParent() {
    const parent = history.pop();
    if (!parent) { close(); return; }
    restorePage(parent);
  }
  let previousFocus: HTMLElement | null = null;
  /**
   * The page session a running action belongs to (HUB-004). Typing, any page change, closing and
   * suspending end it, so a late completion reports instead of closing or navigating a newer page.
   */
  let session = 0;
  const endSession = () => { session++; };
  /** The session a blur suspended; only that suspension, not a later page, belongs to its task. */
  let suspendedSession = -1;
  /** The row action running on this page; the footer and status name it until it ends (HUB-083). */
  let running: { session: number; label: string; again: string } | null = null;
  const busy = () => running !== null && running.session === session;
  /** A failure reported while the Hub was closed waits in the status line of the next opening. */
  let carriedFailure = '';
  /** A late task's receipt outlives the typing that ended its session; any other report replaces it. */
  let receiptInStatus = false;
  /**
   * The latest progress of a running action, on its page or left behind by Back, typing or a
   * close (KEY-19). The status line falls back to it, busy, whenever it has nothing newer to say.
   */
  let progress: { owner: object; message: string } | null = null;
  let progressInStatus = false;
  function report(message: string, receipt = false) {
    const text = message || progress?.message || '';
    status.textContent = text; status.hidden = !text;
    receiptInStatus = receipt && !!message; progressInStatus = !message && !!text;
    status.setAttribute('aria-busy', String(progressInStatus)); paintBusy();
  }
  const dispatch = (name: string, detail?: unknown) => {
    if (window.dispatchEvent(new CustomEvent(name, { cancelable: true, detail }))) {
      throw new Error('Unavailable in the current game state.');
    }
  };
  const commands = (): HubRow[] => {
    const settings = window.gwToolsSettings?.();
    const tool = (id: string, title: string, detail: string, keywords: string, enabled: boolean | undefined, event: string): HubRow[] => enabled ? [{
      id, title, keywords, detail, group: 'Tools', action: id === 'storage' ? 'Open Xunlai Storage' : `Open ${title}`,
      run: () => { if (id === 'storage') { close(); window.dispatchEvent(new CustomEvent(event, { cancelable: true })); } else dispatch(event, 'show'); },
    }] : [];
    return [
      ...tool('travel', 'Travel', 'Outposts, favourites and recent places', 'outpost destination teleport tp', settings?.gwonmacTools && settings.travelPalette, 'gw:travel-toggle'),
      ...tool('builds', 'Build Library', 'Saved builds and teams', 'teams templates skills', settings?.gwonmacTools && settings.buildLibrary, 'gw:tools-toggle').map(row => ({ ...row, unavailable: 'Build Library is loading.' })),
      ...tool('trade', 'Trade Chat', 'Find offers and contact sellers', 'kamadan prices trading market', settings?.gwonmacTools && settings.tradeChat, 'gw:trade-toggle'),
      ...tool('whispers', 'Whispers', 'Conversations, friends and drafts', 'friends people message chat', settings?.gwonmacTools && settings.whispersEnabled, 'gw:whispers-toggle'),
      ...(settings?.characterSwitchEnabled ? [{ id: 'character', title: 'Switch Character', detail: 'Choose another character', keywords: 'relog profession', group: 'Tools', action: 'Choose character', navigate: () => dispatch('gw:character-toggle'), run: () => dispatch('gw:character-toggle') }] : []),
      ...tool('storage', 'Open Xunlai Storage', 'Open your storage chest', 'chest bank', settings?.gwonmacTools && settings.xunlaiStorage, 'gw:storage-open'),
      ...(settings?.gwonmacTools && settings.cartographyEnabled ? [{ id: 'maps', title: 'Maps', detail: 'Exploration grid, walkable terrain and compass ranges', keywords: 'grid terrain compass opacity', group: 'Tools', action: 'Adjust maps', run: () => openHubMaps(presenter) }] : []),
      { id: 'hub-preferences', title: 'Hub preferences', detail: 'Pins and exact search phrases', keywords: 'aliases vocabulary', group: 'Commands', action: 'Adjust Hub', run: () => manageHubShortcuts(presenter, shortcuts, lookup, saveShortcuts, hubWindow.reset) },
      { id: 'settings', title: 'Settings', detail: 'Game, appearance, tools, shortcuts and maps', keywords: 'preferences graphics appearance hotkeys', group: 'Commands', action: 'Open Settings', run: () => openSettings() },
      { id: 'launcher', title: 'Show Launcher', detail: 'Accounts, updates and game files', keywords: 'launcher administration', group: 'Commands', action: 'Show Launcher', run: async () => { await window.gwNative.app.showLauncher(); close(); } },
      { id: 'commands', title: 'Commands', detail: 'Examples you can edit and run', keywords: 'help guide examples', group: 'Commands', action: 'Browse examples', run: () => presenter.showRows('Commands', commandExamples) },
      { id: 'help', title: 'Project website', detail: 'Documentation and latest changes', keywords: 'help documentation', group: 'Commands', action: 'Open website', run: async () => { await window.gwNative.app.openExternal('github'); close(); } },
      ...(!input.value.trim() ? [] : [
        // Call Target stays on its own shortcut: it acts only while the game has focus (HUB-133).
        // Quit or Reload opens the account's confirmation sheet, never a direct quit (HUB-001).
        // The sheet waits for the press that asked for it, so its repeat or trailing click never answers it.
        { id: 'reload', title: 'Quit or Reload Game…', detail: 'Opens confirmation for this account', keywords: 'restart reconnect', group: 'Commands', action: 'Review options', run: async () => { close(); await window.gwSurfaces.afterPress(); await window.gwNative.app.showQuitOrReload(); } },
        ...(settings?.gwonmacTools && settings.resignEnabled ? [{ id: 'resign', title: 'Resign…', detail: 'Opens the existing confirmation', group: 'Commands', action: 'Review resign', run: () => { dispatch('gw:resign-show'); close(); } }] : []),
        // Settings are found by their own words and open with their control focused (HUB-063).
        // They follow the commands, so a command's own word keeps its row first.
        ...(normaliseHubQuery(input.value).length < 3 ? [] : FINDABLE_SETTINGS).filter(setting => !setting.shown || (settings && setting.shown(settings))).map(setting => ({ id: `setting:${setting.label}`, title: setting.label, detail: `Settings › ${setting.section}`, keywords: `setting ${setting.keywords ?? ''}`, group: 'Settings', action: 'Open setting', run: () => openSettings({ section: setting.section, control: setting.label }) })),
      ]),
    ];
  };
  const shortcuts = () => [...(window.gwToolsSettings?.().hubShortcuts ?? []), ...[...sources.keys()].filter(sourceEnabled).flatMap(source => source.shortcuts?.get() ?? [])];
  const lookup = (id: string): HubRow | undefined => [...sources.keys()].filter(sourceEnabled).map(source => source.lookup?.(id)).find(Boolean)
    ?? commands().find(row => row.id === id);
  async function saveShortcuts(value: readonly HubShortcut[]) {
    if (!isHubShortcuts(value)) throw new Error('Invalid Hub shortcuts');
    const privateEntries = value.filter(entry => /^(build|team):/u.test(entry.id));
    const owner = [...sources.keys()].find(source => sourceEnabled(source) && source.shortcuts);
    if (owner?.shortcuts && JSON.stringify(privateEntries) !== JSON.stringify(owner.shortcuts.get())) await owner.shortcuts.save(privateEntries);
    else if (privateEntries.length && !owner) throw new Error('Build Library is unavailable.');
    const globalEntries = value.filter(entry => !/^(build|team):/u.test(entry.id));
    if (JSON.stringify(globalEntries) !== JSON.stringify(window.gwToolsSettings?.().hubShortcuts ?? [])) await window.gwNative.settings.set({ hubShortcuts: globalEntries });
    refresh();
  }
  function commandExamples(): HubRow[] {
    const enabled = new Set(commands().map(row => row.id));
    const examples = [ ['trade', 'trade arms', 'Find offers or a seller'], ['travel', 'travel kamadan', 'Find an outpost'], ['character', 'char Toefte', 'Find a character by name'], ['builds', 'build monk', 'Browse saved Monk builds'], ['builds', 'team gom afk', 'Find your saved team'], ['whispers', 'whisper Romi', 'Choose a person; write before sending'], ['whispers', 'invite Romi', 'Invite a person to your party from an outpost'], ['', '1p in g', 'Convert platinum to gold'], ['trade', '10e in p', 'Estimate ecto value'], ['', 'titles', 'Plan title points'], ['', 'acc second', 'Choose how to open a saved account'], ['builds', 'build folder:Monk monk', 'Monk builds in a folder and its descendants'], ['builds', 'build folder:"Team Builds/Farming" monk', 'Quotes keep spaces; paths match consecutive folder names'], ['builds', 'build folder:/Monk/ mesmer', 'Leading slash starts at Skills; trailing slash matches the complete folder name'], ['builds', 'build Mo/Me', 'Exact profession pair; use folder:Mo/Me to search that folder instead'], ['builds', 'build folder:/', 'Templates saved directly in the Skills root'] ];
    return examples.filter(([tool]) => !tool || enabled.has(tool)).map(([, query, detail], index) => ({ id: `example:${index}`, title: query!, detail: detail!, group: 'Commands', action: 'Edit example', searchQuery: query!, run() {} }));
  }
  /** Settings, optionally at one section with one control focused (search, the memory warning). */
  function openSettings(focus?: HubSettingsFocus) {
    direct('settings', () => openHubSettings(presenter, focus));
    // A Settings page that was already open, suspended or lower in the path shows the target too.
    if (focus) focusHubSetting(focus);
  }
  function select(id: string | null, scroll = false) {
    selected = id;
    for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      row.setAttribute('aria-selected', String(row.dataset.id === id));
      if (row.dataset.id === id) {
        input.setAttribute('aria-activedescendant', row.id);
        if (scroll) row.scrollIntoView({ block: 'nearest' });
      }
    }
    const row = rows.find(row => row.id === id);
    const rates = required<HTMLElement>('.hub-rate-controls'); rates.hidden = !row?.quoteBasis || !!disposeView;
    // A card that vanished under a focused Price basis hands the keyboard back to search (HUB-223).
    if (rates.hidden && rates.contains(document.activeElement)) focusResult();
    if (row?.quoteBasis) {
      const basis = row.quoteBasis;
      let picker = rates.querySelector('select');
      if (!picker) { const label = document.createElement('label'); label.textContent = 'Quote basis'; picker = document.createElement('select'); picker.className = 'ui-select'; picker.setAttribute('aria-label', 'Price basis'); label.append(picker); rates.replaceChildren(label); }
      const choices = JSON.stringify(basis.options);
      if (picker.dataset.choices !== choices) { picker.replaceChildren(); for (const choice of basis.options) { const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; picker.append(option); } picker.dataset.choices = choices; }
      picker.value = basis.value;
      picker.onchange = () => basis.choose(picker.value);
      let details = rates.querySelector('button');
      if (!details) { details = document.createElement('button'); details.className = 'ui-button'; details.textContent = 'Details'; rates.append(details); }
      details.onclick = () => rows.find(item => item.id === selected)?.actions?.();
    }

    if (!row) input.removeAttribute('aria-activedescendant');
    const preview = required<HTMLElement>('.hub-preview');
    preview.textContent = row?.preview ?? ''; preview.hidden = !row?.preview || !!disposeView;
    // A row action that opened a view ends here: the view names the footer now.
    if (viewFooter) { paintViewFooter(); return; }
    // A running action keeps the footer: it names what runs, disabled, until it ends (HUB-083).
    const working = busy() ? running : null;
    primaryText(working ? working.label : row ? row.action : 'Select a result');
    if (row && !working) { const key = document.createElement('kbd'); key.textContent = '↵'; primary.append(key); }
    disableSlot(primary, !row || !!row.unavailable || !!working);
    primary.dataset.variant = row?.destructive ? 'danger' : 'primary';
    // Footer slots never hide, so nothing slides under a resting pointer; they disable instead.
    // Actions opens only where it lists more than the primary (HUB-043).
    slotLabel(actionsButton, 'Actions', ['⌘', 'J']);
    disableSlot(actionsButton, !row || !!working || menuEntries(row).length < 2);
    if (!menu.hidden && menuRow !== row?.id) closeMenu(false);
    paintLegend(row);
    paintBusy();
  }
  /** The primary names its action on one line; a long name ends in … and shows whole on hover (HUB-238). */
  function primaryText(label: string) {
    const text = document.createElement('span'); text.className = 'hub-primary-label'; text.textContent = label;
    primary.replaceChildren(text); primary.title = label;
  }
  /** A footer slot's text and, when it has one, its keys; the name stays the text, the keys are its shortcut. */
  function slotLabel(button: HTMLButtonElement, text: string, keys: readonly string[] = []) {
    button.replaceChildren(document.createTextNode(text));
    for (const cap of keys) { const key = document.createElement('kbd'); key.textContent = cap; key.setAttribute('aria-hidden', 'true'); button.append(key); }
    if (keys.length) button.setAttribute('aria-keyshortcuts', 'Meta+J'); else button.removeAttribute('aria-keyshortcuts');
  }
  /** A footer slot disables instead of hiding; under the focus it hands focus to search or the view, never to <body>. */
  function disableSlot(button: HTMLButtonElement, disabled: boolean) {
    const focused = document.activeElement === button;
    button.disabled = disabled;
    if (disabled && focused) (search.hidden ? firstControl() : input).focus({ preventScroll: true });
  }
  /** `aria-busy` and the thin bar under the search while this page's action runs or the status line shows progress. */
  function paintBusy() {
    const working = busy() || (viewRunning && !!viewFooter) || progressInStatus;
    list.setAttribute('aria-busy', String(busy())); content.setAttribute('aria-busy', String(viewRunning && !!viewFooter));
    required<HTMLElement>('.hub-panel').dataset.busy = String(working);
  }
  /** The footer's key legend names only keys that act here and now. */
  function paintLegend(row: HubRow | undefined) {
    const keys: [string[], string][] = [];
    if (!viewFooter && rows.length > 1 && !busy()) keys.push([['↑', '↓'], 'Select']);
    if (!viewFooter && row?.navigate) keys.push([['→'], 'Open']);
    keys.push([['Esc'], !viewFooter && input.value ? 'Clear' : history.length ? 'Back' : 'Close']);
    if (!atHome()) keys.push([['⌘', '⌫'], 'Back']);
    const next = JSON.stringify(keys);
    if (legend.dataset.keys === next) return;
    legend.dataset.keys = next; legend.replaceChildren();
    for (const [caps, label] of keys) {
      const entry = document.createElement('span');
      for (const cap of caps) { const key = document.createElement('kbd'); key.className = 'ui-kbd'; key.textContent = cap; entry.append(key); }
      entry.append(` ${label}`); legend.append(entry);
    }
  }
  /** "Done" steps back; it is the primary of a view that names none, so the footer never goes blank. */
  const done: HubViewAction = { label: 'Done', run: () => restoreParent() };
  function paintViewFooter() {
    if (!viewFooter) return;
    footer.hidden = viewFooter.own;
    const action = viewFooter.primary ?? done;
    primaryText(action.label);
    // Enter runs a named primary, so only that one carries the keycap, and not while it runs.
    if (viewFooter.primary && !viewRunning) { const key = document.createElement('kbd'); key.textContent = '↵'; primary.append(key); }
    disableSlot(primary, !!action.disabled || viewRunning);
    primary.dataset.variant = action.destructive ? 'danger' : 'primary';
    if (!action.armed) { viewArming?.arming.disarm(); viewArming = null; }
    else if (viewArming?.label !== action.label) {
      viewArming?.arming.disarm(); viewArming = { label: action.label, arming: armConfirmation(primary) }; viewArming.arming.arm();
    }
    slotLabel(actionsButton, viewFooter.secondary?.label ?? 'Actions');
    disableSlot(actionsButton, !viewFooter.secondary || !!viewFooter.secondary.disabled || viewRunning);
    count.textContent = '';
    paintLegend(undefined);
    paintBusy();
  }
  /** Runs a view's footer action once; an armed primary refuses anything before it arms and any multi-click. */
  async function runViewAction(action: HubViewAction | null, event?: Event) {
    const state = viewFooter;
    if (!state || !action || action.disabled || viewRunning) return;
    if (action.armed && !viewArming?.arming.accepts(event)) return;
    const task = startTask();
    // The footer slot disables while its action runs; a page the action opens still returns to it.
    actionFocus = focusPlace();
    viewRunning = true; report(''); paintViewFooter();
    try { await action.run(task); }
    catch (error) { task.fail(error); }
    finally { task.end(); if (viewFooter === state) { actionFocus = null; viewRunning = false; paintViewFooter(); } }
  }
  function renderSkillBar(skills: NonNullable<HubRow['skills']>) {
    const bar = document.createElement('span'); bar.className = 'hub-skill-bar';
    skills.forEach((skill, index) => {
      const slot = document.createElement('span'); slot.className = 'hub-skill';
      slot.dataset.elite = String(skill.elite); slot.dataset.changed = String(!!skill.changed); slot.title = `${index + 1}. ${skill.name}${skill.changed ? ' · will change' : ''}`;
      slot.setAttribute('role', 'img'); slot.setAttribute('aria-label', `${index + 1}. ${skill.name}`);
      if (skill.changed) slot.setAttribute('aria-description', 'This slot will change.');
      slot.textContent = String(index + 1);
      if (skill.iconUrl) {
        const image = document.createElement('img'); image.src = skill.iconUrl; image.alt = '';
        image.onerror = () => image.remove(); slot.append(image);
      }
      bar.append(slot);
    });
    return bar;
  }
  function renderBuildInfo(row: Pick<HubRow, 'skills' | 'attributes' | 'attributeStatus'>) {
    const info = document.createElement('span'); info.className = 'hub-build-info';
    if (row.skills) info.append(renderSkillBar(row.skills));
    const attributes = document.createElement('span'); attributes.className = 'hub-attributes';
    for (const group of row.attributes ?? []) {
      const cluster = document.createElement('span'); cluster.className = 'hub-attribute-group';
      const icon = document.createElement('img'); icon.src = group.icon; icon.alt = group.name; icon.title = group.name;
      cluster.append(icon);
      for (const attribute of group.attributes) {
        const chip = document.createElement('span'); chip.className = 'hub-attribute';
        chip.title = `${attribute.name}: ${attribute.rank}${attribute.nextRank !== undefined && attribute.nextRank !== attribute.rank ? ` → ${attribute.nextRank}` : ''} invested ranks`;
        chip.setAttribute('role', 'img'); chip.setAttribute('aria-label', `${attribute.name} ${attribute.rank}${attribute.nextRank !== undefined && attribute.nextRank !== attribute.rank ? ` → ${attribute.nextRank}` : ''}`); chip.setAttribute('aria-description', 'Invested ranks');
        const rank = document.createElement('b'); rank.textContent = `${attribute.rank}${attribute.nextRank !== undefined && attribute.nextRank !== attribute.rank ? ` → ${attribute.nextRank}` : ''}`;
        chip.append(attribute.label, rank); cluster.append(chip);
      }
      attributes.append(cluster);
    }
    if (row.attributeStatus) attributes.textContent = row.attributeStatus;
    info.append(attributes); return info;
  }
  function renderProfessions(professions: NonNullable<HubRow['professions']>) {
    const pair = document.createElement('span'); pair.className = 'hub-professions';
    for (const profession of professions) {
      const icon = document.createElement('img'); icon.src = profession.icon;
      icon.alt = profession.name; icon.title = profession.name; pair.append(icon);
    }
    return pair;
  }
  function appendProfessionLabel(title: HTMLElement, professions: HubRow['professions']) {
    if (!professions?.length) return;
    const label = document.createElement('span'); label.className = 'hub-profession-label';
    label.textContent = professions.map(profession => profession.code).join('/');
    title.append(' ', label);
  }
  function appendFolderLabel(title: HTMLElement, folder: HubRow['folder']) {
    if (folder === null || folder === undefined) return;
    const label = document.createElement('span'); label.className = 'hub-folder-label';
    label.title = `Template folder: ${folder || 'Skills'}`;
    label.setAttribute('aria-label', label.title);
    label.append(hubIcon(document, { id: 'folder', group: 'Builds' }), folder || 'Skills');
    title.append(' ', label);
  }
  let renderedSummary: HubSummary | undefined;
  /** The row the current click run selected; only its own double-click runs it (D-24). */
  let pressed: string | null = null;
  const hover = createHoverSelection();
  function paintNavigation() {
    const summary = disposeView ? undefined : scope?.summary;
    const summaryPanel = required<HTMLElement>('.hub-summary');
    summaryPanel.hidden = !summary;
    if (summary !== renderedSummary) {
      renderedSummary = summary; summaryPanel.replaceChildren();
      if (summary) {
        const label = document.createElement('span'); label.className = 'hub-summary-label'; label.textContent = summary.label;
        const name = document.createElement('strong'); name.textContent = summary.title;
        appendProfessionLabel(name, summary.professions);
        appendFolderLabel(name, summary.folder);
        const detail = document.createElement('p'); detail.textContent = summary.detail;
        summaryPanel.append(label);
        if (summary.professions) name.prepend(renderProfessions(summary.professions));
        summaryPanel.append(name);
        if (summary.skills) summaryPanel.append(renderBuildInfo(summary));
        if (summary.detail) summaryPanel.append(detail);
      }
    }
    const currentTitle = activeView?.title ?? scope?.title ?? 'Home';
    caption.textContent = currentTitle;
    // Home with an empty query, and the views about where you are and who you play (HUB-190).
    const located = activeView ? activeView.destination === 'travel' || activeView.destination === 'characters' : !scope && !input.value.trim();
    const context = located ? [...sources.keys()].filter(sourceEnabled).flatMap(source => source.context?.() ?? []) : [];
    required<HTMLElement>('.hub-context').textContent = context.join(' · ');
    // One quiet lifecycle line on list stages; a report in the status line takes its place.
    lifecycle.textContent = disposeView ? '' : [...sources.keys()].filter(sourceEnabled).map(source => source.lifecycle?.()).find(Boolean) ?? '';
    lifecycle.hidden = !lifecycle.textContent;
    const trail = history.map((page, index) => ({ title: pageTitle(page), index }));
    const nextNavigation = JSON.stringify([trail, currentTitle]);
    if (navigationRevision !== nextNavigation) {
      navigationRevision = nextNavigation;
      breadcrumbs.replaceChildren();
      for (const page of trail) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'hub-crumb'; button.textContent = page.title;
        button.onclick = () => { history.splice(page.index + 1); restoreParent(); };
        const separator = document.createElement('span'); separator.textContent = '›'; separator.setAttribute('aria-hidden', 'true');
        breadcrumbs.append(button, separator);
      }
      caption.setAttribute('aria-current', 'page'); breadcrumbs.append(caption);
    }
    const parent = history.at(-1);
    const destination = parent ? pageTitle(parent) : 'Home';
    backButton.hidden = atHome();
    backButton.textContent = '←';
    backButton.title = 'Back (⌘⌫)';
    backButton.setAttribute('aria-keyshortcuts', 'Meta+Backspace');
    backButton.setAttribute('aria-description', `Return to ${destination}`);
    const query = parseHubQuery(input.value);
    const scopeLabel = required<HTMLElement>('.hub-scope');
    scopeLabel.textContent = query.scope ?? '';
    scopeLabel.hidden = !!scope || !query.scope || !!disposeView;
    // The page title leads, so a screen reader that lands in search after Back hears where it is.
    input.setAttribute('aria-description', `${currentTitle}: ${scope ? 'search actions' : query.scope ? `search ${query.scope}` : 'search tools or use a command example'}`);
    const hint = required<HTMLElement>('.hub-hint');
    const example = commandExamples().find(row => normaliseHubQuery(row.title).startsWith(`${normaliseHubQuery(input.value)} `));
    hint.textContent = !scope && !query.scope && input.value.trim() && example ? `Try “${example.title}” · ${example.detail}` : '';
    hint.hidden = !hint.textContent || !!disposeView;
  }
  function refresh(reset = false) {
    if (!root.open) return;
    // A mounted view keeps its header facts current, e.g. where the player is.
    if (disposeView) { paintNavigation(); return; }
    if (reset) hover.release();
    paintNavigation();
    const previousRows = rows;
    const tradeQuery = parseHubQuery(input.value);
    const tradeRows: HubRow[] = tradeQuery.scope === "trade" && tradeQuery.term && window.gwToolsSettings?.().gwonmacTools && window.gwToolsSettings?.().tradeChat
      ? [{ id: "trade-query", title: `Search Trade for ${tradeQuery.term}`, detail: "Kamadan listings", group: "Tools", action: "Search Trade", run: () => dispatch("gw:trade-toggle", { query: tradeQuery.term }) }] : [];
    const extra = scope ? scope.rows() : [...sources.keys()].filter(sourceEnabled).flatMap(source => source.search(input.value)).concat(tradeRows);
    const parsed = parseHubQuery(input.value);
    // A phrase saved before its words joined the grammar stays stored but no longer matches.
    const saved = shortcuts().filter(entry => !parsed.term ? entry.pinned : entry.phrase === parsed.term && !hubPhraseReserved(entry.phrase))
      .filter(entry => !parsed.scope || entry.id.startsWith(`${parsed.scope}:`));
    const savedRows = saved.flatMap(entry => { const row = lookup(entry.id); return row ? [{ ...row, group: parsed.term ? row.group : 'Pinned' }] : []; });
    const ids = new Set([...extra, ...savedRows].map(row => row.id));
    rows = scope ? matchHubRows(extra, input.value) : [...savedRows, ...extra.filter(row => !savedRows.some(saved => saved.id === row.id)), ...(parsed.term && parsed.scope ? [] : matchHubRows(commands().filter(row => !ids.has(row.id)), input.value))];
    rows = [...rows].sort((a, b) => {
      const groups = ["Pinned", "Calculator", "Teams", "Folders", "Builds", "Targets", "Current build", "Accounts", "Characters", "In your party", "Unlocked heroes", "Heroes", "People", "Places", "Continue", "Tools", "Commands", "Settings", "Sources"];
      const groupOrder = groups.indexOf(a.group) - groups.indexOf(b.group);
      if (groupOrder || scope || a.group !== 'Tools') return groupOrder;
      // Keep everyday game actions ahead of account management, independent of provider order.
      const tools = ['travel', 'character', 'whispers', 'builds', 'trade', 'storage', 'maps', 'accounts'];
      const priority = (id: string) => { const index = tools.indexOf(id); return index < 0 ? tools.length : index; };
      return priority(a.id) - priority(b.id);
    });
    const bindings = resolveShortcuts(window.gwToolsSettings?.().shortcutOverrides ?? {});
    const nextShortcutRevision = JSON.stringify(bindings);
    const shortcutsChanged = shortcutRevision !== nextShortcutRevision;
    shortcutRevision = nextShortcutRevision;
    // Keep mounted options steady when an observer only advances its sequence.
    // Actions still read the newly derived rows, so no stale closure can execute.
    if (!reset && !shortcutsChanged && rows.length === previousRows.length && rows.every((row, index) => {
      const previous = previousRows[index];
      return previous && row.id === previous.id && row.title === previous.title
        && row.detail === previous.detail && row.group === previous.group
        && row.action === previous.action && row.destructive === previous.destructive && row.unavailable === previous.unavailable && row.preview === previous.preview && row.folder === previous.folder && row.attributeStatus === previous.attributeStatus && JSON.stringify([row.skills, row.attributes, row.professions]) === JSON.stringify([previous.skills, previous.attributes, previous.professions]);
    })) { select(selected); return; }
    list.replaceChildren();
    let group = '';
    rows.forEach((row, index) => {
      if (row.group !== group) {
        group = row.group;
        const heading = document.createElement('div');
        heading.className = 'hub-group'; heading.setAttribute('role', 'presentation'); heading.textContent = group;
        list.append(heading);
      }
      const option = document.createElement('div');
      option.id = `hub-result-${index}`; option.dataset.id = row.id; option.className = 'hub-row';
      option.setAttribute('role', 'option'); option.setAttribute('aria-disabled', String(!!row.unavailable));
      if (row.destructive) option.dataset.destructive = 'true';
      const title = document.createElement('span'); title.className = 'hub-title'; title.textContent = row.title;
      appendProfessionLabel(title, row.professions);
      appendFolderLabel(title, row.folder);
      const detail = document.createElement('span'); detail.className = 'hub-detail'; detail.textContent = row.unavailable ?? row.detail;
      const arrow = document.createElement('span'); arrow.className = 'hub-row-arrow'; arrow.textContent = '↵'; arrow.setAttribute('aria-hidden', 'true');
      if (row.conversion) {
        option.classList.add('hub-conversion');
        const source = document.createElement('strong'); source.className = 'hub-conversion-input'; source.textContent = row.conversion.input;
        const from = document.createElement('span'); from.className = 'hub-currency hub-currency-from'; from.textContent = row.conversion.from;
        const to = document.createElement('span'); to.className = 'hub-currency hub-currency-to'; to.textContent = row.conversion.to;
        arrow.textContent = '→'; option.append(title, detail, source, from, to, arrow);
        for (const [url,side] of [[row.conversion.iconFrom,'from'],[row.conversion.iconTo,'to']] as const) { if (!url) continue; const art=document.createElement('img'); art.onerror=() => art.remove(); art.src=url; art.alt=''; art.className=`hub-conversion-art hub-conversion-art-${side}`; option.append(art); }
      } else {
        const type = document.createElement('span'); type.className = 'hub-row-type';
        const shortcutActions: Record<string, ShortcutAction> = { travel: 'travel.open', character: 'character.switch', builds: 'tools.toggle', trade: 'trade.toggle', whispers: 'whispers.toggle', storage: 'storage.open' };
        const shortcut = shortcutActions[row.id];
        if (shortcut) for (const key of shortcutKeycaps(bindings[shortcut])) {
          const cap = document.createElement('kbd'); cap.className = 'ui-kbd'; cap.textContent = key.label; cap.setAttribute('aria-label', key.name); type.append(cap);
        }
        option.append(row.professions?.length ? renderProfessions(row.professions) : hubIcon(document, row), title, detail, type);
        if (row.navigate) { const child = document.createElement('span'); child.className = 'hub-child-cue'; child.textContent = '›'; child.setAttribute('aria-hidden', 'true'); type.append(child); }
        detail.hidden = !detail.textContent;
        if (row.skills) {
          option.classList.add('hub-build-row');
          option.append(renderBuildInfo(row));
        }
      }
      // While this page's action runs, the pointer never moves the selection off it (HUB-083).
      option.addEventListener('pointermove', event => { if (!busy() && hover.selects(event)) select(row.id); });
      // A click opens a navigational row but only selects one that changes the game or the
      // account; the footer primary or a double-click that started on this row runs it (D-24).
      // A page change between the clicks cancels the run in the surface controller (HUB-242).
      // The click holds its selection while the pointer crosses other rows to the footer.
      option.addEventListener('click', event => {
        if (busy()) return;
        if (event.detail <= 1) { pressed = row.id; hover.hold(); select(row.id); focusResult(); if (!row.consequential) void run(); }
        else if (event.detail === 2 && row.consequential && pressed === row.id && selected === row.id) void run();
      });
      // Right-click selects the row and opens its Actions (HUB-248).
      option.addEventListener('contextmenu', event => { event.preventDefault(); if (busy()) return; hover.hold(); select(row.id); focusResult(); openMenu(); });
      list.append(option);
    });
    count.textContent = `${rows.length} result${rows.length === 1 ? '' : 's'}`;
    const exactCount = rows.filter(row => normaliseHubQuery(row.title) === parsed.term || savedRows.some(saved => saved.id === row.id)).length;
    const prior = previousRows.find(row => row.id === selected);
    const revised = prior && rows.find(row => row.id === selected)?.preview !== prior.preview;
    // A bare scope (`travel `) lists without a term, so nothing in it is an explicit result:
    // Enter never travels, invites, applies, switches or opens an account on a guess.
    // A fresh Home in an explorable area never starts on a row that leaves it (D-13).
    const initial = !input.value.trim() ? rows.find(row => row.preferred && !row.unavailable) ?? rows.find(row => !row.unavailable && !row.leavesArea) ?? rows.find(row => !row.leavesArea)
      : !scope && parsed.scope && !parsed.term ? rows.find(row => !row.consequential && !row.unavailable) : rows[0];
    const settling = reset || (awaitingResults && selected === null && rows.length > 0);
    if (settling) awaitingResults = !rows.length;
    // A placeholder row that goes away (a loading or state row) hands its selection to what
    // replaced it, as a fresh query would, so Enter acts without another key (HUB-232).
    const replacedPlaceholder = !!prior?.unavailable && !rows.some(row => row.id === prior.id);
    select((prior?.id === 'quote-state' || prior?.id === 'market-state') && !!rows[0]?.conversion ? rows[0].id : settling || replacedPlaceholder ? exactCount > 1 ? null : initial?.id ?? null : !revised && rows.some(row => row.id === selected) ? selected : null);
    if (!rows.length) {
      const empty = document.createElement('p'); empty.className = 'hub-empty'; empty.textContent = 'No matches'; list.append(empty);
    }
  }
  /**
   * Binds an action to the page session that starts it (HUB-004). While that page shows, the
   * action reports progress and failures in the status line and its success closes the Hub with
   * the receipt. After the player moved on, it never navigates: its progress stays in the status
   * line, and it ends with a receipt or a failure receipt.
   * An action that focuses another window (Open an account, Show Launcher) suspends its own
   * page; its success still ends the task, so the next opening starts at Home.
   */
  function startTask(): HubTask & { fail(error: unknown): void; end(): void } {
    const started = session;
    const live = () => root.open && session === started;
    const token = {};
    return {
      live,
      // Progress repaints only over itself or an empty line (or on its own page): a newer
      // message, e.g. a refusal or another action's failure, stays until the next report('').
      progress: message => { progress = { owner: token, message }; if (live() || progressInStatus || status.hidden) report(''); },
      done: receipt => {
        if (live() || (!root.open && suspended && suspendedSession === started)) close(receipt);
        else if (receipt) notify(receipt);
      },
      fail: error => {
        const message = error instanceof Error ? error.message : 'The action could not complete. Try again.';
        if (live()) report(message); else notify(message, 'failed');
      },
      // An action that ended without a receipt, e.g. one whose view shows its own outcome, never leaves its progress behind.
      end: () => { if (progress?.owner !== token) return; progress = null; if (progressInStatus) report(''); },
    };
  }
  async function run() {
    const row = rows.find(row => row.id === selected);
    if (!row) return;
    // One action at a time per page: Enter names the running one instead of starting another.
    if (busy()) { report(running!.again); return; }
    if (row.unavailable) { report(row.unavailable); return; }
    const task = startTask();
    const mine = { session, label: row.pending?.label ?? row.action, again: row.pending?.again ?? `${row.action} is still running.` };
    running = mine; select(selected); report(''); if (row.pending) task.progress(row.pending.label);
    try {
      if(row.searchQuery!==undefined){remember();resetView();scope=null;caption.textContent='Home';input.value=row.searchQuery;refresh(true);input.focus();input.select();}
      else await row.run(task);
    }
    catch (error) { task.fail(error); }
    finally { task.end(); if (running === mine) { running = null; if (root.open) select(selected); } }
  }
  function resetView() {
    endSession(); restoringFocus?.disconnect(); restoringFocus = null; keepDrafts(); pressed = null; modal.pageChanged(); closeMenu(false);
    disposeView?.(); disposeView = null; activeView = null; viewAvailable = null; content.replaceChildren(); content.hidden = true;
    viewFooter = null; viewRunning = false; actionFocus = null; viewArming?.arming.disarm(); viewArming = null;
    search.hidden = false; list.hidden = false; footer.hidden = false;
  }
  function home() {
    history.length = 0; resetView(); scope = null; input.value = restoreQuery;
    root.dataset.page = 'home'; caption.textContent = 'Home'; input.placeholder = 'Search people, places, builds…'; report(''); refresh(true); input.focus();
  }
  function atHome() { return !scope && !activeView; }
  /**
   * ⌘⌫, the Back button and the mouse back button: exactly one level up, never a close.
   * A page opened directly (⌘T, ⌘E, ⌘B) has no parent and returns to the real Home.
   */
  function back() {
    if (history.length) restoreParent();
    else if (!atHome()) home();
    else return;
    announceDestination();
  }
  /**
   * Focus stays in search across Back, so nothing else tells a screen reader where it landed:
   * the destination's title is spoken once, as the answer to the player's own press. It is
   * never a feed update (D-15), and it stays mounted so its first message is heard (HUB-114).
   */
  function announceDestination() {
    if (!root.open) return;
    const title = activeView?.title ?? scope?.title ?? 'Home';
    // The same destination twice in a row still changes the text, so it is spoken again.
    announcer.textContent = announcer.textContent === title ? `${title}\u00a0` : title;
  }
  /**
   * Esc once a view's own levels and an open disclosure had their say (the surface controller's
   * one Escape rule): clear a typed query, then go back one level, then close (D-4).
   */
  function dismiss() {
    if (!search.hidden && input.value) { endSession(); input.value = ''; report(''); refresh(true); input.focus(); return; }
    restoreParent(); announceDestination();
  }
  function close(message?: string) {
    if (root.open) frame = required<HTMLElement>('.hub-panel').getBoundingClientRect();
    suspended = null; history.length = 0; resetView(); modal.close(); for (const source of sources.keys()) source.setVisible(false); scope = null;
    input.value = ''; restoreQuery = ''; report(''); selected = null; announcer.textContent = '';
    if (typeof message === 'string' && message) notify(message);
  }
  /**
   * A named outcome. An open Hub reports it in its status line; after the Hub closed
   * it shows briefly where the frame's footer stood, and never outlives the next opening.
   * A failure also waits in the status line of that next opening, so it is never dropped.
   */
  function notify(message: string, outcome?: 'failed') {
    if (root.open) { report(message, true); return; }
    if (outcome === 'failed') carriedFailure = message;
    clearTimeout(receiptTimer); receipt.textContent = message; receipt.hidden = false; receiptTimer = setTimeout(() => { receipt.hidden = true; }, 8000);
    receipt.dataset.outcome = outcome ?? 'done';
    if (frame?.width) {
      receipt.style.left = `${frame.left + frame.width / 2}px`; receipt.style.bottom = `${Math.max(8, window.innerHeight - frame.bottom + 12)}px`;
      receipt.style.maxWidth = `${Math.max(0, frame.width - 24)}px`;
    }
  }
  function suspend() {
    if (!root.open) return;
    frame = required<HTMLElement>('.hub-panel').getBoundingClientRect();
    suspended = capture(); suspendedAt = Date.now(); suspendedSession = session; endSession(); modal.close();
    for (const source of sources.keys()) source.setVisible(false);
  }
  const resumable = () => suspended !== null && Date.now() - suspendedAt <= RESUME_MS;
  const pageDestination = (page: Pick<Page, 'scope' | 'view'>) => page.view ? page.view.destination : page.scope?.destination;
  /** Whether the next opening resumes a suspended page whose path holds this destination. */
  const suspendedOn = (destination: HubDestination) => !root.open && resumable() && [...history, suspended!].some(page => pageDestination(page) === destination);
  /**
   * Resumes a suspended page. Suspending hides the Hub without unmounting it, so the page is
   * still mounted and keeps its drafts, its confirmation and its view state; only its facts
   * refresh (HUB-050). A resumed Hub search is selected, so typing starts a new search (D-11).
   */
  function resumePage(page: Page) {
    const mounted = page.view ? page.view === activeView : !disposeView && page.scope === scope;
    if (!mounted) restorePage(page);
    else if (page.view?.available && !page.view.available()) { restoreParent(); return; }
    else { if (!page.view) refresh(); restoreFocus(page.focus); }
    if (document.activeElement === input) input.select();
  }
  /** The page on top takes the keyboard unless it already holds it: its search, else its first control. */
  function focusPage() {
    const active = document.activeElement;
    if (active === input) { input.select(); return; }
    if (active instanceof HTMLElement && content.contains(active) && !content.hidden) return;
    (searchField() ?? firstControl()).focus({ preventScroll: true });
  }
  /**
   * The one direct-shortcut contract (⌘E, ⌘T, ⌘B, the Settings menu item). The destination on
   * top takes focus; one lower on the open path is returned to, like its breadcrumb; a suspended
   * Hub whose path holds it resumes; otherwise it opens, over the open Hub's page or as the only
   * page of a fresh Hub, with no artificial parent. A repeated shortcut never stacks history and
   * never closes the Hub (HUB-049, HUB-172).
   */
  function direct(destination: HubDestination, open: () => void) {
    if (suspendedOn(destination)) { show(); return; }
    if (root.open) {
      if (pageDestination({ scope, view: activeView }) === destination) { focusPage(); return; }
      const index = history.findIndex(page => pageDestination(page) === destination);
      if (index >= 0) { history.splice(index + 1); restoreParent(); announceDestination(); return; }
    }
    open();
  }
  const modal = window.gwSurfaces.registerDialog({ root, priority: 6, transient: true,
    dismiss,
    // A backdrop click keeps the task for the next ⌘R, like a trip to another window (HUB-052).
    backdrop: suspend,
    // Focus never lands on <body>: without a visible opener it returns to the game.
    restoreFocus: () => previousFocus?.isConnected && previousFocus !== document.body && previousFocus.getClientRects().length > 0
      ? previousFocus : document.getElementById('canvas'),
  });
  /**
   * The Hub shortcut (⌘R). A closed Hub opens: a page suspended within the resume window
   * resumes, otherwise Home starts fresh (D-11). An open Hub goes Home, keeping a query typed
   * there selected, and never closes.
   */
  function show() {
    if (root.open) { if (atHome()) restoreQuery = input.value; home(); input.select(); return; }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    clearTimeout(receiptTimer); receipt.hidden = true;
    window.dispatchEvent(new Event('gw:input-reset'));
    modal.show(); window.dispatchEvent(new Event('gw:hub-visible'));
    const resume = resumable() ? suspended : null;
    // A task left longer than the resume window starts fresh at Home.
    if (suspended && !resume) restoreQuery = '';
    suspended = null;
    for (const source of sources.keys()) source.setVisible(sourceEnabled(source));
    if (resume) resumePage(resume); else home();
    if (carriedFailure) { report(carriedFailure, true); carriedFailure = ''; }
  }
  input.addEventListener('input', () => { endSession(); if (!receiptInStatus) report(''); refresh(true); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    const step = listKeyStep(event, Math.max(1, Math.floor(list.clientHeight / (list.querySelector<HTMLElement>('.hub-row')?.offsetHeight || 40)) - 1));
    if (step !== null) {
      // The list owns these keys even without results, so they never move the caret or drop a text selection.
      event.preventDefault();
      if (!rows.length || busy()) return;
      hover.release();
      select(rows[listIndexAfter(rows.findIndex(row => row.id === selected), rows.length, step)]!.id, true);
    } else if (event.key === 'ArrowRight' && !event.repeat && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
      const row = rows.find(row => row.id === selected);
      if (row?.navigate) { event.preventDefault(); row.navigate(startTask()); }
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Only a plain Enter runs the named primary; a modified Enter is never a second route to it.
      event.preventDefault(); if (!event.repeat) void run();
    }
  });
  // A press on a result keeps the keyboard in search.
  list.addEventListener('mousedown', event => event.preventDefault());
  list.addEventListener('pointerleave', () => hover.release());
  // ⌘⌫ is Back from any focus inside the Hub, text fields included; ⌫ alone only edits text.
  // It bubbles here, so a mounted view first steps out of its own inner level (a confirmation,
  // its settings) and marks the press handled; the Hub still owns the press either way.
  root.addEventListener('keydown', event => {
    if (!isHubBackKey(event)) return;
    event.stopPropagation();
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (event.repeat || closeMenu() || closeDisclosure(event.target, root)) return;
    back();
  });
  root.addEventListener('mouseup', event => { if (event.button === 3) { event.preventDefault(); back(); } });
  root.addEventListener('keydown', event => {
    restoringFocus?.disconnect(); restoringFocus = null;
    // Typing on a button or blank space returns to the page's search, the header's included;
    // Space still presses the button. A form keeps its keys: a form view has no search, and
    // a form region a view marks with data-hub-form (Travel's Customize) stays form-first.
    const field = searchField();
    if (!event.defaultPrevented && field && event.target instanceof HTMLElement && event.target !== field && !event.target.isContentEditable
      && !event.target.matches('input,textarea,select') && !event.target.closest('[data-hub-form]')
      && !(event.key === ' ' && event.target.matches('button,summary')) && resumeSearchInput(event, field)) return;
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || target === required<HTMLElement>('.hub-resize')) return;
    if (target.closest('.hub-footer')) {
      const controls = [primary, required<HTMLButtonElement>('.hub-actions')].filter(button => !button.hidden && !button.disabled);
      if (event.key === 'ArrowUp') { event.preventDefault(); (search.hidden ? firstControl() : input).focus(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); controls[Math.max(0, Math.min(controls.length - 1, controls.indexOf(target as HTMLButtonElement) + (event.key === 'ArrowRight' ? 1 : -1)))]?.focus(); }
      return;
    }
    if (target.closest('.hub-heading')) {
      const controls = [...required<HTMLElement>('.hub-heading').querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.hidden && button.getClientRects().length);
      const index = controls.indexOf(target as HTMLButtonElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); (searchField() ?? firstControl()).focus(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); controls[Math.max(0, Math.min(controls.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))]?.focus(); }
      return;
    }
    // Enter in a view runs its named primary, except on a control that Enter activates itself.
    if (event.key === 'Enter' && viewFooter?.primary && content.contains(target)
      && !target.matches('button,a[href],summary,select,textarea,input[type=checkbox],input[type=radio],input[type=range]')) {
      event.preventDefault(); void runViewAction(viewFooter.primary, event); return;
    }
    // ↑ ↓ step between a view's controls in screen order, within the focused control's column
    // (a nav or a scrolled body, HUB-054), and stop at its ends. A combobox's arrows belong to
    // its list, and a focused scroller that overflows scrolls natively (HUB-088).
    if (content.contains(target) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (target.matches('select,input[type="range"],input[role=combobox],textarea') || target.isContentEditable) return;
      if (!target.matches('input,button,a[href],summary') && target.scrollHeight > target.clientHeight) return;
      const column = target.parentElement?.closest<HTMLElement>('nav,.ui-scroll') ?? content;
      const controls = focusableElements(content.contains(column) ? column : content).sort((a, b) => { const left = a.getBoundingClientRect(), right = b.getBoundingClientRect(); return left.top - right.top || left.left - right.left; });
      const index = controls.indexOf(target);
      if (index < 0) return;
      event.preventDefault();
      controls[Math.max(0, Math.min(controls.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    }
  });
  function showBuildDetails(row: HubRow) {
    const incoming = scope?.summary;
    presenter.showView('Build details', target => {
      const view = document.createElement('section'); view.className = 'hub-build-details ui-scroll';
      for (const build of [...(incoming ? [incoming] : []), row]) {
        const heading = document.createElement('h2'); heading.textContent = 'label' in build ? `${build.label}: ${build.title}` : `${build.title} · ${build.detail}`; view.append(heading);
        if (build.workspace) { const open = document.createElement('button'); open.className = 'ui-button'; open.textContent = 'Open in Build Library'; open.onclick = build.workspace; view.append(open); }
        if (build.skills) {
          view.append(renderBuildInfo(build));
          const skills = document.createElement('ol');
          for (const skill of build.skills) { const item = document.createElement('li'); const name = document.createElement('strong'); name.textContent = skill.name; const description = document.createElement('p'); description.textContent = skill.description ?? 'Description not available.'; item.append(name, description); skills.append(item); }
          view.append(skills);
        }
        const attributes = document.createElement('p'); attributes.textContent = build.attributeStatus ?? build.attributes?.flatMap(group => group.attributes.map(attribute => `${attribute.name} ${attribute.rank}${attribute.nextRank !== undefined && attribute.nextRank !== attribute.rank ? ` → ${attribute.nextRank}` : ''}`)).join(' · ') ?? '';
        if (attributes.textContent) { attributes.prepend('Invested attributes: '); view.append(attributes); }
      }
      view.tabIndex = 0; target.append(view); view.focus();
      return () => view.remove();
    });
  }
  type MenuEntry = Readonly<{ label: string; section: 'Primary' | 'Details' | 'Personalize'; keys?: readonly string[]; destructive?: boolean; disabled?: boolean; run(): void | Promise<void> }>;
  /**
   * A row's Actions, verb first: its primary (↵), a second way into it (build details, rates),
   * then pinning and a search phrase for rows the Hub can keep (HUB-040, HUB-184).
   */
  function menuEntries(row: HubRow): MenuEntry[] {
    const entries: MenuEntry[] = [{ label: row.action, section: 'Primary', keys: ['↵'], ...(row.destructive ? { destructive: true } : {}), disabled: !!row.unavailable, run: () => run() }];
    if (row.skills || scope?.summary?.skills) entries.push({ label: 'Show build details', section: 'Details', run: () => showBuildDetails(row) });
    else if (row.actions && row.actionsLabel) entries.push({ label: row.actionsLabel, section: 'Details', run: () => row.actions?.() });
    if (!scope && isHubShortcuts([{ id: row.id, phrase: '', pinned: false }])) {
      const pinned = shortcuts().some(entry => entry.id === row.id && entry.pinned);
      entries.push({ label: pinned ? 'Unpin from Hub' : 'Pin to Hub', section: 'Personalize', run: async () => {
        const entries = shortcuts(); const old = entries.find(entry => entry.id === row.id);
        try { await saveShortcuts([...entries.filter(entry => entry.id !== row.id), { id: row.id, phrase: old?.phrase ?? '', pinned: !old?.pinned }]); report(pinned ? `Unpinned ${row.title}.` : `Pinned ${row.title}.`); }
        catch { report('Could not update the pin. Try again.', true); }
      } });
      entries.push({ label: 'Set search phrase…', section: 'Personalize', run: () => editHubShortcut(presenter, row, shortcuts, saveShortcuts) });
    }
    return entries;
  }
  /** Opens the selected row's Actions over the footer; the page, query and selection stay. */
  function openMenu() {
    const row = rows.find(row => row.id === selected);
    if (viewFooter || busy() || !row) return;
    const entries = menuEntries(row);
    if (entries.length < 2) return;
    menu.replaceChildren(); menuRow = row.id;
    let section = '';
    for (const entry of entries) {
      if (entry.section !== section) { section = entry.section; const heading = document.createElement('p'); heading.className = 'hub-menu-section'; heading.setAttribute('role', 'presentation'); heading.textContent = section; menu.append(heading); }
      const item = document.createElement('button'); item.type = 'button'; item.className = 'hub-menu-item'; item.setAttribute('role', 'menuitem'); item.disabled = !!entry.disabled;
      if (entry.destructive) item.dataset.variant = 'danger';
      const label = document.createElement('span'); label.textContent = entry.label; item.append(label);
      if (entry.keys) { const keys = document.createElement('span'); keys.className = 'hub-menu-keys'; for (const cap of entry.keys) { const key = document.createElement('kbd'); key.className = 'ui-kbd'; key.textContent = cap; keys.append(key); } item.append(keys); }
      // The item runs on its first click only; the menu closes first, so its action owns the page.
      item.onclick = event => { if (event.detail > 1) return; closeMenu(); void entry.run(); };
      menu.append(item);
    }
    // The menu stands on the footer, however tall the footer is.
    menu.style.bottom = `${footer.offsetHeight + 8}px`;
    menu.hidden = false; actionsButton.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLElement>('.hub-menu-item:not(:disabled)')?.focus({ preventScroll: true });
  }
  /** Closes the Actions menu; with `refocus` the keyboard returns to search. Whether a menu was open. */
  function closeMenu(refocus = true) {
    if (menu.hidden) return false;
    const inside = menu.contains(document.activeElement);
    menu.hidden = true; menuRow = null; actionsButton.setAttribute('aria-expanded', 'false'); menu.replaceChildren();
    if (refocus || inside) (search.hidden ? firstControl() : input).focus({ preventScroll: true });
    return true;
  }
  // The menu's own keys: the shared list move, Esc closes only the menu, Tab leaves it.
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll<HTMLButtonElement>('.hub-menu-item:not(:disabled)')];
    const step = listKeyStep(event, items.length);
    if (step !== null) { event.preventDefault(); items[listIndexAfter(items.indexOf(document.activeElement as HTMLButtonElement), items.length, step)]?.focus(); }
    else if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
    else if (event.key === 'Tab') closeMenu(false);
  });
  // A press anywhere else in the Hub closes the menu; the Actions button toggles it itself.
  root.addEventListener('pointerdown', event => { if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target) && !actionsButton.contains(event.target)) closeMenu(false); }, true);
  // ⌘J opens and closes Actions from anywhere in the Hub (D-1).
  root.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'j' || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat && !closeMenu()) openMenu();
  });
  // In a view the Actions slot is the view's named secondary.
  // A double-click's second press never toggles the menu shut or runs anything (PTR-17).
  actionsButton.onclick = event => { if (event.detail > 1) return; if (viewFooter) void runViewAction(viewFooter.secondary, event); else if (!closeMenu()) openMenu(); };
  required<HTMLButtonElement>('.hub-close').onclick = () => close();
  // The primary acts once per click run, so a double-click on it runs its action once.
  backButton.onclick = back;
  primary.onclick = event => { if (event.detail > 1) return; if (viewFooter) void runViewAction(viewFooter.primary ?? done, event); else void run(); };
  root.addEventListener('pointerdown', () => { restoringFocus?.disconnect(); restoringFocus = null; });
  // A press on blank panel space or a disabled control parks focus on the dialog
  // itself; return it to the last control so the keyboard keeps its place.
  // A view's own dialog root (Characters) parks focus the same way (HUB-246).
  let lastFocus: HTMLElement | null = null;
  const keepPlace = () => {
    const usable = !!lastFocus?.isConnected && root.contains(lastFocus) && focusable(lastFocus);
    (usable ? lastFocus! : search.hidden ? firstControl() : input).focus({ preventScroll: true });
  };
  root.addEventListener('focusin', event => {
    if (event.target instanceof HTMLDialogElement && event.target !== root) keepPlace();
    else if (event.target !== root && event.target instanceof HTMLElement) lastFocus = event.target;
  });
  root.addEventListener('focus', keepPlace);
  root.addEventListener('close', () => { if (!root.open && !suspended) close(); });
  const onBlur = () => suspend();
  let enabledSources = new Set<HubSource>();
  const onSettings = () => {
    const disabled = [...enabledSources].some(source => !sourceEnabled(source));
    enabledSources = new Set([...sources.keys()].filter(sourceEnabled));
    for (const source of sources.keys()) source.setVisible(root.open && sourceEnabled(source));
    if ((disposeView && (viewAvailable ? !viewAvailable() : disabled)) || (scope && disabled)) { suspended = null; home(); }
    else refresh();
  };
  window.addEventListener('blur', onBlur); window.addEventListener('gw:tools-settings', onSettings);
  /** A new page starts over the open Hub's page, which Back returns to, or as the only page of a fresh Hub. */
  function enterPage() {
    const fromOpenHub = root.open;
    if (!fromOpenHub) { suspended = null; show(); }
    if (!scope) restoreQuery = input.value;
    if (fromOpenHub) remember();
  }
  /** Mounts a view page, a new one or one that Back restores, with its footer and drafts. */
  function mountView(view: MountedView) {
    resetView();
    root.dataset.page = 'section'; caption.textContent = view.title;
    required<HTMLElement>('.hub-preview').hidden = true; required<HTMLElement>('.hub-rate-controls').hidden = true;
    search.hidden = true; list.hidden = true; content.hidden = false;
    activeView = view;
    viewAvailable = view.available ?? null;
    const state: ViewFooter = { primary: null, secondary: null, own: false };
    viewFooter = state;
    // A disposed view's late update never repaints the next page's footer.
    const shell: HubViewFooter = {
      primary: next => { state.primary = next; if (viewFooter === state) paintViewFooter(); },
      secondary: next => { state.secondary = next; if (viewFooter === state) paintViewFooter(); },
      own: () => { state.own = true; if (viewFooter === state) paintViewFooter(); },
    };
    paintViewFooter();
    disposeView = view.mount(content, restoreParent, shell);
    restoreDrafts([...history.map(pageTitle), view.title].join(' › '));
    paintNavigation();
    if (!content.contains(document.activeElement)) firstControl().focus();
  }
  const presenter = {
    show, close: () => close(), suspend, openSettings, direct, suspendedOn,
    /** A mounted view replaced its own page (a confirmation): a click run from before it is cancelled. */
    pageChanged: () => modal.pageChanged(),
    get visible() { return root.open; },
    /** Whether Esc on an empty query goes back to a parent page rather than closing the Hub. */
    get hasParent() { return history.length > 0; },
    attach(next: HubSource) {
      if (sourceEnabled(next)) enabledSources.add(next);
      sources.set(next, next.subscribe(() => refresh())); next.setVisible(root.open && sourceEnabled(next)); refresh();
      return () => {
        sources.get(next)?.(); sources.delete(next); enabledSources.delete(next); next.setVisible(false);
        if (root.open && (!disposeView || !viewAvailable || !viewAvailable())) home();
      };
    },
    showRows(title: string, getRows: () => readonly HubRow[], summary?: HubSummary, destination?: HubDestination) {
      enterPage();
      resetView(); scope = { title, rows: getRows, ...(summary ? { summary } : {}), ...(destination ? { destination } : {}) }; root.dataset.page = 'section'; caption.textContent = title;
      input.placeholder = 'Search actions…'; input.value = ''; report(''); refresh(true); focusResult();
    },
    showView(title: string, mount: HubViewMount<HTMLElement>, available?: () => boolean, destination?: HubDestination) {
      enterPage();
      mountView({ title, mount, ...(available ? { available } : {}), ...(destination ? { destination } : {}) });
    },
    notify,
    browseBuilds() { direct('builds', () => { const row = lookup('builds'); if (row && !row.unavailable) void row.run(startTask()); else report('Build Library is loading. Try again.'); }); },
    resetPosition: hubWindow.reset,
    dispose() { close(); clearTimeout(receiptTimer); receipt.remove(); hubWindow.dispose(); disposeFrame(); for (const unsubscribe of sources.values()) unsubscribe(); sources.clear(); modal.dispose(); root.remove(); window.removeEventListener('blur', onBlur); window.removeEventListener('gw:tools-settings', onSettings); },
  };
  presenter.attach(createHubAccounts(presenter, { get: () => window.gwNative.accounts.get(), open: request => window.gwNative.accounts.open(request), manage: () => window.gwNative.app.showLauncher() }));
  presenter.attach(createHubCalculator({
    hub: presenter,
    // A copy names what it put on the clipboard in the status line (D-8); it is never silent.
    copy: async value => { await window.gwNative.clipboard.writeText(value); notify(`Copied “${value}”`); },
    marketEnabled: () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().tradeChat,
    market: () => 'trade' in window.gwNative ? window.gwNative.trade.getMarketRates() : Promise.reject(new Error('Rate unavailable')),
    quotes: () => 'trade' in window.gwNative ? window.gwNative.trade.getTraderQuotes() : Promise.reject(new Error('Rate unavailable')),
  }));
  return presenter;
}
export type Hub = ReturnType<typeof createHub>;
