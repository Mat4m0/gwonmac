/**
 * Explicit editing of the selected Hub object's search phrase and pin.
 * Keeps presentation separate from canonical game and storage owners.
 */
import { HUB_SHORTCUT_LIMIT, isHubShortcuts, hubPhraseReserved, isLibraryHubShortcut, type HubShortcut } from '../shared/hub-preferences.js';
import { normaliseHubQuery, type HubPresenter, type HubRow, type HubTask } from '../shared/hub.js';
import { listIndexAfter, listKeyStep } from '../shared/ui/list-keys.js';

/** The Hub's pins and phrases: read, resolve, save, and the result a phrase would already find by name. */
export type HubShortcutStore = Readonly<{
  get(): readonly HubShortcut[];
  lookup(id: string): HubRow | undefined;
  save(value: readonly HubShortcut[]): Promise<void>;
  exactlyNamed(phrase: string, id: string): HubRow | undefined;
}>;

/** Why a phrase cannot be saved for `id`, in words that say what to do; null when it can. */
function phraseProblem(phrase: string, id: string, next: readonly HubShortcut[], store: HubShortcutStore): string | null {
  const quoted = `“${phrase}”`;
  const reserved = hubPhraseReserved(phrase);
  if (reserved === 'command') return `${quoted} starts with the command word “${phrase.split(' ')[0]}”. Choose another phrase.`;
  if (reserved === 'unit') return `${quoted} is a calculator unit. Choose another phrase.`;
  if (reserved === 'calculation') return `${quoted} reads as a calculation. Choose another phrase.`;
  const saved = next.find(entry => entry.id !== id && normaliseHubQuery(entry.phrase) === phrase);
  const named = saved ? store.lookup(saved.id) ?? { title: 'another result' } : store.exactlyNamed(phrase, id);
  if (named) return `${quoted} already finds ${named.title}. Choose another phrase.`;
  const owned = next.filter(entry => isLibraryHubShortcut(entry.id) === isLibraryHubShortcut(id));
  if (owned.length > HUB_SHORTCUT_LIMIT) return `Hub keeps up to ${HUB_SHORTCUT_LIMIT} pins and phrases. Remove one first.`;
  return isHubShortcuts(owned) ? null : 'This phrase cannot be saved. Choose another.';
}

/**
 * The search-phrase form. The label stands above the field, an invalid phrase says why beside it,
 * and a saved phrase returns to the page that asked, which reports it. Enter and ⌘↵ save; the
 * draft stays for the session when the player leaves without saving (HUB-152).
 */
export function editHubShortcut(hub: HubPresenter<HTMLElement>, row: HubRow, store: HubShortcutStore, available?: () => boolean) {
  hub.showView('Search phrase', (target, back, footer) => {
    const doc = target.ownerDocument;
    const form = doc.createElement('form'); form.className = 'hub-detail'; form.noValidate = true;
    const heading = doc.createElement('h2'); heading.textContent = row.title;
    const field = doc.createElement('div'); field.className = 'ui-field';
    const label = doc.createElement('label'); label.className = 'ui-field-label'; label.htmlFor = 'hub-phrase'; label.textContent = 'Search phrase';
    const input = doc.createElement('input'); input.className = 'ui-input'; input.id = 'hub-phrase'; input.maxLength = 64; input.autocomplete = 'off'; input.spellcheck = false;
    input.value = store.get().find(entry => entry.id === row.id)?.phrase ?? '';
    const hint = doc.createElement('p'); hint.className = 'ui-field-hint'; hint.id = 'hub-phrase-hint';
    hint.textContent = `Type this exact phrase in Hub to find ${row.title}. Its name stays the same. Leave the field empty to remove the phrase.`;
    const error = doc.createElement('p'); error.className = 'ui-field-error'; error.id = 'hub-phrase-error'; error.setAttribute('role', 'alert'); error.hidden = true;
    field.append(label, input, hint, error);
    form.append(heading, field); target.append(form);
    const invalid = (message: string) => {
      error.textContent = message; error.hidden = !message;
      if (message) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', `${error.id} ${hint.id}`); }
      else { input.removeAttribute('aria-invalid'); input.setAttribute('aria-describedby', hint.id); }
    };
    invalid('');
    input.addEventListener('input', () => invalid(''));
    // The Hub's named footer action owns saving and its page-session boundary.
    const submit = async (task: HubTask) => {
      const current = store.get(); const old = current.find(entry => entry.id === row.id);
      const phrase = normaliseHubQuery(input.value);
      if (!phrase && !old?.phrase) { invalid('Type a search phrase.'); input.focus(); return; }
      const edited = { id: row.id, phrase, pinned: old?.pinned ?? false };
      const next = old ? current.flatMap(entry => entry.id !== row.id ? [entry] : phrase || old.pinned ? [edited] : []) : [...current, edited];
      const problem = phrase ? phraseProblem(phrase, row.id, next, store) : null;
      if (problem) { invalid(problem); input.focus(); return; }
      try { await store.save(next); }
      catch {
        if (!task.live()) throw new Error('Could not save the phrase. Try again.');
        invalid('Could not save the phrase. Try again.'); input.focus(); return;
      }
      const receipt = phrase ? `“${phrase}” now finds ${row.title}.` : `Removed the search phrase for ${row.title}.`;
      if (task.live()) { back(); hub.notify(receipt); }
      else task.done(receipt);
    };
    form.onsubmit = event => event.preventDefault();
    footer.primary({ label: 'Save phrase', run: submit });
    input.focus(); return () => form.remove();
  }, available);
}

