/**
 * Explicit editing of the selected Hub object's search phrase and pin.
 * Keeps presentation separate from canonical game and storage owners.
 */
import { isHubShortcuts, type HubShortcut } from '../shared/hub-preferences.js';
import type { HubPresenter, HubRow } from '../shared/hub.js';
export function editHubShortcut(hub: HubPresenter<HTMLElement>, row: HubRow, get: () => readonly HubShortcut[], save: (value: readonly HubShortcut[]) => Promise<void>) {
  hub.showView('Search phrase', target => {
    const doc = target.ownerDocument;
    const form = doc.createElement('form'); form.className = 'hub-detail';
    const heading = doc.createElement('h2'); heading.textContent = row.title;
    const label = doc.createElement('label'); label.textContent = 'Find this with';
    const input = doc.createElement('input'); input.className = 'ui-input'; input.maxLength = 64; input.setAttribute('aria-label', 'Search phrase');
    input.value = get().find(entry => entry.id === row.id)?.phrase ?? '';
    label.append(input);
    const hint = doc.createElement('p'); hint.textContent = 'An exact phrase opens this saved action. The original name stays visible.';
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    const button = doc.createElement('button'); button.className = 'ui-button'; button.type = 'submit'; button.textContent = 'Save phrase';
    form.append(heading, label, hint, status, button); target.append(form);
    form.onsubmit = event => {
      event.preventDefault();
      const current = get(); const old = current.find(entry => entry.id === row.id);
      const phrase = input.value.toLowerCase().trim().replace(/\s+/gu, ' ');
      const next = [...current.filter(entry => entry.id !== row.id), ...(phrase || old?.pinned ? [{ id: row.id, phrase, pinned: old?.pinned ?? false }] : [])];
      if (!isHubShortcuts(next)) { status.textContent = 'Choose a unique phrase. Command words are reserved.'; return; }
      button.disabled = true;
      void save(next).then(() => { status.textContent = 'Saved'; }).catch(() => { status.textContent = 'Could not save. Try again.'; }).finally(() => { button.disabled = false; });
    };
    input.focus(); return () => form.remove();
  });
}

/** Edit only references currently resolvable under the active feature/account rules. */
export function manageHubShortcuts(hub: HubPresenter<HTMLElement>, get: () => readonly HubShortcut[], lookup: (id: string) => HubRow | undefined, save: (value: readonly HubShortcut[]) => Promise<void>, resetPosition: () => void) {
  hub.showView('Hub preferences', target => {
    const doc = target.ownerDocument;
    const view = doc.createElement('section'); view.className = 'hub-detail'; target.append(view);
    const render = () => {
      view.replaceChildren();
      const heading = doc.createElement('h2'); heading.textContent = 'Pins and search phrases'; view.append(heading);
      const entries = get().filter(entry => lookup(entry.id));
      const status = doc.createElement('p'); status.setAttribute('role', 'status');
      const change = async (next: readonly HubShortcut[]) => {
        try { await save(next); render(); } catch { status.textContent = 'Could not save. Try again.'; }
      };
      for (const [index, entry] of entries.entries()) {
        const line = doc.createElement('div'); line.className = 'hub-preference-row';
        const name = doc.createElement('span'); name.textContent = `${lookup(entry.id)?.title}${entry.phrase ? ` · ${entry.phrase}` : ''}${entry.pinned ? ' · Pinned' : ''}`; line.append(name);
        const up = doc.createElement('button'); up.className = 'ui-button'; up.textContent = 'Move up'; up.disabled = index === 0;
        up.onclick = () => { const all = [...get()]; const before = entries[index - 1]; if (!before) return; const at = all.findIndex(value => value.id === entry.id); const previous = all.findIndex(value => value.id === before.id); all[at] = before; all[previous] = entry; void change(all); };
        const remove = doc.createElement('button'); remove.className = 'ui-button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${lookup(entry.id)?.title}`); remove.onclick = () => { void change(get().filter(value => value.id !== entry.id)); };
        line.append(up, remove); view.append(line);
      }
      if (!entries.length) { const hint = doc.createElement('p'); hint.textContent = 'Choose a result, then Actions to pin it or give it a search phrase.'; view.append(hint); }
      const reset = doc.createElement('button'); reset.className = 'ui-button'; reset.textContent = 'Reset aliases'; reset.disabled = !entries.some(entry => entry.phrase);
      reset.onclick = () => { const visible = new Set(entries.map(entry => entry.id)); void change(get().flatMap(entry => !visible.has(entry.id) ? [entry] : entry.pinned ? [{ ...entry, phrase: '' }] : [])); };
      const position = doc.createElement('button'); position.className = 'ui-button'; position.textContent = 'Reset Hub position';
      position.onclick = () => { resetPosition(); status.textContent = 'Hub position and size reset. Window locked.'; };
      view.append(reset, position, status);
    };
    render(); return () => view.remove();
  });
}
