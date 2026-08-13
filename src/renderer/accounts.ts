import type { AccountProfileSummary } from '../shared/contracts.js';

(function () {
  const required = <T extends HTMLElement>(id: string): T => {
    const value = document.getElementById(id);
    if (!value) throw new Error(`missing accounts element: ${id}`);
    return value as T;
  };

  const form = required<HTMLFormElement>('accounts-form');
  const list = required<HTMLFieldSetElement>('accounts-list');
  const empty = required<HTMLElement>('accounts-empty');
  const open = required<HTMLButtonElement>('accounts-open');
  const selectAll = required<HTMLButtonElement>('accounts-select-all');
  const status = required<HTMLElement>('accounts-status');
  const menu = required<HTMLElement>('account-menu');
  const menuEdit = required<HTMLButtonElement>('account-edit');
  const menuArchive = required<HTMLButtonElement>('account-archive');
  const profileDialog = required<HTMLDialogElement>('profile-dialog');
  const profileForm = required<HTMLFormElement>('profile-form');
  const profileTitle = required<HTMLElement>('profile-dialog-title');
  const profileDescription = required<HTMLElement>('profile-dialog-description');
  const profileName = required<HTMLInputElement>('profile-name');
  const profileSave = required<HTMLButtonElement>('profile-save');
  const profileStatus = required<HTMLElement>('profile-status');
  const settingsDialog = required<HTMLDialogElement>('accounts-settings');
  const archivedList = required<HTMLElement>('accounts-archived-list');
  const noArchived = required<HTMLElement>('accounts-no-archived');
  const settingsStatus = required<HTMLElement>('settings-status');

  let profiles: readonly AccountProfileSummary[] = [];
  let selected = new Set<AccountProfileSummary['id']>();
  let editing: AccountProfileSummary | null = null;
  let menuProfile: AccountProfileSummary | null = null;
  let refreshInFlight: Promise<void> | null = null;

  const activeProfiles = () => profiles.filter((profile) => !profile.archived);
  const selectedProfiles = () => activeProfiles().filter((profile) => selected.has(profile.id));
  const choice = (name: string) => profileForm.elements.namedItem(name) as RadioNodeList;

  function stateLabel(profile: AccountProfileSummary): string {
    switch (profile.state) {
      case 'ready': return 'Ready';
      case 'queued': return 'Waiting';
      case 'opening': return 'Starting';
      case 'checking': return 'Checking updated client';
      case 'running': return 'Open';
      case 'failed': return 'Needs Attention';
    }
  }

  function recoveryText(profile: AccountProfileSummary): string {
    switch (profile.launchIssue) {
      case 'profile-preparation': return 'Couldn’t prepare this account.';
      case 'window-startup': return 'Its game window couldn’t start.';
      case 'client-validation': return 'The updated client couldn’t be verified.';
      case 'renderer-crash': return 'The game stopped unexpectedly twice.';
      default: return 'This account couldn’t be opened.';
    }
  }

  function setStatus(message = '', tone: 'neutral' | 'progress' | 'success' | 'error' = 'neutral') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function syncActions() {
    const active = activeProfiles();
    const chosen = selectedProfiles();
    open.disabled = chosen.length === 0 || chosen.some((profile) =>
      profile.state === 'queued' || profile.state === 'opening' || profile.state === 'checking');
    if (chosen.length === 0) open.textContent = 'Open';
    else if (chosen.length > 1) open.textContent = `Open ${chosen.length} Accounts`;
    else if (chosen[0]!.state === 'running') open.textContent = `Show ${chosen[0]!.name}`;
    else if (chosen[0]!.state === 'failed') open.textContent = `Retry ${chosen[0]!.name}`;
    else open.textContent = `Open ${chosen[0]!.name}`;
    selectAll.textContent = active.length > 0 && chosen.length === active.length ? 'Clear' : 'Select All';
    selectAll.disabled = active.length === 0;
  }

  async function launch(ids: readonly AccountProfileSummary['id'][]) {
    if (ids.length === 0) return;
    open.disabled = true;
    setStatus('Opening selected accounts…', 'progress');
    const poll = window.setInterval(() => { void refresh(); }, 180);
    try {
      await window.gwNative.accounts.open(ids);
      setStatus('Selected accounts are open.', 'success');
    } catch {
      setStatus('Some accounts need attention. Open accounts were left running.', 'error');
    } finally {
      window.clearInterval(poll);
      await refresh();
    }
  }

  function closeMenu() {
    menu.hidden = true;
    menuProfile = null;
  }

  function showMenu(profile: AccountProfileSummary, trigger: HTMLElement) {
    menuProfile = profile;
    const bounds = trigger.getBoundingClientRect();
    menu.style.top = `${Math.min(bounds.bottom + 4, innerHeight - 90)}px`;
    menu.style.left = `${Math.max(8, Math.min(bounds.right - 190, innerWidth - 198))}px`;
    menuEdit.disabled = profile.state === 'running';
    menuEdit.title = profile.state === 'running' ? 'Close this account before editing it.' : '';
    menuArchive.disabled = profile.state === 'running' || activeProfiles().length < 2;
    menuArchive.title = profile.state === 'running'
      ? 'Close this account before archiving it.'
      : activeProfiles().length < 2 ? 'At least one active account is required.' : '';
    menu.hidden = false;
    menuEdit.focus();
  }

  function renderProfile(profile: AccountProfileSummary): HTMLElement {
    const row = document.createElement('div');
    row.className = 'account-row';
    row.dataset.profileId = profile.id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'account';
    checkbox.value = profile.id;
    checkbox.id = `account-${profile.id}`;
    checkbox.checked = selected.has(profile.id);
    checkbox.setAttribute('aria-label', `Select ${profile.name}`);
    const copy = document.createElement('label');
    copy.className = 'account-copy';
    copy.htmlFor = checkbox.id;
    const name = document.createElement('strong');
    name.textContent = profile.name;
    name.title = profile.name;
    const state = document.createElement('small');
    state.textContent = profile.state === 'failed'
      ? `${stateLabel(profile)} — ${recoveryText(profile)}`
      : stateLabel(profile);
    copy.append(name, state);
    const indicator = document.createElement('span');
    if (profile.state === 'running') {
      indicator.className = 'open-indicator';
      indicator.textContent = 'Open';
    } else if (profile.state === 'failed') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'retry';
      retry.textContent = 'Retry';
      retry.setAttribute('aria-label', `Retry ${profile.name}`);
      retry.addEventListener('click', () => { void launch([profile.id]); });
      indicator.append(retry);
    }
    const trailing = document.createElement('button');
    trailing.type = 'button';
    trailing.className = 'more';
    trailing.textContent = '•••';
    trailing.setAttribute('aria-label', `More options for ${profile.name}`);
    trailing.addEventListener('click', () => showMenu(profile, trailing));
    row.append(checkbox, copy, indicator, trailing);
    row.addEventListener('click', (event) => {
      const target = event.target as Element;
      if (target.closest('button, input, label')) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return row;
  }

  function renderArchived() {
    const archived = profiles.filter((profile) => profile.archived);
    noArchived.hidden = archived.length > 0;
    archivedList.replaceChildren(...archived.map((profile) => {
      const row = document.createElement('div');
      row.className = 'archived-account';
      const name = document.createElement('strong');
      name.textContent = profile.name;
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = 'Restore';
      restore.addEventListener('click', async () => {
        restore.disabled = true;
        try {
          await window.gwNative.accounts.restore(profile.id);
          settingsStatus.textContent = `${profile.name} was restored.`;
          await refresh();
        } catch {
          restore.disabled = false;
          settingsStatus.textContent = 'The account could not be restored.';
        }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete';
      remove.textContent = 'Delete…';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          const next = await window.gwNative.accounts.delete(profile.id);
          const deleted = !next.profiles.some((candidate) => candidate.id === profile.id);
          settingsStatus.textContent = deleted ? `${profile.name} was permanently deleted.` : 'Deletion was cancelled.';
          await refresh();
        } catch {
          remove.disabled = false;
          settingsStatus.textContent = 'The account could not be deleted.';
        }
      });
      row.append(name, restore, remove);
      return row;
    }));
  }

  function render() {
    const active = activeProfiles();
    selected = new Set([...selected].filter((id) => active.some((profile) => profile.id === id)));
    list.replaceChildren(...active.map(renderProfile));
    list.setAttribute('aria-busy', 'false');
    list.hidden = active.length === 0;
    empty.hidden = active.length > 0;
    renderArchived();
    syncActions();
  }

  function refresh(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = window.gwNative.accounts.get()
      .then((state) => {
        if (state.mode !== 'multi') throw new Error('Multiple Accounts is not active');
        profiles = state.profiles;
        render();
      })
      .catch(() => {
        list.replaceChildren();
        list.setAttribute('aria-busy', 'false');
        setStatus('Accounts couldn’t be loaded. Restart GWonMac and try again.', 'error');
      })
      .finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  function showProfileDialog(profile: AccountProfileSummary | null) {
    editing = profile;
    profileTitle.textContent = profile ? 'Edit Account' : 'New Account';
    profileDescription.textContent = profile
      ? `Change how ${profile.name} stores builds and templates.`
      : 'Create an independent Guild Wars account.';
    profileSave.textContent = profile ? 'Save Changes' : 'Create Account';
    profileName.value = profile?.name ?? '';
    choice('profileBuilds').value = profile?.builds ?? 'shared';
    choice('profileTemplates').value = profile?.templates ?? 'shared';
    profileStatus.textContent = '';
    profileDialog.showModal();
    profileName.focus();
  }

  list.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.checked) selected.add(input.value as AccountProfileSummary['id']);
    else selected.delete(input.value as AccountProfileSummary['id']);
    syncActions();
  });
  selectAll.addEventListener('click', () => {
    const active = activeProfiles();
    selected = selected.size === active.length
      ? new Set()
      : new Set(active.map((profile) => profile.id));
    render();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void launch(selectedProfiles().map((profile) => profile.id));
  });
  required<HTMLButtonElement>('accounts-new').addEventListener('click', () => showProfileDialog(null));
  required<HTMLButtonElement>('accounts-empty-new').addEventListener('click', () => showProfileDialog(null));
  required<HTMLButtonElement>('profile-cancel').addEventListener('click', () => profileDialog.close());
  profileDialog.addEventListener('close', () => { editing = null; profileStatus.textContent = ''; });
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!profileForm.reportValidity()) return;
    profileSave.disabled = true;
    const request = {
      name: profileName.value.trim(),
      builds: choice('profileBuilds').value as 'shared' | 'private',
      templates: choice('profileTemplates').value as 'shared' | 'private',
    };
    const wasEditing = editing !== null;
    try {
      if (editing) await window.gwNative.accounts.update({ id: editing.id, ...request });
      else await window.gwNative.accounts.create(request);
      profileDialog.close();
      setStatus(wasEditing ? 'Account updated.' : 'Account created.', 'success');
      await refresh();
    } catch {
      profileStatus.textContent = 'The account could not be saved. Use a unique name and close it before changing sharing.';
    } finally {
      profileSave.disabled = false;
    }
  });

  menuEdit.addEventListener('click', () => {
    const profile = menuProfile;
    closeMenu();
    if (profile) showProfileDialog(profile);
  });
  menuArchive.addEventListener('click', async () => {
    const profile = menuProfile;
    closeMenu();
    if (!profile || !window.confirm(`Archive “${profile.name}”? Its login and files will be kept.`)) return;
    try {
      await window.gwNative.accounts.archive(profile.id);
      setStatus(`${profile.name} was archived.`, 'success');
      selected.delete(profile.id);
      await refresh();
    } catch {
      setStatus('Close the account before archiving it, then try again.', 'error');
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) closeMenu();
  });

  const showSettings = () => {
    closeMenu();
    settingsStatus.textContent = '';
    renderArchived();
    if (!settingsDialog.open) settingsDialog.showModal();
  };
  required<HTMLButtonElement>('settings-done').addEventListener('click', () => settingsDialog.close());
  required<HTMLButtonElement>('accounts-single').addEventListener('click', async () => {
    if (!window.confirm('Return to Single Account mode? GWonMac will restart. Multiple Accounts and Single Account data will both be preserved.')) return;
    settingsStatus.textContent = 'Restarting in Single Account mode…';
    try {
      await window.gwNative.accounts.useSingle();
    } catch {
      settingsStatus.textContent = 'The mode change could not be saved. Nothing changed.';
    }
  });
  window.gwNative.commands.handle(async (command) => {
    if (command.type === 'accounts.settings.open') showSettings();
  });

  window.addEventListener('focus', () => { void refresh(); });
  void refresh();
})();