/**
 * Edit only references currently resolvable under the active feature/account rules.
 * The list shows the two storage owners as two labelled groups in Home's order; an entry moves
 * within its group only, so no enabled Move is ever a no-op (HUB-090). One selected entry, by
 * identity; Move up and Move down stay where they are, so a double-click moves the same entry
 * twice and focus never leaves the button. ⌥⌘↑/↓ move it from the list.
 * Removing an entry or every phrase names what goes and passes an armed confirmation (HUB-092).
 */
export function manageHubShortcuts(hub: HubPresenter<HTMLElement>, store: HubShortcutStore, resetPosition: () => void) {
  const { get, lookup, save } = store;
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
    const reset = doc.createElement('button'); reset.type = 'button'; reset.className = 'ui-button'; reset.textContent = 'Remove all search phrases…';
    const position = doc.createElement('button'); position.type = 'button'; position.className = 'ui-button'; position.textContent = 'Reset Hub position';
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    view.append(heading, list, tools, hint, reset, position, status); target.append(view);
    // The order the player sees; saves run one after another with the latest order.
    let order: HubShortcut[] = [...get()];
    let saving = Promise.resolve();
    const entries = () => order.filter(entry => lookup(entry.id));
    const title = (entry: HubShortcut) => lookup(entry.id)?.title ?? entry.id;
    const phrased = () => entries().filter(entry => entry.phrase);
    const persist = () => {
      const next = [...order];
      saving = saving.then(() => save(next)).catch(() => { status.textContent = 'Could not save. Try again.'; order = [...get()]; paint(); });
    };
    const neighbour = (direction: -1 | 1) => {
      const visible = entries(); const index = visible.findIndex(entry => entry.id === chosen);
      const other = index < 0 ? undefined : visible[index + direction];
      return other && isLibraryHubShortcut(other.id) === isLibraryHubShortcut(chosen!) ? other : undefined;
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
      let group: HTMLElement | null = null;
      visible.forEach((entry, index) => {
        // Home lists places and tools first, then this account's builds and teams.
        if (!group || isLibraryHubShortcut(entry.id) !== isLibraryHubShortcut(visible[index - 1]!.id)) {
          group = doc.createElement('div'); group.className = 'hub-preference-group'; group.setAttribute('role', 'group');
          const name = doc.createElement('div'); name.className = 'hub-group'; name.setAttribute('role', 'presentation');
          name.id = `hub-preference-group-${index}`; name.textContent = isLibraryHubShortcut(entry.id) ? 'Builds and teams' : 'Places and tools';
          group.setAttribute('aria-labelledby', name.id); group.append(name); list.append(group);
        }
        const option = doc.createElement('div'); option.className = 'hub-preference-option'; option.id = `hub-preference-${index}`;
        option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(entry.id === chosen));
        option.textContent = `${title(entry)}${entry.phrase ? ` · ${entry.phrase}` : ''}${entry.pinned ? ' · Pinned' : ''}`;
        option.onclick = () => { chosen = entry.id; paint(); list.focus({ preventScroll: true }); };
        option.oncontextmenu = event => { event.preventDefault(); chosen = entry.id; paint(); list.focus({ preventScroll: true }); footer.openActions(); };
        group.append(option);
        if (entry.id === chosen) { list.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
      });
      if (!chosen) list.removeAttribute('aria-activedescendant');
      list.hidden = tools.hidden = !visible.length; hint.hidden = !!visible.length;
      // aria-disabled, not disabled: the focused button keeps focus at the end of the list.
      up.setAttribute('aria-disabled', String(!neighbour(-1))); down.setAttribute('aria-disabled', String(!neighbour(1)));
      reset.disabled = !phrased().length;
      const selected = visible.find(entry => entry.id === chosen);
      const row = selected && lookup(selected.id);
      footer.primary(row ? { label: `Set phrase for ${row.title}`, run: () => editHubShortcut(hub, row, store) } : null);
      footer.secondary(selected ? { label: `Remove ${title(selected)}…`, run: () => confirmRemove(selected) } : null);
    }
    /** One confirmation page for both removals: it names what goes and what stays, and Keep is the way out. */
    function confirm(caption: string, question: string, consequence: string, label: string, remove: () => Promise<void>, receipt: string) {
      hub.showView(caption, (confirmTarget, cancel, confirmFooter) => {
        const page = doc.createElement('section'); page.className = 'hub-detail hub-confirm'; page.tabIndex = 0;
        const ask = doc.createElement('h2'); ask.textContent = question; page.setAttribute('aria-label', question);
        const copy = doc.createElement('p'); copy.textContent = consequence;
        page.append(ask, copy); confirmTarget.append(page);
        confirmFooter.primary({ label, destructive: true, armed: true, run: async task => { await remove(); if (task.live()) { cancel(); hub.notify(receipt); } else task.done(receipt); } });
        confirmFooter.secondary({ label: 'Keep', run: cancel });
        return () => page.remove();
      });
    }
    function confirmRemove(entry: HubShortcut) {
      const name = title(entry);
      // Back on the list, the entry after the removed one is chosen, so the footer's Remove,
      // which keeps the keyboard, names it (HUB-019).
      confirm(`Remove ${name}?`, `Remove ${name} from Hub?`, 'Its pin and search phrase go. The place, tool or build itself stays.', `Remove ${name}`, async () => {
        const visible = entries(); const at = visible.findIndex(value => value.id === entry.id);
        await save(get().filter(value => value.id !== entry.id));
        chosen = (visible[at + 1] ?? visible[at - 1])?.id ?? null;
      }, `Removed ${name} from Hub.`);
    }
    function confirmReset() {
      const count = phrased().length;
      const phrases = `${count} search phrase${count === 1 ? '' : 's'}`;
      // Only resolvable entries lose their phrase; an unpinned entry then has nothing left and goes.
      confirm('Remove search phrases?', `Remove ${phrases}?`, 'Pins stay pinned. Every result is found by its own name again.', `Remove ${phrases}`, async () => {
        const visible = new Set(entries().map(entry => entry.id));
        await save(get().flatMap(entry => !visible.has(entry.id) ? [entry] : entry.pinned ? [{ ...entry, phrase: '' }] : []));
      }, `Removed ${phrases}.`);
    }
    up.onclick = () => move(-1); down.onclick = () => move(1);
    view.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.altKey && event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault(); move(event.key === 'ArrowUp' ? -1 : 1); return;
      }
      const step = event.target === list ? listKeyStep(event, 5) : null;
      if (step === null) return;
      event.preventDefault();
      const visible = entries();
      const target = visible[listIndexAfter(visible.findIndex(entry => entry.id === chosen), visible.length, step)];
      if (target) { chosen = target.id; paint(); }
    });
    reset.onclick = confirmReset;
    position.onclick = () => { resetPosition(); status.textContent = 'Hub position and size reset. Window locked.'; };
    paint();
    return () => view.remove();
  });
}
