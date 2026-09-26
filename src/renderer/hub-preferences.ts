/**
 * Explicit editing of the selected Hub object's search phrase and pin.
 * Keeps presentation separate from canonical game and storage owners.
 */
import { isHubShortcuts, type HubShortcut } from '../shared/hub-preferences.js';
import { HUB_SCOPES, normaliseHubQuery, type HubPresenter, type HubRow } from '../shared/hub.js';
import { calculate, parseConversion } from '../shared/hub-calculator.js';

/** First words that Hub's query grammar owns. */
export const HUB_RESERVED_WORDS: readonly string[] = [...HUB_SCOPES, 'settings', 'hub', 'commands', 'help', 'titles', 'rates', 'launcher'];
/** Whole phrases that the calculator reads as a unit. */
export const HUB_CALCULATOR_UNITS: readonly string[] = ['g', 'gold', 'p', 'plat', 'platinum', 'e', 'ecto', 'ectos', 'ectoplasm'];
/**
 * Refuses a new phrase that the query grammar would read first. Only the editor asks:
 * a stored phrase stays valid when a later release adds a word and simply stops matching.
 */
export function hubPhraseReserved(phrase: string): boolean {
  const term = normaliseHubQuery(phrase);
  if (!term) return false;
  if (HUB_RESERVED_WORDS.includes(term.split(' ')[0]!) || HUB_CALCULATOR_UNITS.includes(term)) return true;
  try { return !!parseConversion(term) || !!calculate(term); } catch { return /^\d/u.test(term); }
}
export function editHubShortcut(hub: HubPresenter<HTMLElement>, row: HubRow, get: () => readonly HubShortcut[], save: (value: readonly HubShortcut[]) => Promise<void>) {
  hub.showView('Search phrase', (target, _back, footer) => {
    const doc = target.ownerDocument;
    const form = doc.createElement('form'); form.className = 'hub-detail';
    const heading = doc.createElement('h2'); heading.textContent = row.title;
    const label = doc.createElement('label'); label.textContent = 'Find this with';
    const input = doc.createElement('input'); input.className = 'ui-input'; input.maxLength = 64; input.setAttribute('aria-label', 'Search phrase');
    input.value = get().find(entry => entry.id === row.id)?.phrase ?? '';
    label.append(input);
    const hint = doc.createElement('p'); hint.textContent = 'An exact phrase opens this saved action. The original name stays visible.';
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    form.append(heading, label, hint, status); target.append(form);
    // The footer's "Save phrase" is the form's one submit; Enter in the field runs it.
    const submit = async () => {
      const current = get(); const old = current.find(entry => entry.id === row.id);
      const phrase = normaliseHubQuery(input.value);
      const next = [...current.filter(entry => entry.id !== row.id), ...(phrase || old?.pinned ? [{ id: row.id, phrase, pinned: old?.pinned ?? false }] : [])];
      if (hubPhraseReserved(phrase) || !isHubShortcuts(next)) { status.textContent = 'Choose a unique phrase. Command words are reserved.'; return; }
      try { await save(next); status.textContent = 'Saved'; } catch { status.textContent = 'Could not save. Try again.'; }
    };
    form.onsubmit = event => { event.preventDefault(); void submit(); };
    footer.primary({ label: 'Save phrase', run: submit });
    input.focus(); return () => form.remove();
  });
}

/** Pins and phrases live in two storage owners: Build Library entries and global ones never trade places. */
const libraryOwned = (id: string) => /^(build|team):/u.test(id);

/**
 * Edit only references currently resolvable under the active feature/account rules.
 * One selected entry, by identity; Move up and Move down stay where they are, so a double-click
 * moves the same entry twice and focus never leaves the button. ⌥⌘↑/↓ move it from the list.
 * Removal names its target and passes an armed confirmation.
 */
