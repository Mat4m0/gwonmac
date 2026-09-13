/**
 * Owns the Core command palette, its search focus and transient modal lifetime.
 * Optional Tools contributes local results and views without entering Core's imports.
 */
import { installHubWindow } from './hub-window.js';
import { attachClassicFrame } from '../shared/ui/frame.js';
import { resolveShortcuts, shortcutKeycaps, type ShortcutAction } from '../shared/keyboard-shortcuts.js';
import { openHubSettings } from "./hub-settings.js";
import { createHubAccounts } from './hub-accounts.js';
import { hubIcon } from "./hub-icons.js";
import { openHubMaps } from './hub-maps.js';
import { editHubShortcut, manageHubShortcuts } from './hub-preferences.js';
import { isHubShortcuts, type HubShortcut } from '../shared/hub-preferences.js';
import { createHubCalculator } from './hub-calculator.js';
import { matchHubRows, parseHubQuery, normaliseHubQuery, type HubRow, type HubSource, type HubSummary } from '../shared/hub.js';
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
    <div class="hub-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 8 10-8 10L4 12 12 2Zm0 5v10M8 12h8"/></svg><span class="hub-scope" hidden></span><input type="text" role="combobox" aria-label="Search people, places, builds" aria-autocomplete="list" aria-controls="hub-results" aria-expanded="true" placeholder="Search people, places, builds…" autocomplete="off" spellcheck="false" maxlength="120"></div>
    <p class="hub-hint" id="hub-hint" hidden></p><div class="hub-rate-controls" hidden></div><div class="hub-results ui-scroll" id="hub-results" role="listbox" aria-label="Results"></div>
    <pre class="hub-preview ui-scroll" hidden></pre><div class="hub-view" hidden></div><p class="hub-status" role="status" hidden></p>
    <footer class="hub-footer"><button class="hub-primary ui-button" data-variant="primary"></button><span class="hub-count"></span><button class="hub-actions ui-button" data-variant="quiet">Actions</button></footer>
    <button class="ui-window-resize hub-resize" aria-label="Resize Hub" title="Drag to resize, or use arrow keys" hidden></button>
  </section>`;
  parent.append(root);
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
  const count = required<HTMLElement>('.hub-count');
  let rows: readonly HubRow[] = [];
  let shortcutRevision = '';
  let navigationRevision = '';
  let selected: string | null = null;
  const sources = new Map<HubSource, () => void>();
  const sourceEnabled = (source: HubSource) => !source.feature || ((source.feature === 'characterSwitchEnabled' || !!window.gwToolsSettings?.().gwonmacTools) && !!window.gwToolsSettings?.()[source.feature]);
  type RowScope = Readonly<{ title: string; rows: () => readonly HubRow[]; summary?: HubSummary }>;
  let scope: RowScope | null = null;
  type MountedView = { title: string; mount: (target: HTMLElement, back: () => void) => () => void; available?: () => boolean };
  let activeView: MountedView | null = null;
  let disposeView: (() => void) | null = null;
  let viewAvailable: (() => boolean) | null = null;
  let returnFromView: (() => void) | null = null;
  let restoreQuery = '';
  const history: { scope: RowScope | null; query: string; selected: string | null; scroll: number; view: MountedView | null }[] = [];
  function remember() { history.push({ scope, query: input.value, selected, scroll: list.scrollTop, view: activeView }); }
  function restoreParent() {
    const parent = history.pop();
    if (!parent) { close(); return; }
    resetView(); scope = parent.scope;
    if (parent.view && (!parent.view.available || parent.view.available())) { const view = parent.view; restoring = true; presenter.showView(view.title, view.mount, view.available); restoring = false; return; } input.value = parent.query; caption.textContent = scope?.title ?? 'Home'; backButton.hidden = !scope; root.dataset.page = scope ? 'section' : 'home';
    input.placeholder = scope ? 'Search actions…' : 'Search people, places, builds…'; report(''); refresh(true); select(parent.selected); list.scrollTop = parent.scroll; input.focus();
  }
  let restoring = false;
  let previousFocus: HTMLElement | null = null;
  let pending = false;
  let epoch = 0;
  const report = (message: string) => { status.textContent = message; status.hidden = !message; };
  const dispatch = (name: string, detail?: unknown) => {
    if (window.dispatchEvent(new CustomEvent(name, { cancelable: true, detail }))) {
      throw new Error('Unavailable in the current game state.');
    }
  };
  const handoff = (name: string, detail?: unknown) => { dispatch(name, detail); close(); };
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
      ...(settings?.characterSwitchEnabled ? [{ id: 'character', title: 'Switch Character', detail: 'Choose another character', keywords: 'relog profession', group: 'Tools', action: 'Choose character', run: () => dispatch('gw:character-toggle') }] : []),
      ...tool('storage', 'Open Xunlai Storage', 'Open your storage chest', 'chest bank', settings?.gwonmacTools && settings.xunlaiStorage, 'gw:storage-open'),
      ...(settings?.gwonmacTools && settings.cartographyEnabled ? [{ id: 'maps', title: 'Maps', detail: 'Exploration grid, walkable terrain and compass ranges', keywords: 'grid terrain compass opacity', group: 'Tools', action: 'Adjust maps', run: () => openHubMaps(presenter) }] : []),
      { id: 'hub-preferences', title: 'Hub preferences', detail: 'Pins and exact search phrases', keywords: 'aliases vocabulary', group: 'Commands', action: 'Adjust Hub', run: () => manageHubShortcuts(presenter, shortcuts, lookup, saveShortcuts, hubWindow.reset) },
      { id: 'settings', title: 'Settings', detail: 'In-game appearance, tools and shortcuts', keywords: 'preferences graphics appearance accounts hotkeys', group: 'Commands', action: 'Open Settings', run: openSettings },
      { id: 'launcher', title: 'Show Launcher', detail: 'Accounts, updates and game files', keywords: 'launcher administration', group: 'Commands', action: 'Show Launcher', run: async () => { await window.gwNative.app.showLauncher(); close(); } },
      { id: 'commands', title: 'Commands', detail: 'Examples you can edit and run', keywords: 'help guide examples', group: 'Commands', action: 'Browse examples', run: () => presenter.showRows('Commands', commandExamples) },
      { id: 'help', title: 'Project website', detail: 'Documentation and latest changes', keywords: 'help documentation', group: 'Commands', action: 'Open website', run: async () => { await window.gwNative.app.openExternal('github'); close(); } },
      ...(!input.value.trim() ? [] : [
        ...(settings?.gwonmacTools && settings.callTargetEnabled ? [{ id: 'call-target', title: 'Call Target', detail: 'Call the selected target to your party', keywords: 'ping attack party', group: 'Commands', action: 'Call target', run: () => handoff('gw:call-target') }] : []),
        { id: 'reload', title: 'Quit or Reload Game…', detail: 'Opens confirmation for this account', keywords: 'restart reconnect', group: 'Commands', action: 'Review options', run: async () => { close(); await window.gwNative.app.requestQuit(); } },
        ...(settings?.gwonmacTools && settings.resignEnabled ? [{ id: 'resign', title: 'Resign…', detail: 'Opens the existing confirmation', group: 'Commands', action: 'Review resign', run: () => { dispatch('gw:resign-show'); close(); } }] : []),
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
    const examples = [ ['trade', 'trade arms', 'Find offers or a seller'], ['travel', 'travel kamadan', 'Find an outpost'], ['character', 'char Toefte', 'Find a character by name'], ['builds', 'build monk', 'Browse saved Monk builds'], ['builds', 'team gom afk', 'Find your saved team'], ['whispers', 'whisper Romi', 'Choose a person; write before sending'], ['', '1p in g', 'Convert platinum to gold'], ['trade', '10e in p', 'Estimate ecto value'], ['', 'titles', 'Plan title points'], ['', 'acc second', 'Choose how to open a saved account'], ['builds', 'build folder:Monk monk', 'Find Monk builds in a template folder; use parent/child for subfolders'] ];
    return examples.filter(([tool]) => !tool || enabled.has(tool)).map(([, query, detail], index) => ({ id: `example:${index}`, title: query!, detail: detail!, group: 'Commands', action: 'Edit example', searchQuery: query!, run() {} }));
  }
  function openSettings() { openHubSettings(presenter); }
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
    primary.replaceChildren(document.createTextNode(row ? row.action : 'Select a result'));
    if (row) { const key = document.createElement('kbd'); key.textContent = '↵'; primary.append(key); }
    primary.disabled = !row || !!row.unavailable || pending;
    required<HTMLButtonElement>('.hub-actions').disabled = !row;
  }
  function renderSkillBar(skills: NonNullable<HubRow['skills']>) {
    const bar = document.createElement('span'); bar.className = 'hub-skill-bar';
    skills.forEach((skill, index) => {
      const slot = document.createElement('span'); slot.className = 'hub-skill';
      slot.dataset.elite = String(skill.elite); slot.title = `${index + 1}. ${skill.name}`;
      slot.setAttribute('role', 'img'); slot.setAttribute('aria-label', slot.title);
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
        chip.title = `${attribute.name} ${attribute.rank}`;
        chip.setAttribute('role', 'img'); chip.setAttribute('aria-label', chip.title);
        const rank = document.createElement('b'); rank.textContent = String(attribute.rank);
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
    const context = !scope && !disposeView && !input.value.trim()
      ? [...sources.keys()].filter(sourceEnabled).flatMap(source => source.context?.() ?? []) : [];
    required<HTMLElement>('.hub-context').textContent = context.join(' · ');
    const trail = history.map((page, index) => ({ title: page.view?.title ?? page.scope?.title ?? 'Home', index }));
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
    const destination = parent?.view?.title ?? parent?.scope?.title ?? 'Home';
    backButton.hidden = !parent;
    backButton.textContent = '←';
    backButton.title = `Back to ${destination}`;
    backButton.setAttribute('aria-description', `Return to ${destination}`);
    const actionsButton = required<HTMLButtonElement>('.hub-actions');
    actionsButton.hidden = !!scope;
    actionsButton.disabled = !selected;
    const query = parseHubQuery(input.value);
    const scopeLabel = required<HTMLElement>('.hub-scope');
    scopeLabel.textContent = query.scope ?? '';
    scopeLabel.hidden = !!scope || !query.scope || !!disposeView;
    input.setAttribute('aria-description', scope ? `Search actions for ${scope.title}` : query.scope ? `Search ${query.scope}` : 'Search tools or use a command example');
    const hint = required<HTMLElement>('.hub-hint');
    const example = commandExamples().find(row => normaliseHubQuery(row.title).startsWith(`${normaliseHubQuery(input.value)} `));
    hint.textContent = !scope && !query.scope && input.value.trim() && example ? `Try “${example.title}” · ${example.detail}` : '';
    hint.hidden = !hint.textContent || !!disposeView;
  }
  function refresh(reset = false) {
    if (!root.open || disposeView) return;
    paintNavigation();
    const previousRows = rows;
    const tradeQuery = parseHubQuery(input.value);
    const tradeRows: HubRow[] = tradeQuery.scope === "trade" && window.gwToolsSettings?.().gwonmacTools && window.gwToolsSettings?.().tradeChat
      ? [{ id: "trade-query", title: `Search Trade for ${tradeQuery.term}`, detail: "Kamadan listings", group: "Tools", action: "Search Trade", run: () => dispatch("gw:trade-toggle", { query: tradeQuery.term }) }] : [];
    const extra = scope ? scope.rows() : [...sources.keys()].filter(sourceEnabled).flatMap(source => source.search(input.value)).concat(tradeRows);
    const parsed = parseHubQuery(input.value);
    const saved = shortcuts().filter(entry => !parsed.term ? entry.pinned : entry.phrase === parsed.term)
      .filter(entry => !parsed.scope || entry.id.startsWith(`${parsed.scope}:`));
    const savedRows = saved.flatMap(entry => { const row = lookup(entry.id); return row ? [{ ...row, group: parsed.term ? row.group : 'Pinned' }] : []; });
    const ids = new Set([...extra, ...savedRows].map(row => row.id));
    rows = scope ? matchHubRows(extra, input.value) : [...savedRows, ...extra.filter(row => !savedRows.some(saved => saved.id === row.id)), ...(parseHubQuery(input.value).scope ? [] : matchHubRows(commands().filter(row => !ids.has(row.id)), input.value))];
    rows = [...rows].sort((a, b) => {
      const groups = ["Pinned", "Calculator", "Teams", "Builds", "Targets", "Current build", "Accounts", "Characters", "Heroes", "People", "Places", "Continue", "Tools", "Commands"];
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
        && row.action === previous.action && row.unavailable === previous.unavailable && row.preview === previous.preview && row.folder === previous.folder && row.attributeStatus === previous.attributeStatus && JSON.stringify([row.skills, row.attributes, row.professions]) === JSON.stringify([previous.skills, previous.attributes, previous.professions]);
    })) { select(selected); return; }
    const hadRowFocus = list.contains(document.activeElement);
    list.replaceChildren();
    let group = '';
    rows.forEach((row, index) => {
      if (row.group !== group) {
        group = row.group;
        const heading = document.createElement('div');
        heading.className = 'hub-group'; heading.setAttribute('role', 'presentation'); heading.textContent = group;
        list.append(heading);
      }
      const option = document.createElement('div'); option.tabIndex = -1;
      option.id = `hub-result-${index}`; option.dataset.id = row.id; option.className = 'hub-row';
      option.setAttribute('role', 'option'); option.setAttribute('aria-disabled', String(!!row.unavailable));
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
        detail.hidden = !detail.textContent;
        if (row.skills) {
          option.classList.add('hub-build-row');
          option.append(renderBuildInfo(row));
        }
      }
      option.addEventListener('pointermove', () => select(row.id));
      option.addEventListener('click', () => { select(row.id); void run(); });
      list.append(option);
    });
    count.textContent = `${rows.length} result${rows.length === 1 ? '' : 's'}`;
    const exactCount = rows.filter(row => normaliseHubQuery(row.title) === parsed.term || savedRows.some(saved => saved.id === row.id)).length;
    const prior = previousRows.find(row => row.id === selected);
    const revised = prior && rows.find(row => row.id === selected)?.preview !== prior.preview;
    const initial = !scope && !input.value.trim() ? rows.find(row => !row.unavailable) : rows[0];
    select((prior?.id === 'quote-state' || prior?.id === 'market-state') && !!rows[0]?.conversion ? rows[0].id : reset ? exactCount > 1 ? null : initial?.id ?? null : !revised && rows.some(row => row.id === selected) ? selected : null);
    if (hadRowFocus) (list.querySelector<HTMLElement>('[aria-selected="true"]') ?? input).focus();
    if (!rows.length) {
      const empty = document.createElement('p'); empty.className = 'hub-empty'; empty.textContent = 'No matches'; list.append(empty);
    }
  }
  async function run() {
    const row = rows.find(row => row.id === selected);
    if (!row || pending) return;
    if (row.unavailable) { report(row.unavailable); return; }
    const generation = epoch;
    pending = true; select(selected); report('');
    try {
      if(row.searchQuery!==undefined){remember();resetView();scope=null;backButton.hidden=true;caption.textContent='Home';input.value=row.searchQuery;refresh(true);input.focus();input.select();}
      else await row.run();
    }
    catch (error) { if (generation === epoch) report(error instanceof Error ? error.message : 'The action could not complete. Try again.'); }
    finally { pending = false; select(selected); }
  }
  function resetView() {
    disposeView?.(); disposeView = null; activeView = null; viewAvailable = null; returnFromView = null; content.replaceChildren(); content.hidden = true;
    search.hidden = false; list.hidden = false; footer.hidden = false;
  }
  function home() {
    history.length = 0; resetView(); scope = null; input.value = restoreQuery; backButton.hidden = true;
    root.dataset.page = 'home'; caption.textContent = 'Home'; input.placeholder = 'Search people, places, builds…'; report(''); refresh(true); input.focus();
  }
  function back() {
    if (returnFromView) returnFromView();
    else restoreParent();
  }
  function close() {
    epoch++; history.length = 0; resetView(); modal.close(); for (const source of sources.keys()) source.setVisible(false); scope = null;
    input.value = ''; restoreQuery = ''; report(''); selected = null;
  }
  const modal = window.gwSurfaces.registerDialog({ root, priority: 6, transient: true,
    dismiss: () => history.length ? back() : close(),
    restoreFocus: () => previousFocus?.isConnected && previousFocus.getClientRects().length > 0 ? previousFocus : document.getElementById('canvas'),
  });
  function show() {
    if (root.open) { home(); return; }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.dispatchEvent(new Event('gw:input-reset'));
    modal.show(); window.dispatchEvent(new Event('gw:hub-visible')); for (const source of sources.keys()) source.setVisible(sourceEnabled(source)); home();
  }
  input.addEventListener('input', () => { report(''); refresh(true); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const id = selected ?? rows[0]?.id ?? null; select(id, true);
      list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); (backButton.hidden ? required<HTMLButtonElement>('.hub-lock') : backButton).focus();
    } else if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) void run(); }
  });
  root.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || target === required<HTMLElement>('.hub-resize')) return;
    const editing = target.matches('input,textarea,select,[contenteditable="true"]');
    if (event.key === 'Backspace' && (!editing || target instanceof HTMLInputElement && target.type !== 'range' && !target.value)) {
      if (history.length) { event.preventDefault(); event.stopPropagation(); back(); }
      return;
    }
    const row = target.closest<HTMLElement>('.hub-row');
    if (row && ['ArrowUp', 'ArrowDown', 'ArrowRight', 'Enter'].includes(event.key)) {
      event.preventDefault();
      const index = rows.findIndex(item => item.id === row.dataset.id);
      if (event.key === 'ArrowRight') { if (!event.repeat) rows[index]?.navigate?.(); }
      else if (event.key === 'Enter') { if (!event.repeat) void run(); }
      else if (event.key === 'ArrowUp' && index <= 0) input.focus();
      else if (event.key === 'ArrowDown' && index === rows.length - 1) primary.focus();
      else {
        const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        select(rows[next]?.id ?? null, true); list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
      }
      return;
    }
    if (target.closest('.hub-footer')) {
      const controls = [primary, required<HTMLButtonElement>('.hub-actions')].filter(button => !button.hidden && !button.disabled);
      if (event.key === 'ArrowUp') { event.preventDefault(); list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); controls[Math.max(0, Math.min(controls.length - 1, controls.indexOf(target as HTMLButtonElement) + (event.key === 'ArrowRight' ? 1 : -1)))]?.focus(); }
      return;
    }
    if (target.closest('.hub-heading')) {
      const controls = [...required<HTMLElement>('.hub-heading').querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.hidden && button.getClientRects().length);
      const index = controls.indexOf(target as HTMLButtonElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); (search.hidden ? content.querySelector<HTMLElement>('input[type=search],input[type=text]') ?? content.querySelector<HTMLElement>('input,select,button,[tabindex="0"]') : input)?.focus(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); controls[Math.max(0, Math.min(controls.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))]?.focus(); }
      return;
    }
    if (content.contains(target) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (target.matches('select,input[type="range"],textarea') || target.isContentEditable) return;
      const controls = [...content.querySelectorAll<HTMLElement>('input,select,button,a[href],summary,[tabindex="0"]')].filter(control => control.getClientRects().length && !control.matches(':disabled')).sort((a, b) => { const left = a.getBoundingClientRect(), right = b.getBoundingClientRect(); return left.top - right.top || left.left - right.left; });
      const index = controls.indexOf(target);
      if (index < 0) return;
      event.preventDefault();
      if (event.key === 'ArrowUp' && index === 0) (backButton.hidden ? required<HTMLButtonElement>('.hub-lock') : backButton).focus();
      else controls[Math.max(0, Math.min(controls.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    }
  });
  const actions = () => {
    if (!root.open || document.querySelector('dialog:modal') !== root) return false;
    if (disposeView) return true;
    if (scope) return true;
    const row = rows.find(row => row.id === selected);
    if (!row) return true;
    if (isHubShortcuts([{ id: row.id, phrase: '', pinned: false }])) {
      presenter.showRows(row.title, () => [
        { ...row, id: 'selected-action', group: 'Actions' },
        ...(row.actions ? [{ id: 'review-selected', title: 'Review', detail: row.title, group: 'Actions', action: 'Review', run: row.actions }] : []),
        { id: 'pin-selected', title: shortcuts().some(entry => entry.id === row.id && entry.pinned) ? 'Unpin' : 'Pin to Hub', detail: row.title, group: 'Actions', action: 'Update pin', run: async () => {
          const entries = shortcuts(); const old = entries.find(entry => entry.id === row.id);
          await saveShortcuts([...entries.filter(entry => entry.id !== row.id), { id: row.id, phrase: old?.phrase ?? '', pinned: !old?.pinned }]);
        } },
        { id: 'alias-selected', title: 'Set search phrase', detail: 'An exact name for this saved action', group: 'Actions', action: 'Edit phrase', run: () => editHubShortcut(presenter, row, shortcuts, saveShortcuts) },
      ]); return true;
    }
    if (row.actions) { row.actions(); return true; }
    presenter.showRows(row.title, () => [row]); return true;
  };
  required<HTMLButtonElement>('.hub-actions').onclick = actions;
  required<HTMLButtonElement>('.hub-close').onclick = close;
  backButton.onclick = back; primary.onclick = () => { void run(); };
  root.addEventListener('click', event => { if (event.target === root) { event.stopImmediatePropagation(); close(); } }, true);
  root.addEventListener('close', () => { if (!root.open) close(); });
  const onBlur = () => close();
  let enabledSources = new Set<HubSource>();
  const onSettings = () => {
    const disabled = [...enabledSources].some(source => !sourceEnabled(source));
    enabledSources = new Set([...sources.keys()].filter(sourceEnabled));
    for (const source of sources.keys()) source.setVisible(root.open && sourceEnabled(source));
    if (disposeView && (viewAvailable ? !viewAvailable() : disabled)) home();
    else refresh();
  };
  window.addEventListener('blur', onBlur); window.addEventListener('gw:tools-settings', onSettings);
  const presenter = {
    show, close, openSettings, toggle: () => root.open ? close() : show(), actions,
    get visible() { return root.open; },
    attach(next: HubSource) {
      if (sourceEnabled(next)) enabledSources.add(next);
      sources.set(next, next.subscribe(() => refresh())); next.setVisible(root.open && sourceEnabled(next)); refresh();
      return () => {
        sources.get(next)?.(); sources.delete(next); enabledSources.delete(next); next.setVisible(false);
        if (root.open && (!disposeView || !viewAvailable || !viewAvailable())) home();
      };
    },
    showRows(title: string, getRows: () => readonly HubRow[], summary?: HubSummary) {
      const fromOpenHub = root.open;
      if (!fromOpenHub) show();
      if (!scope) restoreQuery = input.value;
      if (fromOpenHub && !restoring) remember(); resetView(); scope = { title, rows: getRows, ...(summary ? { summary } : {}) }; root.dataset.page = 'section'; caption.textContent = title;
      backButton.hidden = false; input.placeholder = 'Search actions…'; input.value = ''; report(''); refresh(true); input.focus();
    },
    showView(title: string, mount: (target: HTMLElement, back: () => void) => () => void, available?: () => boolean) {
      const fromOpenHub = root.open;
      if (!fromOpenHub) show();
      if (!scope) restoreQuery = input.value;
      if (fromOpenHub && !restoring) remember();
      resetView();
      returnFromView = restoreParent;
      root.dataset.page = 'section'; caption.textContent = title; backButton.hidden = false;
      required<HTMLElement>('.hub-preview').hidden = true; required<HTMLElement>('.hub-rate-controls').hidden = true;
      search.hidden = true; list.hidden = true; footer.hidden = true; content.hidden = false;
      activeView = { title, mount, ...(available ? { available } : {}) };
      viewAvailable = available ?? null;
      disposeView = mount(content, back);
      paintNavigation();
      if (!content.contains(document.activeElement)) content.querySelector<HTMLElement>('input,select,button,[tabindex="0"]')?.focus();
    },
    browseBuilds() { const row = lookup('builds'); if (row && !row.unavailable) void row.run(); else report('Build Library is loading. Try again.'); },
    resetPosition: hubWindow.reset,
    dispose() { close(); hubWindow.dispose(); disposeFrame(); for (const unsubscribe of sources.values()) unsubscribe(); sources.clear(); modal.dispose(); root.remove(); window.removeEventListener('blur', onBlur); window.removeEventListener('gw:tools-settings', onSettings); },
  };
  presenter.attach(createHubAccounts(presenter, { get: () => window.gwNative.accounts.get(), open: request => window.gwNative.accounts.open(request) }));
  presenter.attach(createHubCalculator({
    hub: presenter,
    copy: value => window.gwNative.clipboard.writeText(value),
    marketEnabled: () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().tradeChat,
    market: () => 'trade' in window.gwNative ? window.gwNative.trade.getMarketRates() : Promise.reject(new Error('Rate unavailable')),
    quotes: () => 'trade' in window.gwNative ? window.gwNative.trade.getTraderQuotes() : Promise.reject(new Error('Rate unavailable')),
  }));
  return presenter;
}
export type Hub = ReturnType<typeof createHub>;
