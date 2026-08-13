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
  const newProfile = required<HTMLButtonElement>('accounts-new');
  const status = required<HTMLElement>('accounts-status');
  const single = required<HTMLButtonElement>('accounts-single');
  const archived = required<HTMLDetailsElement>('accounts-archived');
  const archivedList = required<HTMLElement>('accounts-archived-list');
  const profileDialog = required<HTMLDialogElement>('profile-dialog');
  const profileForm = required<HTMLFormElement>('profile-form');
  const profileTitle = required<HTMLElement>('profile-dialog-title');
  const profileName = required<HTMLInputElement>('profile-name');
  const profileSave = required<HTMLButtonElement>('profile-save');
  const profileArchive = required<HTMLButtonElement>('profile-archive');
  let profiles: readonly AccountProfileSummary[] = [];
  let editing: AccountProfileSummary | null = null;

  function setStatus(message: string, tone: 'neutral' | 'progress' | 'success' | 'error') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function selectedIds() {
    return [...list.querySelectorAll<HTMLInputElement>('input:checked')]
      .map((input) => input.value as AccountProfileSummary['id']);
  }

  function syncActions() {
    const inputs = list.querySelectorAll<HTMLInputElement>('input');
    open.disabled = selectedIds().length === 0;
    const allSelected = inputs.length > 0 && selectedIds().length === inputs.length;
    selectAll.textContent = allSelected ? 'Clear selection' : 'Select all';
  }

  function renderProfile(profile: AccountProfileSummary) {
    const row = document.createElement('div');
    row.className = 'account-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'profile';
    checkbox.value = profile.id;
    checkbox.checked = false;
    checkbox.id = `profile-${profile.id}`;
    const details = document.createElement('label');
    details.htmlFor = checkbox.id;
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
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'account-edit ui-button';
    edit.dataset.variant = 'quiet';
    edit.textContent = 'Edit…';
    edit.addEventListener('click', () => showProfileDialog(profile));
    row.append(checkbox, details, state, edit);
    return row;
  }

  function renderArchivedProfile(profile: AccountProfileSummary) {
    const row = document.createElement('div');
    row.className = 'archived-profile';
    const name = document.createElement('strong');
    name.textContent = profile.name;
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'ui-button';
    restore.textContent = 'Restore';
    restore.addEventListener('click', async () => {
      restore.disabled = true;
      try {
        await window.gwNative.accounts.restore(profile.id);
        setStatus('Profile restored.', 'success');
        await refresh();
      } catch {
        restore.disabled = false;
        setStatus('The profile could not be restored.', 'error');
      }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ui-button';
    remove.dataset.variant = 'danger';
    remove.textContent = 'Delete…';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Permanently delete “${profile.name}”? Its saved login, Guild Wars files, private templates, builds, and window state cannot be recovered.`)) return;
      remove.disabled = true;
      try {
        await window.gwNative.accounts.delete(profile.id);
        setStatus('Profile permanently deleted.', 'success');
        await refresh();
      } catch {
        remove.disabled = false;
        setStatus('The profile could not be fully deleted. Try again.', 'error');
      }
    });
    row.append(name, restore, remove);
    return row;
  }

  const choice = (name: string) =>
    profileForm.elements.namedItem(name) as RadioNodeList;

  function closeProfileDialog() {
    profileDialog.close();
    editing = null;
  }

  function showProfileDialog(profile: AccountProfileSummary | null) {
    editing = profile;
    profileTitle.textContent = profile ? `Edit ${profile.name}` : 'New profile';
    profileSave.textContent = profile ? 'Save changes' : 'Create profile';
    profileName.value = profile?.name ?? '';
    choice('profileBuilds').value = profile?.builds ?? 'shared';
    choice('profileTemplates').value = profile?.templates ?? 'shared';
    profileArchive.hidden =
      !profile || profiles.filter((item) => !item.archived).length < 2;
    profileArchive.disabled = profile?.state === 'running';
    profileDialog.showModal();
    profileName.focus();
  }

  async function refresh() {
    try {
      const state = await window.gwNative.accounts.get();
      if (state.mode !== 'multi') throw new Error('Multiple Accounts is not active');
      profiles = state.profiles;
      const active = profiles.filter((profile) => !profile.archived);
      const inactive = profiles.filter((profile) => profile.archived);
      list.replaceChildren(...active.map(renderProfile));
      archivedList.replaceChildren(...inactive.map(renderArchivedProfile));
      archived.hidden = inactive.length === 0;
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
  newProfile.addEventListener('click', () => showProfileDialog(null));
  required<HTMLButtonElement>('profile-cancel').addEventListener('click', closeProfileDialog);
  required<HTMLButtonElement>('profile-cancel-x').addEventListener('click', closeProfileDialog);
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!profileForm.reportValidity()) return;
    profileSave.disabled = true;
    const request = {
      name: profileName.value.trim(),
      builds: choice('profileBuilds').value as 'shared' | 'private',
      templates: choice('profileTemplates').value as 'shared' | 'private',
    };
    const updating = editing !== null;
    try {
      if (editing) await window.gwNative.accounts.update({ id: editing.id, ...request });
      else await window.gwNative.accounts.create(request);
      closeProfileDialog();
      setStatus(updating ? 'Profile updated.' : 'Profile created.', 'success');
      await refresh();
    } catch {
      setStatus('The profile could not be saved. Check that its name is unique.', 'error');
    } finally {
      profileSave.disabled = false;
    }
  });
  profileArchive.addEventListener('click', async () => {
    const profile = editing;
    if (!profile || !window.confirm(`Archive “${profile.name}”? Its saved login and files will be kept.`)) return;
    profileArchive.disabled = true;
    try {
      await window.gwNative.accounts.archive(profile.id);
      closeProfileDialog();
      setStatus('Profile archived. Its data was kept.', 'success');
      await refresh();
    } catch {
      setStatus('Close the profile before archiving it, then try again.', 'error');
    } finally {
      profileArchive.disabled = false;
    }
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
