/**
 * The launcher's minimal profile and readiness projection.
 *
 * Main owns profile lifecycle, client progress, and update state. This renderer
 * only displays those values and sends narrow account commands.
 */
import type {
  AccountProfileSummary,
  AppUpdateState,
  DownloadProgress,
} from '../shared/contracts.js';

(function () {
  const required = <T extends HTMLElement>(id: string): T => {
    const value = document.getElementById(id);
    if (!value) throw new Error(`missing launcher element: ${id}`);
    return value as T;
  };

  const accountList = required<HTMLElement>('account-list');
  const accountStatus = required<HTMLElement>('account-status');
  const addAccount = required<HTMLButtonElement>('account-add');
  const dialog = required<HTMLDialogElement>('account-dialog');
  const form = required<HTMLFormElement>('account-form');
  const name = required<HTMLInputElement>('account-name');
  const save = required<HTMLButtonElement>('account-save');
  const dialogStatus = required<HTMLElement>('account-dialog-status');
  const clientState = required<HTMLElement>('client-state');
  const clientStateLabel = required<HTMLElement>('client-state-label');
  const clientRetry = required<HTMLButtonElement>('client-retry');
  const appUpdateState = required<HTMLElement>('app-update-state');

  let profiles: readonly AccountProfileSummary[] = [];
  let refreshInFlight: Promise<void> | null = null;

  const launchLabel = (profile: AccountProfileSummary): string => {
    switch (profile.state) {
      case 'running': return 'Show';
      case 'failed': return 'Retry';
      case 'queued': return 'Waiting';
      case 'opening': return 'Starting';
      case 'checking': return 'Checking';
      case 'ready': return 'Play';
    }
  };

  const launchIssue = (profile: AccountProfileSummary): string => {
    switch (profile.launchIssue) {
      case 'profile-preparation': return 'The account could not be prepared.';
      case 'window-startup': return 'The game window could not start.';
      case 'client-validation': return 'The updated game client could not be checked.';
      case 'renderer-crash': return 'The game stopped twice.';
      default: return 'The account could not be opened.';
    }
  };

  const renderProfile = (profile: AccountProfileSummary): HTMLElement => {
    const row = document.createElement('article');
    row.className = 'account-row';
    row.dataset.profileId = profile.id;

    const avatar = document.createElement('span');
    avatar.className = 'account-avatar';
    avatar.textContent = profile.name.trim().charAt(0).toLocaleUpperCase() || 'G';
    avatar.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('span');
    copy.className = 'account-copy';
    const title = document.createElement('strong');
    title.textContent = profile.name;
    const state = document.createElement('small');
    state.textContent = profile.state === 'failed'
      ? launchIssue(profile)
      : profile.state === 'running'
        ? 'Open'
        : profile.state === 'ready'
          ? 'Ready'
          : launchLabel(profile);
    copy.append(title, state);

    const action = document.createElement('button');
    action.className = profile.state === 'running' ? 'secondary' : 'primary';
    action.type = 'button';
    action.textContent = launchLabel(profile);
    action.disabled = profile.state === 'queued'
      || profile.state === 'opening'
      || profile.state === 'checking';
    action.setAttribute('aria-label', `${action.textContent} ${profile.name}`);
    action.addEventListener('click', async () => {
      action.disabled = true;
      accountStatus.textContent = profile.state === 'running'
        ? `Showing ${profile.name}…`
        : `Opening ${profile.name}…`;
      try {
        await window.gwNative.accounts.open([profile.id]);
        accountStatus.textContent = '';
      } catch {
        accountStatus.textContent = `${profile.name} could not be opened. Other accounts were not changed.`;
        accountStatus.dataset.tone = 'error';
      } finally {
        await refreshAccounts();
      }
    });

    row.append(avatar, copy, action);
    return row;
  };

  const renderAccounts = (): void => {
    const active = profiles.filter((profile) => !profile.archived);
    accountList.replaceChildren(...active.map(renderProfile));
    accountList.setAttribute('aria-busy', 'false');
  };

  function refreshAccounts(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = window.gwNative.accounts.get()
      .then((state) => {
        profiles = state.profiles;
        renderAccounts();
      })
      .catch(() => {
        accountList.replaceChildren();
        accountList.setAttribute('aria-busy', 'false');
        accountStatus.textContent = 'Accounts could not be loaded. Reopen gwonmac and try again.';
        accountStatus.dataset.tone = 'error';
      })
      .finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  const renderClientProgress = (progress: DownloadProgress): void => {
    clientState.dataset.phase = progress.phase;
    clientRetry.hidden = progress.phase !== 'error';
    clientRetry.disabled = false;
    if (progress.phase === 'ready') clientStateLabel.textContent = 'Ready to play';
    else if (progress.phase === 'error') clientStateLabel.textContent = 'Game files need attention';
    else if (progress.phase === 'checking') clientStateLabel.textContent = 'Checking game files…';
    else if (progress.phase === 'client') clientStateLabel.textContent = 'Updating game files…';
    else if (progress.phase === 'image') clientStateLabel.textContent = progress.label;
    else clientStateLabel.textContent = 'Preparing Guild Wars…';
  };

  clientRetry.addEventListener('click', async () => {
    clientRetry.disabled = true;
    clientStateLabel.textContent = 'Checking game files…';
    try {
      await window.gwNative.client.retry();
    } catch {
      clientStateLabel.textContent = 'Game files still need attention';
      clientRetry.disabled = false;
    }
  });

  const renderAppUpdate = (state: AppUpdateState): void => {
    switch (state.phase) {
      case 'checking': appUpdateState.textContent = 'Checking for gwonmac updates…'; break;
      case 'downloading': appUpdateState.textContent = `Downloading gwonmac ${state.latestVersion}…`; break;
      case 'ready': appUpdateState.textContent = `gwonmac ${state.latestVersion} is ready to install.`; break;
      case 'failed': appUpdateState.textContent = 'The gwonmac update check could not finish.'; break;
      case 'up-to-date': appUpdateState.textContent = `gwonmac ${state.currentVersion} is up to date.`; break;
      case 'manual-stable-return': appUpdateState.textContent = `gwonmac ${state.currentVersion}`; break;
      case 'idle': appUpdateState.textContent = `gwonmac ${state.currentVersion}`; break;
    }
  };

  addAccount.addEventListener('click', () => {
    name.value = '';
    dialogStatus.textContent = '';
    dialog.showModal();
    name.focus();
  });
  required<HTMLButtonElement>('account-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    dialogStatus.textContent = '';
    try {
      await window.gwNative.accounts.create({ name: name.value.trim() });
      dialog.close();
      await refreshAccounts();
    } catch {
      dialogStatus.textContent = 'The account could not be added. Use a different name and try again.';
      dialogStatus.dataset.tone = 'error';
    } finally {
      save.disabled = false;
    }
  });

  window.addEventListener('focus', () => { void refreshAccounts(); });
  window.gwNative.commands.handle(() => 'unhandled');
  window.gwNative.accounts.onChange((state) => {
    profiles = state.profiles;
    renderAccounts();
  });
  window.gwNative.progress.onChange(renderClientProgress);
  window.gwNative.appUpdates.onState(renderAppUpdate);
  void Promise.all([
    refreshAccounts(),
    window.gwNative.progress.current().then(renderClientProgress),
    window.gwNative.appUpdates.getState().then(renderAppUpdate),
  ]).catch(() => undefined);
})();
