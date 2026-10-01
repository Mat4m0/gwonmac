/**
 * Owns the Core command palette, its search focus and transient modal lifetime.
 * Optional Tools contributes local results and views without entering Core's imports.
 */
import { HUB_SEARCH_GLYPH } from '../shared/ui/hub-search.js';
import { resumeSearchInput } from './search-input.js';
import { installHubWindow } from './hub-window.js';
import { attachClassicFrame } from '../shared/ui/frame.js';
import { isHubBackKey, resolveShortcuts, shortcutKeycaps, type ShortcutAction } from '../shared/keyboard-shortcuts.js';
import { FINDABLE_SETTINGS, focusHubSetting, openHubSettings, type HubSettingsFocus } from "./hub-settings.js";
import { createHubAccounts } from './hub-accounts.js';
import { hubIcon } from "./hub-icons.js";
import { editHubShortcut, manageHubShortcuts } from './hub-preferences.js';
import { hubPhraseReserved, isHubShortcuts, isLibraryHubShortcut, type HubShortcut } from '../shared/hub-preferences.js';
import { createHubCalculator } from './hub-calculator.js';
import { recogniseCurrencyTokens } from '../shared/hub-currency-tokens.js';
import { DEFAULT_CALCULATOR_RATES, type Currency } from '../shared/hub-calculator.js';
import { currencyIcon } from '../shared/currency-assets.js';
import { armConfirmation, closeDisclosure, focusable, focusableElements } from './surface-controller.js';
import { listIndexAfter, listKeyStep } from '../shared/ui/list-keys.js';
import { createHoverSelection } from '../shared/ui/hover-selection.js';
import { hubMatch, matchHubRows, parseHubQuery, normaliseHubQuery, hubTier, type HubDestination, type HubRow, type HubSource, type HubSummary, type HubTask, type HubViewAction, type HubViewFooter, type HubViewMount } from '../shared/hub.js';
export function createHub(parent: HTMLElement) {
  const document = parent.ownerDocument;
  const root = document.createElement('dialog');
  root.id = 'hub';
  root.className = 'ui-modal ui-modal-layer';
  root.dataset.page = "home";
  root.setAttribute('aria-labelledby', 'hub-name hub-title-separator hub-caption');
  root.innerHTML = `<section class="hub-panel ui-frame">
    <header class="hub-heading ui-window-head"><button class="ui-button hub-back" data-variant="quiet" aria-label="Back" hidden>← Back</button><span class="hub-name" id="hub-name">Hub</span><span id="hub-title-separator" hidden>—</span><nav class="hub-breadcrumbs" aria-label="Hub breadcrumb"><span class="hub-caption" id="hub-caption" role="heading" aria-level="1">Home</span></nav><span class="hub-context"></span><button class="ui-window-lock hub-lock" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="5" y="11" width="14" height="10" rx="2"/></svg></button><button class="ui-window-close hub-close" aria-label="Close Hub" title="Close Hub">×</button></header>
    <section class="hub-summary" aria-label="Build to apply" hidden></section>
    <div class="hub-search ui-hub-search"><svg viewBox="0 0 24 24" aria-hidden="true">${HUB_SEARCH_GLYPH}</svg><span class="hub-scope" hidden></span><input type="text" role="combobox" aria-label="Search people, places, builds" aria-describedby="hub-hint" aria-autocomplete="list" aria-controls="hub-results" aria-expanded="true" placeholder="Search people, places, builds…" autocomplete="off" spellcheck="false" maxlength="120"><span class="hub-progress" aria-hidden="true"></span></div>
    <div class="hub-rate-controls" hidden></div><div class="hub-results ui-scroll" id="hub-results" role="listbox" aria-label="Results" tabindex="-1"></div>
    <p class="hub-empty" hidden>No matches</p><pre class="hub-preview ui-scroll" hidden></pre><div class="hub-view" hidden></div><div class="hub-footer-status"><p class="hub-status" role="status"></p><p class="hub-lifecycle" hidden></p><p class="hub-hint" id="hub-hint" hidden></p></div><p class="hub-announce ui-sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
    <footer class="hub-footer"><span class="hub-legend"></span><span class="hub-count"></span><button class="hub-primary ui-button" data-variant="primary"></button><button class="hub-actions ui-button" data-variant="quiet" aria-haspopup="menu" aria-expanded="false">Actions</button></footer>
    <div class="hub-menu" role="menu" aria-label="Actions" hidden></div>
    <button class="ui-window-resize hub-resize" aria-label="Resize Hub" title="Drag to resize, or use arrow keys" hidden></button>
  </section>`;
  parent.append(root);
  const receipt = document.createElement('div'); receipt.className = 'hub-receipt ui-toast'; receipt.popover = 'manual'; receipt.setAttribute('aria-hidden', 'true'); receipt.hidden = true;
  // The visual popover is absent while closed; this persistent node announces its first outcome.
  const receiptAnnouncement = document.createElement('p'); receiptAnnouncement.className = 'hub-receipt-announcement ui-sr-only'; receiptAnnouncement.setAttribute('role', 'status'); receiptAnnouncement.setAttribute('aria-atomic', 'true'); parent.append(receipt, receiptAnnouncement);
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
  // A measuring layer adds artwork in native word gaps; the input remains the sole editor.
  const glyphs = document.createElement('div'); glyphs.className = 'hub-search-glyphs'; glyphs.setAttribute('aria-hidden', 'true'); search.append(glyphs);
  let composing = false, glyphFrame = 0;
  const syncGlyphScroll = () => { glyphs.scrollLeft = input.scrollLeft; };
  function paintGlyphs() {
    if (composing) return;
    const mode = root.open && !disposeView && !scope && !parseHubQuery(input.value).scope && /^\s*(?:\d|\.\d)/u.test(input.value);
    input.classList.toggle('hub-calculation-input', mode); glyphs.classList.toggle('hub-calculation-input', mode);
    glyphs.hidden = !mode;
    if (!mode) { glyphs.replaceChildren(); return; }
    const box = input.getBoundingClientRect(), parentBox = search.getBoundingClientRect();
    glyphs.style.left = `${box.left - parentBox.left}px`; glyphs.style.top = `${box.top - parentBox.top}px`;
    glyphs.style.width = `${input.clientWidth}px`; glyphs.style.height = `${input.clientHeight}px`;
    const text = input.value, spans: { span: HTMLSpanElement; unit: Currency }[] = [];
    const fragment = document.createDocumentFragment(); let position = 0;
    for (const token of recogniseCurrencyTokens(text)) {
      fragment.append(document.createTextNode(text.slice(position, token.start)));
      const span = document.createElement('span'); span.textContent = text.slice(token.start, token.end);
      span.dataset.start = String(token.start); span.dataset.end = String(token.end); span.dataset.unit = token.unit;
      fragment.append(span); spans.push({ span, unit: token.unit }); position = token.end;
    }
    fragment.append(document.createTextNode(text.slice(position))); glyphs.replaceChildren(fragment);
    const glyphBox = glyphs.getBoundingClientRect(), fontSize = Number.parseFloat(getComputedStyle(input).fontSize);
    for (const { span, unit } of spans) {
      const url = currencyIcon(unit); if (!url) continue;
      const icon = document.createElement('img'); icon.src = url; icon.alt = ''; icon.dataset.unit = unit;
      const end = span.getBoundingClientRect().right - glyphBox.left + glyphs.scrollLeft;
      icon.style.left = `${end + fontSize * 0.625}px`; icon.onerror = () => icon.remove(); glyphs.append(icon);
    }
    syncGlyphScroll();
    cancelAnimationFrame(glyphFrame); glyphFrame = requestAnimationFrame(syncGlyphScroll);
  }
  input.addEventListener('scroll', syncGlyphScroll); input.addEventListener('select', syncGlyphScroll);
  input.addEventListener('keyup', syncGlyphScroll);
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; paintGlyphs(); });
  const glyphResize = new ResizeObserver(paintGlyphs); glyphResize.observe(input);
  const list = required<HTMLElement>('.hub-results');
  const content = required<HTMLElement>('.hub-view');
  const rates = required<HTMLElement>('.hub-rate-controls');
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
  const empty = required<HTMLElement>('.hub-empty');
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  let resultAnnouncement = '';
  let rows: readonly HubRow[] = [];
  let shortcutRevision = '';
  let navigationRevision = '';
  let selected: string | null = null;
  /** The query found no results yet; results that arrive for it later, e.g. from a loading source, get its initial selection. */
  let awaitingResults = false;
  const sources = new Map<HubSource, () => void>();
  const sourceEnabled = (source: HubSource) => !source.feature || ((source.feature === 'characterSwitchEnabled' || !!window.gwToolsSettings?.().gwonmacTools) && !!window.gwToolsSettings?.()[source.feature]);
  type RowScope = Readonly<{ title: string; rows: () => readonly HubRow[]; summary?: HubSummary; destination?: HubDestination; owner?: HubSource }>;
  let scope: RowScope | null = null;
  type MountedView = { title: string; mount: HubViewMount<HTMLElement>; available?: () => boolean; destination?: HubDestination; owner?: HubSource };
  let activeView: MountedView | null = null;
  /** The mounted view's footer: its named primary and secondary, or its own footer (Travel, Characters). */
  type ViewFooter = { primary: HubViewAction | null; secondary: HubViewAction | null; own: boolean };
  let viewFooter: ViewFooter | null = null;
  let viewRunning = false;
  let viewArming: { label: string; arming: ReturnType<typeof armConfirmation> } | null = null;
  let disposeView: (() => void) | null = null;
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
      for (const attribute of ['id', 'data-character-key', 'data-section', 'data-setting-label', 'aria-label']) {
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
  /** The search names what it searches, as placeholder and accessible name alike (HUB-096). */
  const nameSearch = (page: string | null) => {
    const content = page === 'Build Library' ? 'builds' : ['Heroes', 'Accounts', 'Commands'].includes(page ?? '') ? page?.toLowerCase() : null;
    const name = content ? `Search ${content}…` : page ? `Search in ${page}…` : 'Search people, places, builds…';
    input.placeholder = name; input.setAttribute('aria-label', name);
  };
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
  const sourceLive = (owner: HubSource) => sources.has(owner) && sourceEnabled(owner);
  const pageLive = (page: Pick<Page, 'scope' | 'view'>) =>
    (!page.scope?.owner || sourceLive(page.scope.owner))
    && (!page.view?.owner || sourceLive(page.view.owner))
    && (!page.view?.available || page.view.available());
  /** Withdraw only pages whose actual source is unavailable; other drafts and searches stay. */
  function withdrawPages() {
    const live = history.filter(pageLive);
    history.splice(0, history.length, ...live);
    if (suspended && !pageLive(suspended)) suspended = history.pop() ?? null;
    if (!root.open) return;
    if (!pageLive({ scope, view: activeView })) {
      if (history.length) restoreParent(); else home();
    } else refresh();
  }

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
    if (!pageLive(page)) { if (history.length) restoreParent(); else home(); return; }
    resetView(); scope = page.scope;
    if (page.view) {
      if (page.view.available && !page.view.available()) { restoreParent(); return; }
      mountView(page.view);
    } else {
      input.value = page.query; caption.textContent = scope?.title ?? 'Home'; root.dataset.page = scope ? 'section' : 'home';
      nameSearch(scope?.title ?? null); report(''); refresh(true);
      const restored=rows.find(row=>row.id===page.selected)??(['quote:result','market:result','manual-conversion','conversion'].includes(page.selected??'')?rows.find(row=>row.group==='Calculator'):undefined);
      select(restored?.id??null); list.scrollTop = page.scroll;
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
    status.textContent = text; status.title = text;
    receiptInStatus = receipt && !!message; progressInStatus = !message && !!text;
    status.setAttribute('aria-busy', String(progressInStatus)); paintBusy();
  }
  const dispatch = (name: string, detail?: unknown) => {
    if (window.dispatchEvent(new CustomEvent(name, { cancelable: true, detail }))) {
      throw new Error('Unavailable in the current game state.');
    }
  };
  /** The command rows; `every` includes those an empty Home leaves out, so pins and phrases still resolve. */
  const commands = (every = false, query = input.value): HubRow[] => {
    const settings = window.gwToolsSettings?.();
    const tool = (id: string, title: string, detail: string, keywords: string, enabled: boolean | undefined, event: string): HubRow[] => enabled ? [{
      id, title, keywords, detail, group: 'Tools', action: id === 'storage' ? 'Open Xunlai Storage' : `Open ${title}`,
      run: () => { if (id === 'storage') { close(); window.dispatchEvent(new CustomEvent(event, { cancelable: true })); } else dispatch(event, 'show'); },
    }] : [];
    return [
      ...tool('travel', 'Travel', 'Outposts, favourites and recent places', 'outpost destination teleport tp', settings?.gwonmacTools && settings.travelPalette, 'gw:travel-toggle'),
      ...tool('trade', 'Trade Chat', 'Find offers and contact sellers', 'kamadan prices trading market trader', settings?.gwonmacTools && settings.tradeChat, 'gw:trade-toggle'),
      ...tool('whispers', 'Whispers', 'Conversations, friends and drafts', 'friends people message chat', settings?.gwonmacTools && settings.whispersEnabled, 'gw:whispers-toggle'),
      ...(settings?.characterSwitchEnabled ? [{ id: 'character', title: 'Switch Character', detail: 'Choose another character', keywords: 'relog profession characters alts', group: 'Tools', action: 'Choose character', navigate: () => dispatch('gw:character-toggle'), run: () => dispatch('gw:character-toggle') }] : []),
      ...tool('storage', 'Open Xunlai Storage', 'Open your storage chest', 'chest bank', settings?.gwonmacTools && settings.xunlaiStorage, 'gw:storage-open'),
      ...(settings?.gwonmacTools && settings.cartographyEnabled ? [{ id: 'maps', title: 'Maps', detail: 'Exploration grid, walkable terrain and compass ranges', keywords: 'grid terrain compass opacity', group: 'Tools', action: 'Adjust maps', run: () => openSettings({ section: 'Maps' }) }] : []),
      { id: 'commands', title: 'Commands', detail: 'Search words, calculator examples and keys', aliases: ['?'], keywords: 'help guide examples cheatsheet shortcuts keys', group: 'Commands', action: 'Browse commands', run: () => presenter.showRows('Commands', commandExamples) },
      { id: 'hub-preferences', title: 'Hub preferences', detail: 'Pins and exact search phrases', keywords: 'aliases vocabulary', group: 'Commands', action: 'Adjust Hub', run: () => manageHubShortcuts(presenter, shortcutStore, hubWindow.reset) },
      { id: 'settings', title: 'Settings', detail: 'Game, appearance, tools, shortcuts and maps', keywords: 'preferences graphics appearance hotkeys', group: 'Commands', action: 'Open Settings', run: () => openSettings() },
      // Launcher and the website are for a typed search; the first screen stays on the game (HUB-185).
      ...(!every && !query.trim() ? [] : [
        { id: 'launcher', title: 'Show Launcher', detail: 'Accounts, updates and game files', keywords: 'launcher administration', group: 'Commands', action: 'Show Launcher', run: async () => { await window.gwNative.app.showLauncher(); close(); } },
        { id: 'help', title: 'Project website', detail: 'Documentation and latest changes', keywords: 'help documentation', group: 'Commands', action: 'Open website', run: async () => { await window.gwNative.app.openExternal('github'); close(); } },
      ]),
      ...(!every && !query.trim() ? [] : [
        // Call Target stays on its own shortcut: it acts only while the game has focus (HUB-133).
        // Resign's row comes from its owner, with its refusal before Enter (resign.ts).
        // Quit or Reload opens the account's confirmation sheet, never a direct quit (HUB-001).
        // The sheet waits for the press that asked for it, so its repeat or trailing click never answers it.
        { id: 'reload', title: 'Quit or Reload Game…', detail: 'Opens confirmation for this account', keywords: 'restart reconnect', group: 'Commands', action: 'Review options', run: async () => { close(); await window.gwSurfaces.afterPress(); await window.gwNative.app.showQuitOrReload(); } },
        // Settings are found by their own words and open with their control focused (HUB-063).
        // They follow the commands, so a command's own word keeps its row first.
        ...(normaliseHubQuery(query).length < 3 ? [] : FINDABLE_SETTINGS).filter(setting => !setting.shown || (settings && setting.shown(settings))).map(setting => ({ id: `setting:${setting.label}`, title: setting.label, detail: `Settings › ${setting.section}`, keywords: `setting ${setting.keywords ?? ''}`, group: 'Settings', action: 'Open setting', run: () => openSettings({ section: setting.section, control: setting.label }) })),
      ]),
    ];
  };
  const shortcuts = () => [...(window.gwToolsSettings?.().hubShortcuts ?? []), ...[...sources.keys()].filter(sourceEnabled).flatMap(source => source.shortcuts?.get() ?? [])];
  const lookup = (id: string): HubRow | undefined => [...sources.keys()].filter(sourceEnabled).map(source => source.lookup?.(id)).find(Boolean)
    ?? commands(true).find(row => row.id === id);
  /**
   * The other result a root search for this phrase already finds by its exact name or alias. A
   * search phrase equal to it would hide it or make both ambiguous, so the editor refuses it (HUB-062).
   */
  function exactlyNamed(phrase: string, id: string): HubRow | undefined {
    const found = [...[...sources.keys()].filter(sourceEnabled).flatMap(source => source.search(phrase)), ...commands(true, phrase)];
    return found.find(row => row.id !== id && hubMatch(row.title, phrase, row.aliases) === 'exact');
  }
  const shortcutStore = { get: () => shortcuts(), lookup, save: saveShortcuts, exactlyNamed };
  async function saveShortcuts(value: readonly HubShortcut[]) {
    const privateEntries = value.filter(entry => isLibraryHubShortcut(entry.id));
    const globalEntries = value.filter(entry => !isLibraryHubShortcut(entry.id));
    if (!isHubShortcuts(privateEntries) || !isHubShortcuts(globalEntries)) throw new Error('Invalid Hub shortcuts');
    const owner = [...sources.keys()].find(source => sourceEnabled(source) && source.shortcuts);
    if (owner?.shortcuts && JSON.stringify(privateEntries) !== JSON.stringify(owner.shortcuts.get())) await owner.shortcuts.save(privateEntries);
    else if (privateEntries.length && !owner) throw new Error('Build Library is unavailable.');
    if (JSON.stringify(globalEntries) !== JSON.stringify(window.gwToolsSettings?.().hubShortcuts ?? [])) await window.gwNative.settings.set({ hubShortcuts: globalEntries });
    refresh();
  }
  /**
   * The Commands page is the Hub's cheatsheet: search words with a place to type, calculator
   * examples, and the keys (HUB-093, HUB-094). An example only fills the search; nothing runs.
   */
  function commandExamples(): HubRow[] {
    const enabled = new Set(commands(true).map(row => row.id));
    if (lookup('builds')) enabled.add('builds');
    const example = (group: string, tool: string, title: string, fill: string, detail: string) => ({ group, tool, title, fill, detail });
    const examples = [
      example('Places', 'travel', 'travel <place>', 'travel ', 'Find an outpost by name or alias'),
      example('Characters', 'character', 'char <name>', 'char ', 'Find one of your characters'),
      example('Builds', 'builds', 'build <name or profession>', 'build ', 'Browse saved builds; build mo lists Monk builds'),
      example('Builds', 'builds', 'team <name>', 'team ', 'Find a saved team'),
      example('Builds', 'builds', 'build folder:<folder> <name>', 'build folder:', 'Builds in a folder and its subfolders; quotes keep spaces'),
      example('Builds', 'builds', 'build Mo/Me', 'build Mo/Me', 'An exact profession pair'),
      example('People', 'whispers', 'whisper <name>', 'whisper ', 'Write to a person; nothing is sent until you send it'),
      example('People', 'whispers', 'invite <name>', 'invite ', 'Invite a person to your party from an outpost'),
      example('Trade', 'trade', 'trade <item>', 'trade ', 'Find offers or a seller in Trade Chat'),
      example('Accounts', '', 'acc <name>', 'acc ', 'Choose how to open a saved account'),
      example('Calculate', '', '1p in g', '1p in g', 'Platinum to gold'),
      example('Calculate', 'trade', '10e in p', '10e in p', 'Ectos at recent Kamadan prices'),
      example('Calculate', '', '2 * 250 + 75', '2 * 250 + 75', 'Plain arithmetic'),
      example('Calculate', '', 'titles', 'titles', 'Plan title points'),
    ];
    const rows: HubRow[] = examples.filter(entry => !entry.tool || enabled.has(entry.tool)).map((entry, index) => ({ id: `example:${index}`, title: entry.title, detail: entry.detail, group: entry.group, action: `Fill search with ${entry.title}`, searchQuery: entry.fill, run() {} }));
    // Keys: a tool's shortcut can change in Settings; the Hub's own keys are fixed.
    const bindings = resolveShortcuts(window.gwToolsSettings?.().shortcutOverrides ?? {});
    const keys = (action: ShortcutAction) => shortcutKeycaps(bindings[action]).map(cap => cap.label).join('') || 'Not set';
    const toolKeys: [string, ShortcutAction, string][] = [['travel', 'travel.open', 'Travel'], ['character', 'character.switch', 'Switch Character'], ['builds', 'tools.toggle', 'Build Library'], ['trade', 'trade.toggle', 'Trade Chat'], ['whispers', 'whispers.toggle', 'Whispers']];
    rows.push(...toolKeys.filter(([tool]) => enabled.has(tool)).map(([tool, action, name]) => ({ id: `key:${tool}`, title: name, detail: keys(action), group: 'Keys & shortcuts', action: 'Change shortcut', run: () => openSettings({ section: 'Shortcuts' as const }) })));
    for (const [id, name, detail] of [['actions', 'Actions for the selected row', '⌘J'], ['back', 'Back', '⌘⌫'], ['escape', 'Clear, back, then close', '⎋'], ['open', 'Open a row with a page', '→']] as const)
      rows.push({ id: `key:${id}`, title: name, detail, group: 'Keys & shortcuts', action: 'Fixed key', unavailable: 'The Hub’s own keys do not change.', run() {} });
    return rows;
  }
  /** Settings, optionally at one section with one control focused (search, the memory warning). */
  function openSettings(focus?: HubSettingsFocus) {
    direct('settings', () => openHubSettings(presenter, focus));
    // A Settings page that was already open, suspended or lower in the path shows the target too.
    if (focus) focusHubSetting(focus);
  }
  function select(id: string | null, scroll = false) {
    const previous = list.querySelector<HTMLElement>('[aria-selected="true"]');
    const next = id === null ? null : list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (previous !== next) {
      previous?.setAttribute('aria-selected', 'false');
      next?.setAttribute('aria-selected', 'true');
    }
    selected = id;
    if (next) {
      if (input.getAttribute('aria-activedescendant') !== next.id) input.setAttribute('aria-activedescendant', next.id);
      if (scroll) next.scrollIntoView({ block: 'nearest' });
    }
    const row = rows.find(row => row.id === id);
    rates.hidden = !row?.quoteBasis || !!disposeView;
    // A card that vanished under a focused Price basis hands the keyboard back to search (HUB-223).
    if (rates.hidden && rates.contains(document.activeElement)) focusResult();
    if (row?.quoteBasis) {
      if (next && rates.parentElement !== next) next.append(rates);
      const basis = row.quoteBasis;
      let picker = rates.querySelector('select');
      if (!picker) { const label = document.createElement('label'); label.textContent = 'Price basis'; picker = document.createElement('select'); picker.className = 'ui-select'; picker.setAttribute('aria-label', 'Price basis'); label.append(picker); rates.replaceChildren(label); }
      const choices = JSON.stringify(basis.options);
      if (picker.dataset.choices !== choices) { picker.replaceChildren(); for (const choice of basis.options) { const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; picker.append(option); } picker.dataset.choices = choices; }
      picker.value = basis.value;
      picker.onchange = () => basis.choose(picker.value);
      let details = rates.querySelector('button');
      if (!details) { details = document.createElement('button'); details.className = 'ui-button'; details.textContent = 'Details'; rates.append(details); }
      details.textContent = row.actionsLabel === 'Refresh quotes' ? 'Refresh quotes' : 'Details';
      details.onclick = () => rows.find(item => item.id === selected)?.actions?.();
    }

    if (!row) input.removeAttribute('aria-activedescendant');
    const preview = required<HTMLElement>('.hub-preview');
    preview.textContent = row?.preview ?? ''; preview.hidden = !row?.preview || !!disposeView;
    // A row action that opened a view ends here: the view names the footer now.
    if (viewFooter) { paintViewFooter(); return; }
    // A running action keeps the footer: it names what runs, disabled, until it ends (HUB-083).
    const working = busy() ? running : null;
    primaryText(working ? working.label : row ? row.action : 'Select a result', !working ? row?.conversion?.iconTo : undefined);
    if (row && !working) { const key = document.createElement('kbd'); key.className = 'ui-kbd'; key.textContent = '↵'; primary.append(key); }
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
  function primaryText(label: string, icon?: string) {
    const text = document.createElement('span'); text.className = 'hub-primary-label'; text.textContent = label;
    primary.replaceChildren(text); if (icon) { const art = document.createElement('img'); art.src = icon; art.alt = ''; art.className = 'hub-primary-art'; art.onerror = () => art.remove(); primary.prepend(art); } primary.title = label;
  }
  /** A footer slot's text and, when it has one, its keys; the name stays the text, the keys are its shortcut. */
  function slotLabel(button: HTMLButtonElement, text: string, keys: readonly string[] = []) {
    button.replaceChildren(document.createTextNode(text));
    for (const cap of keys) { const key = document.createElement('kbd'); key.className = 'ui-kbd'; key.textContent = cap; key.setAttribute('aria-hidden', 'true'); button.append(key); }
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
    keys.push([['⎋'], !viewFooter && input.value ? 'Clear' : history.length ? 'Back' : 'Close']);
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
    if (viewFooter.primary && !viewRunning) { const key = document.createElement('kbd'); key.className = 'ui-kbd'; key.textContent = '↵'; primary.append(key); }
    disableSlot(primary, !!action.disabled || viewRunning);
    primary.dataset.variant = action.destructive ? 'danger' : 'primary';
    if (!action.armed) { viewArming?.arming.disarm(); viewArming = null; }
    else if (viewArming?.label !== action.label) {
      viewArming?.arming.disarm(); viewArming = { label: action.label, arming: armConfirmation(primary) }; viewArming.arming.arm();
    }
    // A footer update invalidates menu snapshots before their actions can be activated.
    closeMenu(false);
    slotLabel(actionsButton, 'Actions', ['⌘', 'J']);
    disableSlot(actionsButton, !viewFooter.secondary || viewRunning);
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
      if (skill.elite) slot.dataset.elite = 'true';
      if (skill.changed) slot.dataset.changed = 'true';
      slot.title = `${index + 1}. ${skill.name}${skill.changed ? ' · will change' : ''}`;
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
  const pointerRow = (event: Event) => {
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>('.hub-row') : null;
    return node && list.contains(node) ? rows.find(row => row.id === node.dataset.id) : undefined;
  };
  // Delegated events always resolve the current row, including after its DOM was retained.
  list.addEventListener('pointermove', event => {
    const row = pointerRow(event); if (row && !busy() && hover.selects(event) && row.id !== selected) select(row.id);
  });
  list.addEventListener('click', event => {
    if (event.target instanceof Node && rates.contains(event.target)) return;
    const row = pointerRow(event); if (!row || busy()) return;
    // A game-changing row needs the footer or a double-click that began on this identity (D-24).
    if (event.detail <= 1) { pressed = row.id; hover.hold(); select(row.id); focusResult(); if (!row.consequential) void run(); }
    else if (event.detail === 2 && row.consequential && pressed === row.id && selected === row.id) void run();
  });
  list.addEventListener('contextmenu', event => {
    if (event.target instanceof Node && rates.contains(event.target)) return;
    const row = pointerRow(event); if (!row) return;
    event.preventDefault(); if (busy()) return;
    hover.hold(); select(row.id); focusResult(); openMenu();
  });
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
    lifecycle.title = lifecycle.textContent; lifecycle.hidden = !lifecycle.textContent;
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
    scopeLabel.hidden = !!scope || !query.scope || !!disposeView || commands(true).some(row => normaliseHubQuery(row.title) === normaliseHubQuery(input.value));
    // The page title leads, so a screen reader that lands in search after Back hears where it is.
    input.setAttribute('aria-description', `${currentTitle}: ${scope ? 'search actions' : query.scope ? `search ${query.scope}` : 'search tools or use a command example'}`);
    const hint = required<HTMLElement>('.hub-hint');
    const example = commandExamples().find(row => normaliseHubQuery(row.title).startsWith(`${normaliseHubQuery(input.value)} `));
    hint.textContent = !scope && !query.scope && input.value.trim() && example ? `Try “${example.title}” · ${example.detail}` : '';
    hint.title = hint.textContent; hint.hidden = !hint.textContent || !!disposeView;
  }
  let refreshFrame = 0;
  function scheduleRefresh() {
    if (!root.open || refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => { refreshFrame = 0; refresh(); });
  }
  function refresh(reset = false) {
    // An immediate query or opening already consumes all facts queued by source notifications.
    cancelAnimationFrame(refreshFrame); refreshFrame = 0;
    paintGlyphs();
    if (!root.open) return;
    // A mounted view keeps its header facts current, e.g. where the player is.
    if (disposeView) { paintNavigation(); return; }
    if (reset) hover.release();
    paintNavigation();
    const previousRows = rows;
    const tradeQuery = parseHubQuery(input.value);
    const tradeRows: HubRow[] = tradeQuery.scope === "trade" && tradeQuery.term && window.gwToolsSettings?.().gwonmacTools && window.gwToolsSettings?.().tradeChat
      // The player's own words, in the market Trade has open; `trade:` gives the row Trade's icon (HUB-124).
      ? [{ id: "trade:query", title: `Search Trade for ${tradeQuery.text}`, detail: "Offers and character names", group: "Tools", action: "Search Trade", run: () => dispatch("gw:trade-toggle", { query: tradeQuery.text }) }] : [];
    const extra = scope ? scope.rows() : [...sources.keys()].filter(sourceEnabled).flatMap(source => source.search(input.value)).concat(tradeRows);
    const parsed = parseHubQuery(input.value);
    // A phrase saved before its words joined the grammar stays stored but no longer matches.
    const saved = shortcuts().filter(entry => !parsed.term ? entry.pinned : entry.phrase === parsed.term && !hubPhraseReserved(entry.phrase))
      .filter(entry => !parsed.scope || entry.id.startsWith(`${parsed.scope === 'travel' ? 'place' : parsed.scope}:`));
    const savedRows = saved.flatMap(entry => { const row = lookup(entry.id); return row ? [{ ...row, group: parsed.term ? row.group : 'Pinned' }] : []; });
    const ids = new Set([...extra, ...savedRows].map(row => row.id));
    rows = scope ? matchHubRows(extra, input.value) : [...savedRows, ...extra.filter(row => !savedRows.some(saved => saved.id === row.id)), ...(parsed.term && parsed.scope ? commands().filter(row => !ids.has(row.id) && normaliseHubQuery(row.title) === normaliseHubQuery(input.value)) : matchHubRows(commands().filter(row => !ids.has(row.id)), input.value))];
    // A typed root search orders sections by their best answer, then by the usual group order,
    // and rows by the same tier (HUB-008, HUB-058). A saved phrase is the best answer of all;
    // the calculator's card answers its own grammar. Scoped lists keep their source's order.
    const phraseIds = new Set(parsed.term ? savedRows.map(row => row.id) : []);
    const ranked = !scope && !parsed.scope && !!parsed.term;
    const tierOf = (row: HubRow) => phraseIds.has(row.id) ? -1 : row.conversion || row.group === 'Calculator' ? 0 : hubTier(row, parsed.term) ?? 3;
    const best = new Map<string, number>();
    if (ranked) for (const row of rows) best.set(row.group, Math.min(best.get(row.group) ?? Infinity, tierOf(row)));
    const groups = ["Pinned", "Calculator", "Teams", "Folders", "Builds", "Targets", "Current build", "Accounts", "Characters", "In your party", "Unlocked heroes", "Heroes", "People", "Places", "Continue", "Tools", "Commands", "Settings", "Sources", "Trade", "Calculate", "Keys & shortcuts"];
    const groupIndex = (group: string) => { const index = groups.indexOf(group); return index < 0 ? groups.length : index; };
    // Keep everyday game actions ahead of account management, independent of provider order.
    const tools = ['travel', 'character', 'whispers', 'builds', 'trade', 'storage', 'maps', 'accounts'];
    const priority = (row: HubRow) => { if (scope || row.group !== 'Tools') return 0; const index = tools.indexOf(row.id); return index < 0 ? tools.length : index; };
    rows = [...rows].sort((a, b) => (ranked ? best.get(a.group)! - best.get(b.group)! : 0) || groupIndex(a.group) - groupIndex(b.group)
      || (ranked ? tierOf(a) - tierOf(b) : 0) || priority(a) - priority(b));
    const resultCount = `${rows.length} result${rows.length === 1 ? '' : 's'}`;
    const message = !scope && !input.value.trim() ? '' : rows.length ? resultCount : 'No matches';
    count.textContent = message === 'No matches' ? '' : message;
    empty.hidden = rows.length > 0; list.hidden = !rows.length;
    input.setAttribute('aria-expanded', String(rows.length > 0));
    if (reset || message !== resultAnnouncement) {
      clearTimeout(announceTimer); resultAnnouncement = message;
      if (message) announceTimer = setTimeout(() => {
        if (root.open && !disposeView && announcer.textContent !== message) announcer.textContent = message;
      }, 500);
    }
    const bindings = resolveShortcuts(window.gwToolsSettings?.().shortcutOverrides ?? {});
    const nextShortcutRevision = JSON.stringify(bindings);
    const shortcutsChanged = shortcutRevision !== nextShortcutRevision;
    shortcutRevision = nextShortcutRevision;
    // Keep mounted options steady when an observer only advances its sequence.
    // Actions still read the newly derived rows, so no stale closure can execute.
    const samePaint = (row: HubRow, previous: HubRow | undefined) => previous && row.id === previous.id && row.title === previous.title
      && row.detail === previous.detail && row.group === previous.group && row.icon === previous.icon
      && row.action === previous.action && row.destructive === previous.destructive && row.unavailable === previous.unavailable
      && row.readOnly === previous.readOnly && !!row.navigate === !!previous.navigate && row.preview === previous.preview
      && row.folder === previous.folder && row.attributeStatus === previous.attributeStatus
      && JSON.stringify([row.skills, row.attributes, row.professions, row.conversion]) === JSON.stringify([previous.skills, previous.attributes, previous.professions, previous.conversion]);
    if (!reset && !shortcutsChanged && rows.length === previousRows.length && rows.every((row, index) => samePaint(row, previousRows[index]))) { select(selected); return; }
    // The current list is the DOM source; retain only rows whose painted facts still match.
    const previousById = new Map(previousRows.map(row => [row.id, row]));
    const mounted = new Map([...list.querySelectorAll<HTMLElement>('.hub-row')].map(node => [node.dataset.id, node]));
    const focusedRate = rates.contains(document.activeElement) ? document.activeElement : null;
    list.before(rates);
    const results = document.createDocumentFragment();
    let group: string | undefined;
    let section = list;
    rows.forEach((row, index) => {
      if (row.group !== group) {
        group = row.group;
        const heading = document.createElement('div');
        heading.className = 'hub-group'; heading.setAttribute('role', 'presentation'); heading.textContent = group;
        heading.id = `hub-group-${index}`;
        section = document.createElement('div'); section.setAttribute('role', 'group'); section.setAttribute('aria-labelledby', heading.id);
        section.append(heading); results.append(section);
      }
      const compact = !!row.skills && !scope && !input.value.trim();
      const retained = !shortcutsChanged && mounted.get(row.id)?.classList.contains('hub-build-compact') === compact && samePaint(row, previousById.get(row.id)) ? mounted.get(row.id) : undefined;
      if (retained) { retained.id = `hub-result-${index}`; section.append(retained); return; }
      const option = document.createElement('div');
      option.id = `hub-result-${index}`; option.dataset.id = row.id; option.className = 'hub-row';
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.setAttribute('aria-disabled', String(!!row.unavailable));
      if (row.skills) option.setAttribute('aria-label', row.title);
      const description = [row.skills ? row.unavailable ?? row.detail : '',
        row.professions?.map(profession => profession.name).join(' / '),
        row.skills ? `Skills: ${row.skills.map(skill => skill.name).join(', ')}` : '',
        row.navigate ? 'Right Arrow opens the child page.' : ''].filter(Boolean).join('. ');
      if (description) option.setAttribute('aria-description', description);
      if (row.destructive) option.dataset.destructive = 'true';
      if (row.readOnly) option.dataset.readOnly = 'true';
      const title = document.createElement('span'); title.className = 'hub-title'; title.textContent = row.title;
      appendProfessionLabel(title, row.professions);
      appendFolderLabel(title, row.folder);
      const detail = document.createElement('span'); detail.className = 'hub-detail'; detail.textContent = row.unavailable ?? row.detail;
      const arrow = document.createElement('span'); arrow.className = 'hub-row-arrow'; arrow.textContent = '↵'; arrow.setAttribute('aria-hidden', 'true');
      if (row.conversion) {
        option.classList.add('hub-conversion');
        option.setAttribute('aria-label', `${row.conversion.input} equals ${row.title}. ${row.detail}`);
        const source = document.createElement('strong'); source.className = 'hub-conversion-input'; source.textContent = row.conversion.input;
        const from = document.createElement('span'); from.className = 'hub-currency hub-currency-from'; from.textContent = row.conversion.from;
        const to = document.createElement('span'); to.className = 'hub-currency hub-currency-to'; to.textContent = row.conversion.to;
        arrow.textContent = '→'; option.append(title, detail, source, from, to, arrow);
        for (const [url,side] of [[row.conversion.iconFrom,'from'],[row.conversion.iconTo,'to']] as const) { if (!url) continue; const art=document.createElement('img'); art.onerror=() => art.remove(); art.src=url; art.alt=''; art.className=`hub-conversion-art hub-conversion-art-${side}`; option.append(art); }
      } else {
        const type = document.createElement('span'); type.className = 'hub-row-type';
        const shortcutActions: Record<string, ShortcutAction> = { travel: 'travel.open', character: 'character.switch', builds: 'tools.toggle', trade: 'trade.toggle', whispers: 'whispers.toggle', storage: 'storage.open' };
        const keyRow = row.id.startsWith('key:');
        const shortcut = shortcutActions[keyRow ? row.id.slice(4) : row.id];
        if (keyRow && !row.unavailable && row.detail !== 'Not set') detail.textContent = '';
        if (keyRow && !shortcut) for (const label of row.detail) {
          const cap = document.createElement('kbd'); cap.className = 'ui-kbd'; cap.textContent = label; type.append(cap);
        }
        if (shortcut) for (const key of shortcutKeycaps(bindings[shortcut])) {
          const cap = document.createElement('kbd'); cap.className = 'ui-kbd'; cap.textContent = key.label; cap.setAttribute('aria-label', key.name); type.append(cap);
        }
        option.append(row.professions?.length ? renderProfessions(row.professions) : hubIcon(document, row), title, detail, type);
        if (row.navigate) { const child = document.createElement('span'); child.className = 'hub-child-cue'; child.textContent = '›'; child.setAttribute('aria-hidden', 'true'); type.append(child); }
        detail.hidden = !detail.textContent;
        if (row.skills) {
          option.classList.add('hub-build-row');
          if (!scope && !input.value.trim()) option.classList.add('hub-build-compact');
          option.append(renderBuildInfo(row));
        }
      }
      section.append(option);
    });
    list.replaceChildren(results);
    // Two rows with the typed name are a tie, so nothing is chosen for the player; a saved phrase
    // is their own name for one row and always wins. Pins on an empty Home are no tie (HUB-060).
    // A query that is a row's whole name, `trade chat` included, answers with that row (HUB-008).
    const phraseHit = rows.find(row => phraseIds.has(row.id)) ?? (parsed.scope ? rows.find(row => normaliseHubQuery(row.title) === normaliseHubQuery(input.value)) : undefined);
    const exactCount = parsed.term ? rows.filter(row => hubTier(row, parsed.term) === 0).length : 0;
    const prior = previousRows.find(row => row.id === selected);
    const revised = prior && rows.find(row => row.id === selected)?.preview !== prior.preview;
    // A bare scope (`travel `) lists without a term, so nothing in it is an explicit result:
    // Enter never travels, invites, applies, switches or opens an account on a guess.
    // A fresh Home in an explorable area never starts on a row that leaves it (D-13).
    const initial = !input.value.trim() ? rows.find(row => row.preferred && !row.unavailable) ?? rows.find(row => row.preferred !== false && !row.unavailable && !row.leavesArea) ?? rows.find(row => row.preferred !== false && !row.leavesArea)
      : !scope && parsed.scope && !parsed.term ? rows.find(row => !row.consequential && !row.unavailable)
      // A typed query starts on its best available answer, never on a disabled one (HUB-056).
      : phraseHit ?? rows.find(row => !row.unavailable) ?? rows[0];
    const settling = reset || (awaitingResults && selected === null && rows.length > 0);
    if (settling) awaitingResults = !rows.length;
    // A placeholder row that goes away (a loading or state row) hands its selection to what
    // replaced it, as a fresh query would, so Enter acts without another key (HUB-232).
    const replacedPlaceholder = !!prior?.unavailable && !rows.some(row => row.id === prior.id);
    // Clear only this loading refusal when its answer settles; unrelated failures stay.
    if (prior?.unavailable && status.textContent === prior.unavailable && rows.some(row => row.conversion && !row.unavailable)) report('');
    select((prior?.id === 'quote-state' || prior?.id === 'market-state') && !!rows[0]?.conversion ? rows[0].id : settling || replacedPlaceholder ? exactCount > 1 && !phraseHit ? null : initial?.id ?? null : !revised && rows.some(row => row.id === selected) ? selected : null);
    if (focusedRate instanceof HTMLElement && !rates.hidden && rates.isConnected) focusedRate.focus({ preventScroll: true });
    if (!settling && prior && !replacedPlaceholder && !rows.some(row => row.id === prior.id) && !receiptInStatus) report('The previous selection is no longer available. Choose a result.');

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
      progress: message => { progress = { owner: token, message }; if (live() || progressInStatus || !status.textContent) report(''); },
      done: receipt => {
        if (live() || (!root.open && suspended && suspendedSession === started)) close(receipt);
        else if (receipt) notify(receipt);
      },
      fail: error => {
        // A step the player declined, e.g. Stay here on "Leave this area?", is no failure.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message = error instanceof Error ? error.message : 'The action could not complete. Try again.';
        if (live()) report(message); else notify(message, 'failed');
      },
      // An action that ended without a receipt, e.g. one whose view shows its own outcome, never leaves its progress behind.
      end: () => { if (progress?.owner !== token) return; progress = null; if (progressInStatus) report(''); },
    };
  }
  async function run(action?: HubRow) {
    const row = action ?? rows.find(row => row.id === selected);
    if (!row) return;
    // One action at a time per page: Enter names the running one instead of starting another.
    if (busy()) { report(running!.again); return; }
    if (row.unavailable) { report(row.unavailable); return; }
    const task = startTask();
    const mine = { session, label: row.pending?.label ?? row.action, again: row.pending?.again ?? `${row.action} is still running.` };
    running = mine; select(selected); report(''); if (row.pending) task.progress(row.pending.label);
    try {
      if(row.searchQuery!==undefined){home();input.value=row.searchQuery;refresh(true);input.focus();const argument=parseHubQuery(input.value).scope?input.value.indexOf(' ')+1:0;input.setSelectionRange(argument,input.value.length);}
      else await row.run(task);
    }
    catch (error) { task.fail(error); }
    finally { task.end(); if (running === mine) { running = null; if (root.open) select(selected); } }
  }
  function resetView() {
    endSession(); restoringFocus?.disconnect(); restoringFocus = null; keepDrafts(); pressed = null; modal.pageChanged(); closeMenu(false);
    disposeView?.(); disposeView = null; activeView = null; content.replaceChildren(); content.hidden = true;
    viewFooter = null; viewRunning = false; actionFocus = null; viewArming?.arming.disarm(); viewArming = null;
    search.hidden = false; list.hidden = false; footer.hidden = false;
  }
  function home() {
    history.length = 0; resetView(); scope = null; input.value = restoreQuery;
    root.dataset.page = 'home'; caption.textContent = 'Home'; nameSearch(null); report(''); refresh(true); input.focus();
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
    cancelAnimationFrame(refreshFrame); refreshFrame = 0;
    clearTimeout(announceTimer); resultAnnouncement = '';
    rows = []; list.replaceChildren(); empty.hidden = true; input.removeAttribute('aria-activedescendant');
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
    clearTimeout(receiptTimer); receiptAnnouncement.textContent = message; receipt.textContent = message; receipt.hidden = false; receiptTimer = setTimeout(() => { receipt.hidePopover(); receipt.hidden = true; receiptAnnouncement.textContent = ''; }, 8000);
    receipt.dataset.outcome = outcome ?? 'done'; receipt.dataset.tone = outcome === 'failed' ? 'error' : 'success';
    if (frame?.width) {
      receipt.style.left = `${frame.left + frame.width / 2}px`; receipt.style.bottom = `${Math.max(8, window.innerHeight - frame.bottom + 12)}px`;
      receipt.style.maxWidth = `${Math.max(0, frame.width - 24)}px`;
    }
    // A passive top-layer receipt stays above popouts without taking focus or intercepting game input.
    receipt.showPopover();
  }
  function suspend() {
    if (!root.open) return;
    frame = required<HTMLElement>('.hub-panel').getBoundingClientRect();
    suspended = capture(); suspendedAt = Date.now(); suspendedSession = session; endSession(); modal.close();
    for (const source of sources.keys()) source.setVisible(false);
  }
  const resumable = () => suspended !== null && pageLive(suspended) && Date.now() - suspendedAt <= RESUME_MS;
  const pageDestination = (page: Pick<Page, 'scope' | 'view'>) => page.view ? page.view.destination : page.scope?.destination;
  /** Whether the next opening resumes a suspended page whose path holds this destination. */
  const suspendedOn = (destination: HubDestination) => !root.open && resumable() && [...history, suspended!].some(page => pageDestination(page) === destination);
  /**
   * Resumes a suspended page. Suspending hides the Hub without unmounting it, so the page is
   * still mounted and keeps its drafts, its confirmation and its view state; only its facts
   * refresh (HUB-050). A resumed Hub search is selected, so typing starts a new search (D-11).
   */
  function resumePage(page: Page) {
    if (!pageLive(page)) { if (history.length) restoreParent(); else home(); return; }
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
    clearTimeout(receiptTimer); receipt.hidePopover(); receipt.hidden = true; receiptAnnouncement.textContent = '';
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
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      // Only a plain Enter runs the named primary; a modified Enter is never a second route to it.
      event.preventDefault(); if (!event.repeat) void run();
    }
  });
  // A press on a result keeps the keyboard in search.
  list.addEventListener('mousedown', event => {
    if (!(event.target instanceof Node && rates.contains(event.target))) event.preventDefault();
  });
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
    // ⌘↵ submits a form from any of its fields: the view's named primary, as Enter in a text field (HUB-152).
    if (event.key === 'Enter' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.defaultPrevented && !event.isComposing
      && viewFooter?.primary && event.target instanceof HTMLElement && content.contains(event.target) && event.target.closest('form')) {
      event.preventDefault(); if (!event.repeat) void runViewAction(viewFooter.primary, event); return;
    }
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
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && viewFooter?.primary && content.contains(target)
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
        if (!build.skills) continue;
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
  type MenuEntry = Readonly<{ label: string; section: 'Primary' | 'Details' | 'Personalize'; keys?: readonly string[]; destructive?: boolean; disabled?: boolean; reason?: string; run(): void | Promise<void> }>;
  /**
   * A row's Actions, verb first: its primary (↵), a second way into it (build details, rates),
   * then pinning and a search phrase for rows the Hub can keep (HUB-040, HUB-184).
   */
  function menuEntries(row: HubRow): MenuEntry[] {
    const entries: MenuEntry[] = [{ label: row.action, section: 'Primary', keys: ['↵'], ...(row.destructive ? { destructive: true } : {}), disabled: !!row.unavailable, ...(row.unavailable ? { reason: row.unavailable } : {}), run: () => run() }];
    for (const action of row.menuActions?.() ?? []) entries.push({
      label: action.action, section: 'Details', disabled: !!action.unavailable,
      ...(action.unavailable ? { reason: action.unavailable } : {}),
      ...(action.destructive ? { destructive: true } : {}),
      run: () => {
        if (selected !== row.id || !rows.some(current => current.id === row.id)) { report('This person is no longer selected. Choose a result.'); return; }
        return run(action);
      },
    });
    if (row.skills || scope?.summary?.skills) entries.push({ label: 'Show build details', section: 'Details', run: () => showBuildDetails(row) });
    else if (!row.menuActions && row.actions && row.actionsLabel) entries.push({ label: row.actionsLabel, section: 'Details', run: () => row.actions?.() });
    if (row.workspace) entries.push({ label: 'Open in Build Library', section: 'Details', run: row.workspace });
    if (isHubShortcuts([{ id: row.id, phrase: '', pinned: false }]) && lookup(row.id)) {
      const pinned = shortcuts().some(entry => entry.id === row.id && entry.pinned);
      entries.push({ label: pinned ? 'Unpin from Hub' : 'Pin to Hub', section: 'Personalize', run: async () => {
        const task = startTask();
        const entries = shortcuts(); const old = entries.find(entry => entry.id === row.id);
        const edited = { id: row.id, phrase: old?.phrase ?? '', pinned: !old?.pinned };
        try { await saveShortcuts(old ? entries.map(entry => entry.id === row.id ? edited : entry) : [...entries, edited]); const receipt = pinned ? `Unpinned ${row.title}.` : `Pinned ${row.title}.`; if (task.live()) report(receipt); else task.done(receipt); }
        catch { task.fail(new Error('Could not update the pin. Try again.')); }
      } });
      entries.push({ label: 'Set search phrase…', section: 'Personalize', run: () => editHubShortcut(presenter, row, shortcutStore, () => !!lookup(row.id)) });
    }
    return entries;
  }
  /** A view names its actions through the same menu; its live footer owns activation and confirmation. */
  function viewMenuEntries(state: ViewFooter): MenuEntry[] {
    const entry = (action: HubViewAction, section: MenuEntry['section'], primary: boolean): MenuEntry => ({
      label: action.label, section, disabled: !!action.disabled,
      ...(primary && state.primary ? { keys: ['↵'] } : {}),
      ...(action.destructive ? { destructive: true } : {}),
      run: () => { if (viewFooter === state) return runViewAction(action); },
    });
    return [entry(state.primary ?? done, 'Primary', true), ...(state.secondary ? [entry(state.secondary, 'Details', false)] : [])];
  }
  /** Opens the current page's Actions over the footer; the page, query and selection stay. */
  function openMenu() {
    const row = rows.find(row => row.id === selected);
    if (busy() || viewRunning || (!viewFooter && !row)) return;
    const entries = viewFooter ? viewMenuEntries(viewFooter) : menuEntries(row!);
    if (entries.length < 2) return;
    menu.replaceChildren(); menuRow = viewFooter ? null : row!.id;
    let section = '';
    for (const entry of entries) {
      if (entry.section !== section) { section = entry.section; const heading = document.createElement('p'); heading.className = 'hub-menu-section'; heading.setAttribute('role', 'presentation'); heading.textContent = section; menu.append(heading); }
      const item = document.createElement('button'); item.type = 'button'; item.className = 'hub-menu-item'; item.setAttribute('role', 'menuitem'); item.disabled = !!entry.disabled;
      if (entry.reason) { item.title = entry.reason; item.setAttribute('aria-description', entry.reason); }
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
  // Every page uses the same Actions menu.
  // A double-click's second press never toggles the menu shut or runs anything (PTR-17).
  actionsButton.onclick = event => { if (event.detail > 1) return; if (!closeMenu()) openMenu(); };
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
  const onSettings = () => {
    for (const source of sources.keys()) source.setVisible(root.open && sourceEnabled(source));
    withdrawPages();
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
    resetView(); report(''); clearTimeout(announceTimer); resultAnnouncement = ''; empty.hidden = true;
    root.dataset.page = 'section'; caption.textContent = view.title;
    required<HTMLElement>('.hub-preview').hidden = true; required<HTMLElement>('.hub-rate-controls').hidden = true; required<HTMLElement>('.hub-hint').hidden = true;
    search.hidden = true; list.hidden = true; content.hidden = false;
    activeView = view;
    const state: ViewFooter = { primary: null, secondary: null, own: false };
    viewFooter = state;
    // A disposed view's late update never repaints the next page's footer.
    const shell: HubViewFooter = {
      primary: next => { state.primary = next; if (viewFooter === state) paintViewFooter(); },
      secondary: next => { state.secondary = next; if (viewFooter === state) paintViewFooter(); },
      openActions: () => { if (viewFooter === state) openMenu(); },
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
      sources.set(next, next.subscribe(scheduleRefresh)); next.setVisible(root.open && sourceEnabled(next)); refresh();
      return () => {
        sources.get(next)?.(); sources.delete(next); next.setVisible(false);
        withdrawPages();
      };
    },
    showRows(title: string, getRows: () => readonly HubRow[], summary?: HubSummary, destination?: HubDestination, owner?: HubSource, query = '') {
      enterPage();
      resetView(); scope = { title, rows: getRows, ...(summary ? { summary } : {}), ...(destination ? { destination } : {}), ...(owner ? { owner } : {}) }; root.dataset.page = 'section'; caption.textContent = title;
      nameSearch(title); input.value = query; report(''); refresh(true); focusResult();
    },
    showView(title: string, mount: HubViewMount<HTMLElement>, available?: () => boolean, destination?: HubDestination, owner?: HubSource) {
      enterPage();
      mountView({ title, mount, ...(available ? { available } : {}), ...(destination ? { destination } : {}), ...(owner ? { owner } : {}) });
    },
    notify,
    browseBuilds() { direct('builds', () => { const row = lookup('builds'); if (row && !row.unavailable) void row.run(startTask()); else report('Build Library is unavailable.'); }); },
    resetPosition: hubWindow.reset,
    dispose() { close(); glyphResize.disconnect(); cancelAnimationFrame(glyphFrame); clearTimeout(receiptTimer); receipt.hidePopover(); receipt.remove(); receiptAnnouncement.remove(); hubWindow.dispose(); disposeFrame(); for (const unsubscribe of sources.values()) unsubscribe(); sources.clear(); modal.dispose(); root.remove(); window.removeEventListener('blur', onBlur); window.removeEventListener('gw:tools-settings', onSettings); },
  };
  presenter.attach(createHubAccounts(presenter, { get: () => window.gwNative.accounts.get(), open: request => window.gwNative.accounts.open(request), manage: () => window.gwNative.app.showLauncher() }));
  presenter.attach(createHubCalculator({
    hub: presenter,
    settings: () => window.gwToolsSettings?.().calculatorRates ?? DEFAULT_CALCULATOR_RATES,
    saveRates: async calculatorRates => { await window.gwNative.settings.set({ calculatorRates }); },
    // A copy names what it put on the clipboard in the status line (D-8); it is never silent.
    copy: async (value,label=value) => { await window.gwNative.clipboard.writeText(value); notify(`Copied “${label}”`); },
    marketEnabled: () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().tradeChat,
    market: () => 'trade' in window.gwNative ? window.gwNative.trade.getMarketRates() : Promise.reject(new Error('Rate unavailable')),
    quotes: () => 'trade' in window.gwNative ? window.gwNative.trade.getTraderQuotes() : Promise.reject(new Error('Rate unavailable')),
  }));
  return presenter;
}
export type Hub = ReturnType<typeof createHub>;