export function manageHubShortcuts(hub: HubPresenter<HTMLElement>, get: () => readonly HubShortcut[], lookup: (id: string) => HubRow | undefined, save: (value: readonly HubShortcut[]) => Promise<void>, resetPosition: () => void) {
  let chosen: string | null = null;
  hub.showView('Hub preferences', (target, _back, footer) => {
    const doc = target.ownerDocument;
    const view = doc.createElement('section'); view.className = 'hub-detail hub-preferences';
    const heading = doc.createElement('h2'); heading.textContent = 'Pins and search phrases';
    const list = doc.createElement('div'); list.className = 'hub-preference-list'; list.id = 'hub-preference-list'; list.tabIndex = 0;
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Pins and search phrases');
    const tools = doc.createElement('div'); tools.className = 'hub-preference-tools';
    const tool = (label: string, keys: string, shortcut: string) => {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'ui-button'; button.textContent = label;
      button.title = `${label} (${keys})`; button.setAttribute('aria-keyshortcuts', shortcut); button.setAttribute('aria-controls', list.id);
      tools.append(button); return button;
    };
    const up = tool('Move up', '⌥⌘↑', 'Alt+Meta+ArrowUp');
    const down = tool('Move down', '⌥⌘↓', 'Alt+Meta+ArrowDown');
    const hint = doc.createElement('p'); hint.textContent = 'Choose a result, then Actions to pin it or give it a search phrase.';
    const reset = doc.createElement('button'); reset.type = 'button'; reset.className = 'ui-button'; reset.textContent = 'Reset aliases';
    const position = doc.createElement('button'); position.type = 'button'; position.className = 'ui-button'; position.textContent = 'Reset Hub position';
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    view.append(heading, list, tools, hint, reset, position, status); target.append(view);
    // The order the player sees; saves run one after another with the latest order.
    let order: HubShortcut[] = [...get()];
    let saving = Promise.resolve();
    const entries = () => order.filter(entry => lookup(entry.id));
    const title = (entry: HubShortcut) => lookup(entry.id)?.title ?? entry.id;
    const persist = () => {
      const next = [...order];
      saving = saving.then(() => save(next)).catch(() => { status.textContent = 'Could not save. Try again.'; order = [...get()]; paint(); });
    };
    const neighbour = (direction: -1 | 1) => {
      const visible = entries(); const index = visible.findIndex(entry => entry.id === chosen);
      const other = index < 0 ? undefined : visible[index + direction];
      return other && libraryOwned(other.id) === libraryOwned(chosen!) ? other : undefined;
    };
    function move(direction: -1 | 1) {
      const other = neighbour(direction);
      if (!other || !chosen) return;
      const at = order.findIndex(entry => entry.id === chosen); const to = order.findIndex(entry => entry.id === other.id);
      [order[at], order[to]] = [order[to]!, order[at]!];
      status.textContent = ''; paint(); persist();
    }
    function paint() {
      const visible = entries();
      if (!visible.some(entry => entry.id === chosen)) chosen = visible[0]?.id ?? null;
      list.replaceChildren();
      visible.forEach((entry, index) => {
        const option = doc.createElement('div'); option.className = 'hub-preference-option'; option.id = `hub-preference-${index}`;
        option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(entry.id === chosen));
        option.textContent = `${title(entry)}${entry.phrase ? ` · ${entry.phrase}` : ''}${entry.pinned ? ' · Pinned' : ''}`;
        option.onclick = () => { chosen = entry.id; paint(); list.focus({ preventScroll: true }); };
        list.append(option);
        if (entry.id === chosen) { list.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
      });
      if (!chosen) list.removeAttribute('aria-activedescendant');
      list.hidden = tools.hidden = !visible.length; hint.hidden = !!visible.length;
      // aria-disabled, not disabled: the focused button keeps focus at the end of the list.
      up.setAttribute('aria-disabled', String(!neighbour(-1))); down.setAttribute('aria-disabled', String(!neighbour(1)));
      reset.disabled = !visible.some(entry => entry.phrase);
      const selected = visible.find(entry => entry.id === chosen);
      const row = selected && lookup(selected.id);
      footer.primary(row ? { label: `Set phrase for ${row.title}`, run: () => editHubShortcut(hub, row, get, save) } : null);
      footer.secondary(selected ? { label: `Remove ${title(selected)}…`, run: () => confirmRemove(selected) } : null);
    }
    function confirmRemove(entry: HubShortcut) {
      const name = title(entry);
      hub.showView(`Remove ${name}?`, (confirmTarget, cancel, confirmFooter) => {
        const page = doc.createElement('section'); page.className = 'hub-detail hub-confirm'; page.tabIndex = 0;
        const question = doc.createElement('h2'); question.textContent = `Remove ${name} from Hub?`; page.setAttribute('aria-label', question.textContent);
        const copy = doc.createElement('p'); copy.textContent = 'Its pin and search phrase go. The place, tool or build itself stays.';
        page.append(question, copy); confirmTarget.append(page);
        confirmFooter.primary({ label: `Remove ${name}`, destructive: true, armed: true, run: async () => { await save(get().filter(value => value.id !== entry.id)); cancel(); } });
        confirmFooter.secondary({ label: 'Keep', run: cancel });
        return () => page.remove();
      });
    }
    up.onclick = () => move(-1); down.onclick = () => move(1);
    view.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.altKey && event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault(); move(event.key === 'ArrowUp' ? -1 : 1); return;
      }
      if (event.target !== list || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const visible = entries(); const index = visible.findIndex(entry => entry.id === chosen);
      const next = ({ ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: visible.length - 1 } as Record<string, number>)[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const target = visible[Math.max(0, Math.min(visible.length - 1, next))];
      if (target) { chosen = target.id; paint(); }
    });
    reset.onclick = () => {
      const visible = new Set(entries().map(entry => entry.id));
      order = order.flatMap(entry => !visible.has(entry.id) ? [entry] : entry.pinned ? [{ ...entry, phrase: '' }] : []);
      paint(); persist();
    };
    position.onclick = () => { resetPosition(); status.textContent = 'Hub position and size reset. Window locked.'; };
    paint();
    return () => view.remove();
  });
}
