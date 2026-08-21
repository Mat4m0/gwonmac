/**
 * Owns the Settings account-mode status and its explicit restart actions.
 * It does not own profile documents or the Account Picker lifecycle.
 */
export function bindAccountSettings(elements: Readonly<{
  enable: HTMLButtonElement;
  status: HTMLElement;
  modeStatus: HTMLElement;
  singleSetup: HTMLElement;
  multiActive: HTMLElement;
  returnSingle: HTMLButtonElement;
}>): void {
  elements.enable.addEventListener('click', async () => {
    if (!window.confirm(
      'Enable Multiple Accounts and restart GWonMac? Your current Single Account data will stay untouched.',
    )) return;
    elements.enable.disabled = true;
    elements.status.textContent = 'Creating the separate workspace…';
    try {
      const { exportEntries, templateFilesystem } = await import('./template-store.js');
      const filesystem = templateFilesystem();
      await window.gwNative.accounts.setup({
        templateEntries: filesystem ? exportEntries(filesystem) : [],
      });
    } catch {
      elements.enable.disabled = false;
      elements.status.textContent =
        'Multiple Accounts could not be enabled. Nothing changed.';
    }
  });

  elements.returnSingle.addEventListener('click', async () => {
    if (!window.confirm(
      'Return to Single Account mode? GWonMac will restart. Multiple Accounts and Single Account data will both be preserved.',
    )) return;
    elements.returnSingle.disabled = true;
    elements.modeStatus.textContent = 'Restarting in Single Account mode…';
    try {
      await window.gwNative.accounts.useSingle();
    } catch {
      elements.returnSingle.disabled = false;
      elements.modeStatus.textContent =
        'The mode change could not be saved. Nothing changed.';
    }
  });

  void window.gwNative.accounts.get().then((state) => {
    const singleMode = state.mode === 'single';
    const activeProfiles = state.profiles.filter((profile) => !profile.archived);
    const existingWorkspace = singleMode && activeProfiles.length > 0;
    elements.modeStatus.textContent = existingWorkspace
      ? `Single Account mode is active. Your ${activeProfiles.length} Multiple Accounts ${activeProfiles.length === 1 ? 'account is' : 'accounts are'} ready to restore.`
      : singleMode
        ? 'Single Account mode is active.'
        : 'Multiple Accounts mode is active. Use the Account Picker to open and manage accounts.';
    elements.singleSetup.hidden = !singleMode;
    elements.multiActive.hidden = singleMode;
    if (existingWorkspace) {
      elements.enable.textContent = 'Restore Multiple Accounts and Restart…';
    }
  }).catch(() => {
    elements.modeStatus.textContent = 'Account mode could not be read.';
    elements.singleSetup.hidden = true;
    elements.multiActive.hidden = true;
  });
}
