import type { AccountProfileSummary } from '../shared/contracts.js';

/**
 * The Multiple Accounts Hub: a small projection of main-owned profile state.
 * Profile IDs originate in main and return only through checked controls; the
 * renderer never constructs paths, partitions, or credential names.
 */
(function () {
  const required = <T extends HTMLElement>(id: string): T => {
    const value = document.getElementById(id);
    if (!value) throw new Error(`missing accounts element: ${id}`);
    return value as T;
  };
  const form = required<HTMLFormElement>('accounts-form');
  const list = required<HTMLFieldSetElement>('accounts-list');
  const open = required<HTMLButtonElement>('accounts-open');
  const selectAll = required<HTMLButtonElement>('accounts-select-all');
  const status = required<HTMLElement>('accounts-status');
  const single = required<HTMLButtonElement>('accounts-single');
  let profiles: readonly AccountProfileSummary[] = [];

  function setStatus(message: string, tone: 'neutral' | 'progress' | 'success' | 'error') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function selectedIds() {
    return [...list.querySelectorAll<HTMLInputElement>('input:checked')]
      .map((input) => input.value as AccountProfileSummary['id']);
  }

  function syncActions() {
    open.disabled = selectedIds().length === 0;
    const allSelected = profiles.length > 0 && selectedIds().length === profiles.length;
    selectAll.textContent = allSelected ? 'Clear selection' : 'Select all';
  }

  function renderProfile(profile: AccountProfileSummary) {
    const label = document.createElement('label');
    label.className = 'account-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'profile';
    checkbox.value = profile.id;
    checkbox.checked = profile.state !== 'failed';
    const details = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'account-name';
    name.textContent = profile.name;
    const meta = document.createElement('span');
    meta.className = 'account-meta';
    meta.textContent = `${profile.templates} templates · ${profile.builds} builds`;
    details.append(name, meta);
    const state = document.createElement('span');
    state.className = 'account-state';
    state.dataset.state = profile.state;
    state.textContent = profile.state;
    label.append(checkbox, details, state);
    return label;
  }

  async function refresh() {
    try {
      const state = await window.gwNative.accounts.get();
      if (state.mode !== 'multi') throw new Error('Multiple Accounts is not active');
      profiles = state.profiles;
      list.replaceChildren(...profiles.map(renderProfile));
      syncActions();
    } catch {
      list.replaceChildren();
      setStatus('Profiles could not be loaded. Restart GWonMac and try again.', 'error');
    }
  }

  list.addEventListener('change', syncActions);
  selectAll.addEventListener('click', () => {
    const inputs = [...list.querySelectorAll<HTMLInputElement>('input')];
    const next = !inputs.every((input) => input.checked);
    for (const input of inputs) input.checked = next;
    syncActions();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ids = selectedIds();
    if (ids.length === 0) return;
    open.disabled = true;
    setStatus(`Opening ${ids.length === 1 ? 'account' : `${ids.length} accounts`}…`, 'progress');
    try {
      await window.gwNative.accounts.open(ids);
      setStatus('Selected accounts are open.', 'success');
      await refresh();
    } catch {
      setStatus('One or more accounts could not be opened. You can retry them.', 'error');
      await refresh();
    }
  });
  single.addEventListener('click', async () => {
    if (!window.confirm('Return to Single Account mode? All open game windows will close. Your Multi profiles and saved logins are kept.')) return;
    single.disabled = true;
    setStatus('Restarting in Single Account mode…', 'progress');
    try {
      await window.gwNative.accounts.useSingle();
    } catch {
      single.disabled = false;
      setStatus('The mode change could not be saved. Nothing changed.', 'error');
    }
  });

  void refresh();
})();
