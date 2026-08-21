/**
 * One owner for launcher strategy, full-download presentation, and Settings.
 * Cache residency is the download-progress truth; dataStrategy is only intent.
 *
 * index.html loads this as a classic script, so the file carries no top-level
 * import or export and names the contracts through type-only `import(…)`.
 */

(function () {
  type AppSettings = import('../shared/contracts.js').AppSettings;
  type RendererSettingsPatch = import('../shared/contracts.js').RendererSettingsPatch;
  type TravelUserPreferences =
    import('../shared/travel.js').TravelUserPreferences;
  type ClientSession = import('../shared/contracts.js').ClientSession;
  type RendererMilestone =
    import('../shared/diagnostics.js').RendererMilestone;
  type UpdateAction = import('./update-action.js').UpdateAction;

  const byId = (id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`missing renderer element: ${id}`);
    return element;
  };
  const dialog = byId('settings-dialog') as HTMLDialogElement;
  const settingsResize = byId('settings-resize') as HTMLButtonElement;
  const form = byId('settings-form') as HTMLFormElement;
  const settingsReset = byId('settings-reset-launcher') as HTMLButtonElement;
  const settingsCache = byId('settings-cache');
  const settingsPanes = form.querySelector('.settings-panes') as HTMLElement;
  const feedback = byId('settings-feedback');
  const renderScale = form.elements.namedItem(
    'renderScale',
  ) as RadioNodeList;
  const uiStyle = form.elements.namedItem('uiStyle') as RadioNodeList;
  const uiFont = form.elements.namedItem('uiFont') as RadioNodeList;
  const showDiagnostics = form.elements.namedItem(
    'showDiagnostics',
  ) as HTMLInputElement;
  const extendedMemoryEnabled = form.elements.namedItem(
    'extendedMemoryEnabled',
  ) as HTMLInputElement;
  const autoCheckUpdates = form.elements.namedItem(
    'autoCheckUpdates',
  ) as HTMLInputElement;
  const updateTrack = form.elements.namedItem('updateTrack') as HTMLSelectElement;
  const gwonmacTools = form.elements.namedItem('gwonmacTools') as HTMLInputElement;
  const teamManagement = form.elements.namedItem('teamManagement') as HTMLInputElement;
  const xunlaiStorage = form.elements.namedItem('xunlaiStorage') as HTMLInputElement;
  const travelPalette = form.elements.namedItem('travelPalette') as HTMLInputElement;
  const travelRecentLimit = form.elements.namedItem(
    'travelRecentLimit',
  ) as HTMLSelectElement;
  const travelRecentsClear = byId(
    'settings-travel-recents-clear',
  ) as HTMLButtonElement;
  const targetReadout = form.elements.namedItem('targetReadout') as HTMLInputElement;
  const toolFeatures = byId('settings-tool-features');
  const toolsOff = byId('settings-tools-off');
  const accountsEnable = byId('accounts-enable') as HTMLButtonElement;
  const accountsStatus = byId('accounts-setup-status');
  const accountsModeStatus = byId('accounts-mode-status');
  const accountsSingleSetup = byId('accounts-single-setup');
  const accountsMultiActive = byId('accounts-multi-active');
  const accountsReturnSingle = byId('accounts-return-single') as HTMLButtonElement;
  /**
   * The appearance slider beside the `output` that reads it back.
   *
   * `main` rejects an out-of-range value rather than clamping it, so the
   * bounds live on the `input` elements in `index.html` and this table only
   * says which setting each one writes and how it reads to a player.
   */
  const appearanceRanges = [
    { name: 'uiPanelOpacity', suffix: '%' },
  ] as const;
  const appearanceRange = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | null;
  const appearanceOutput = (name: string) =>
    form.elements.namedItem(`${name}Value`) as HTMLOutputElement | null;
  let updateAction: UpdateAction | null = null;
  let templatePane: import('./template-pane.js').TemplatePane | null = null;

  let currentSession: ClientSession | null = null;

  let currentSettings: AppSettings | null = null;
  let currentTravelPreferences: TravelUserPreferences | null = null;
  let settingsLoad: Promise<AppSettings> | null = null;
  let settingsWrite: Promise<unknown> = Promise.resolve();
  type FeedbackTone = 'neutral' | 'progress' | 'success' | 'warning' | 'error';
  const idleFeedback = 'Changes save automatically.';
  let feedbackTimer: number | null = null;
  let activeSettingsPane = 'data';
  // Settings is renderer UI, not game input. Keep its keys inside the modal;
  // Escape still reaches the dialog's native cancel behavior because stopping
  // propagation does not cancel the event.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('keyup', (event) => event.stopPropagation());

  void import('../shared/ui/resize.js').then(({ installResizeGrip }) => {
    installResizeGrip(settingsResize, {
      size: () => {
        const box = dialog.getBoundingClientRect();
        return { width: box.width, height: box.height };
      },
      limits: () => ({
        minWidth: Math.min(480, window.innerWidth - 32),
        minHeight: Math.min(360, window.innerHeight - 32),
        maxWidth: Math.max(280, window.innerWidth - 32),
        maxHeight: Math.max(280, window.innerHeight - 32),
      }),
      resize: (width, height) => {
        dialog.style.width = `${width}px`;
        dialog.style.height = `${height}px`;
      },
      setActive: (active) => {
        if (active) dialog.dataset.resizing = '';
        else delete dialog.dataset.resizing;
      },
    });
  });

  // The footer is the only save/action status owner. Success yields back to
  // the quiet autosave explanation; warnings and failures remain until the
  // next deliberate action so important feedback cannot vanish unread.
  function setFeedback(
    message = idleFeedback,
    tone: FeedbackTone = 'neutral',
    resetAfter = 0,
  ) {
    if (feedbackTimer !== null) clearTimeout(feedbackTimer);
    feedbackTimer = null;
    feedback.textContent = message;
    feedback.dataset.tone = tone;
    if (resetAfter > 0) {
      feedbackTimer = setTimeout(() => {
        feedbackTimer = null;
        feedback.textContent = idleFeedback;
        feedback.dataset.tone = 'neutral';
      }, resetAfter);
    }
  }

  const settingsRail = form.querySelector<HTMLElement>('.settings-rail');
  if (!settingsRail) throw new Error('missing settings rail');
  const compactSettings = window.matchMedia('(max-width: 560px)');
  const syncRailOrientation = () => {
    settingsRail.setAttribute(
      'aria-orientation',
      compactSettings.matches ? 'horizontal' : 'vertical',
    );
  };
  syncRailOrientation();
  compactSettings.addEventListener('change', syncRailOrientation);

  function selectPane(name: string) {
    activeSettingsPane = name;
    settingsPanes.dataset.active = name;
    let selectedTab: HTMLElement | null = null;
    for (const tab of form.querySelectorAll<HTMLElement>('.settings-rtab')) {
      const selected = tab.dataset.pane === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) selectedTab = tab;
    }
    if (dialog.open) {
      selectedTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (name === 'templates') templatePane?.refresh();
  }

  const railTabs = [...form.querySelectorAll<HTMLElement>('.settings-rtab')];
  for (const tab of railTabs) {
    tab.addEventListener('click', () => {
      if (tab.dataset.pane) selectPane(tab.dataset.pane);
    });
  }

  // Roving tabindex: arrows move between sections, Home/End jump.
  settingsRail.addEventListener('keydown', (event) => {
      const active = document.activeElement;
      const index =
        active instanceof globalThis.HTMLElement ? railTabs.indexOf(active) : -1;
      if (index < 0) return;
      let target: HTMLElement | undefined;
      const previous = compactSettings.matches ? 'ArrowLeft' : 'ArrowUp';
      const next = compactSettings.matches ? 'ArrowRight' : 'ArrowDown';
      if (event.key === next) {
        target = railTabs[(index + 1) % railTabs.length];
      } else if (event.key === previous) {
        target = railTabs[(index - 1 + railTabs.length) % railTabs.length];
      } else if (event.key === 'Home') {
        target = railTabs[0];
      } else if (event.key === 'End') {
        target = railTabs[railTabs.length - 1];
      }
      if (!target) return;
      event.preventDefault();
      target.focus();
      if (target.dataset.pane) selectPane(target.dataset.pane);
  });

  const launcherMilestone = (name: RendererMilestone) => {
    void window.gwNative.diagnostics
      .recordRendererMilestone(name, performance.now() * 1000)
      .catch(() => {});
  };

  function loadSettings() {
    if (currentSettings) return Promise.resolve(currentSettings);
    if (!settingsLoad) {
      settingsLoad = window.gwNative.settings.get()
        .then((settings) => {
          currentSettings = settings;
          return settings;
        })
        .finally(() => { settingsLoad = null; });
    }
    return settingsLoad;
  }

  function updateRenderScaleDimensions() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const activeScale = Number(renderScale.value);
    const offscreen = window.Module?.canvas?.offscreen;
    for (const output of form.querySelectorAll<HTMLElement>(
      '[data-render-scale]',
    )) {
      const scale = Number(output.dataset.renderScale);
      const offscreenWidth = offscreen?.width;
      const offscreenHeight = offscreen?.height;
      const measured =
        scale === activeScale &&
        typeof offscreenWidth === 'number' &&
        typeof offscreenHeight === 'number' &&
        Number.isFinite(offscreenWidth) &&
        Number.isFinite(offscreenHeight) &&
        offscreenWidth > 0 &&
        offscreenHeight > 0;
      const backingWidth =
        measured ? offscreenWidth : Math.round(width * scale);
      const backingHeight =
        measured ? offscreenHeight : Math.round(height * scale);
      output.textContent =
        `${measured ? '' : '≈ '}${backingWidth} × ${backingHeight}`;
      output.title = measured
        ? 'Current measured backing buffer'
        : 'Estimated backing resolution';
    }
  }

  // Serialize writes so a slower earlier write cannot replace newer intent.
  function persistSettings(patch: RendererSettingsPatch) {
    const operation = settingsWrite.then(async () => {
      const saved = await window.gwNative.settings.set(patch);
      currentSettings = saved;
      fillForm(saved);
      window.gwApplySettings?.(saved);
      return saved;
    });
    settingsWrite = operation.catch(() => undefined);
    return operation;
  }

  async function recoverSettingsAfterFailedWrite(message: string): Promise<void> {
    currentSettings = await window.gwNative.settings.get().catch(() => null);
    if (currentSettings) {
      fillForm(currentSettings);
      window.gwApplySettings?.(currentSettings);
    } else {
      form.setAttribute('aria-busy', 'true');
      settingsPanes.inert = true;
    }
    setFeedback(
      currentSettings
        ? message
        : 'GWonMac could not confirm the active settings. Close and reopen Settings before retrying.',
      'error',
    );
  }

  const shortcutSettings = import('./settings-shortcuts.js').then((module) =>
    module.bindShortcutSettings({
      form,
      dialog,
      restore: byId('settings-shortcuts-restore'),
      settings: () => currentSettings,
      persist: (shortcutOverrides) => persistSettings({ shortcutOverrides }),
      recoverAfterPersistFailure: recoverSettingsAfterFailedWrite,
      feedback: setFeedback,
    }));
  const travelPreferenceSettings = import('./settings-travel-preferences.js')
    .then((module) => module.bindTravelPreferenceSettings({
      limit: travelRecentLimit,
      clear: travelRecentsClear,
      current: () => currentTravelPreferences,
      accept: (preferences) => {
        currentTravelPreferences = preferences;
      },
      renderSettings: () => {
        if (currentSettings) fillForm(currentSettings);
      },
      feedback: setFeedback,
    }));
  void import('./settings-accounts.js').then((module) =>
    module.bindAccountSettings({
      enable: accountsEnable,
      status: accountsStatus,
      modeStatus: accountsModeStatus,
      singleSetup: accountsSingleSetup,
      multiActive: accountsMultiActive,
      returnSingle: accountsReturnSingle,
    }));

  const extendedMemorySetting = import('./extended-memory-setting.js')
    .then((module) => module.bindExtendedMemorySetting(document));
  const dataStrategy = import('./settings-data-strategy.js')
    .then((module) => module.bindSettingsDataStrategy(document, {
      loadSettings,
      persistSettings,
      feedback: setFeedback,
      milestone: launcherMilestone,
      dialogOpen: () => dialog.open,
    }));

  window.gwNative.settings.onChange((settings) => {
    currentSettings = settings;
    fillForm(settings);
    window.gwApplySettings?.(settings);
  });

  function requestUpdateCheck() {
    void updateAction?.check();
  }

  // The pane reads the game's mounted template directories, so it is refreshed
  // when it binds and whenever Templates is selected. The mount appears when
  // the client boots and vanishes when it dies, and neither is an event this
  // renderer is told about.
  void import('./template-pane.js')
    .then((module) => {
      templatePane = module.bindTemplatePane(document, {
        exportToDisk: (entries) => window.gwNative.templates.export(entries),
        readClipboard: () => window.gwNative.clipboard.readText(),
      });
      const fileSaving = currentSession?.compatibility?.features.gameFileSaving;
      templatePane.setAvailability(
        fileSaving?.status === 'unavailable' ? fileSaving.reason : null,
      );
      templatePane.refresh();
    })
    .catch(() => {
      byId('templates-status').textContent =
        'Build template import and export are unavailable in this build.';
      byId('templates-actions').hidden = true;
      byId('templates-help').hidden = true;
    });

  void import('./update-action.js')
    .then((module) => {
      const action = module.createUpdateAction({
        getState: () => window.gwNative.appUpdates.getState(),
        check: () => window.gwNative.appUpdates.check(),
        restartAndInstall: () =>
          window.gwNative.appUpdates.restartAndInstall(),
        onState: (listener) => window.gwNative.appUpdates.onState(listener),
      });
      updateAction = action;
      module.bindUpdateActionDom(
        document,
        action,
        () => window.gwNative.app.openExternal('releases'),
        () => window.gwNative.client.retry(),
      );
      void action.initialize();
    })
    .catch(() => {
      const updateCheck = byId('settings-check-updates') as HTMLButtonElement;
      const compatibilityCheck = byId('client-compat-check') as HTMLButtonElement;
      const compatibilityRestart = byId('client-compat-restart') as HTMLButtonElement;
      const launcherCheck = byId('loading-update-check');
      const updateStatus = byId('settings-update-status');
      updateCheck.disabled = true;
      compatibilityCheck.disabled = true;
      compatibilityRestart.disabled = true;
      launcherCheck.hidden = true;
      updateStatus.textContent = 'Update checking is unavailable in this build.';
      updateStatus.hidden = false;
      for (const id of ['settings-open-releases', 'client-compat-releases']) {
        byId(id).addEventListener('click', () => {
          void window.gwNative.app.openExternal('releases');
        });
      }
    });

  /**
   * Read the session once and render both surfaces. Neither the running app
   * version nor the client's certification can change without a relaunch, so
   * this asks the main process once and remembers the answer.
   */
  async function readSession(force = false) {
    // The version is known from the first launch, the certification only once
    // a client has been activated, so an early answer is not cached as final.
    if (!force && currentSession?.compatibility) return currentSession;
    const session = await window.gwNative.client.session();
    currentSession = session;
    const { renderClientCompatibility } =
      await import('./client-compatibility-notice.js');
    renderClientCompatibility(
      document,
      session,
    );
    const fileSaving = session.compatibility?.features.gameFileSaving;
    templatePane?.setAvailability(
      fileSaving?.status === 'unavailable' ? fileSaving.reason : null,
    );
    if (currentSettings) {
      const setting = await extendedMemorySetting;
      setting.render(currentSettings.extendedMemoryEnabled, session.extendedMemory);
    }
    return session;
  }

  window.addEventListener('gwonmac:client-compatibility-changed', () => {
    void readSession(true).catch(() => undefined);
  });

  /**
   * The launcher half. It runs after the data-strategy gate and only while
   * something is actually degraded, and it warns once per ArenaNet build:
   * a boolean would either nag every launch or stay silent through the next
   * client update, and both are wrong.
   */
  async function resolveClientCompatibility(): Promise<void> {
    let session: ClientSession;
    try {
      session = await readSession();
    } catch {
      return;
    }
    const compatibility = session.compatibility;
    if (!compatibility) return;
    const compatibilityNotice =
      await import('./client-compatibility-notice.js');
    const report = compatibilityNotice.compatibilityReport(compatibility);
    if (!report.degraded) return;
    const settings = await loadSettings().catch(() => null);
    if (
      report.acknowledgePerBuild
      && settings?.compatibilityNoticeSeenFor === compatibility.clientSha256
    ) return;

    return compatibilityNotice.showCompatibilityNotice(
      document,
      () => report.acknowledgePerBuild
        ? persistSettings({
            compatibilityNoticeSeenFor: compatibility.clientSha256,
          })
        : Promise.resolve(),
    );
  }

  function patchForControl(
    control: HTMLInputElement | HTMLSelectElement,
  ): RendererSettingsPatch | null {
    switch (control.name) {
      case 'renderScale': {
        const value = Number(control.value);
        return value === 1 || value === 1.5 || value === 2
          ? { renderScale: value }
          : null;
      }
      case 'uiStyle':
        return control.value === 'guild-wars' || control.value === 'obsidian'
          ? { uiStyle: control.value }
          : null;
      case 'uiFont':
        return control.value === 'guild-wars' || control.value === 'inter'
          ? { uiFont: control.value }
          : null;
      case 'uiPanelOpacity':
      {
        // The slider's own min/max/step are the bounds; a value outside them
        // is a broken control, not a choice, and `main` would refuse it.
        const value = Number(control.value);
        return Number.isSafeInteger(value) ? { [control.name]: value } : null;
      }
      case 'showDiagnostics':
        return control instanceof globalThis.HTMLInputElement
          ? { showDiagnostics: control.checked }
          : null;
      case 'extendedMemoryEnabled':
        return control instanceof globalThis.HTMLInputElement
          ? { extendedMemoryEnabled: control.checked }
          : null;
      case 'gwonmacTools':
      case 'teamManagement':
      case 'xunlaiStorage':
      case 'travelPalette':
      case 'targetReadout':
        return control instanceof globalThis.HTMLInputElement
          ? { [control.name]: control.checked }
          : null;
      case 'autoCheckUpdates':
        return control instanceof globalThis.HTMLInputElement
          ? { autoCheckUpdates: control.checked }
          : null;
      case 'updateTrack':
        return control.value === 'stable' || control.value === 'beta'
          ? { updateTrack: control.value }
          : null;
      default:
        return null;
    }
  }

  /** Each slider's `output`, so the number a player is dragging is readable. */
  function showAppearanceValues(settings: AppSettings) {
    for (const { name, suffix } of appearanceRanges) {
      const output = appearanceOutput(name);
      if (output) output.value = `${settings[name]}${suffix}`;
    }
  }

  function fillForm(
    settings: AppSettings,
    travelPreferences = currentTravelPreferences,
  ) {
    renderScale.value = String(settings.renderScale);
    uiStyle.value = settings.uiStyle;
    uiFont.value = settings.uiFont;
    for (const { name } of appearanceRanges) {
      const range = appearanceRange(name);
      if (range) range.value = String(settings[name]);
    }
    showAppearanceValues(settings);
    showDiagnostics.checked = settings.showDiagnostics;
    extendedMemoryEnabled.checked = settings.extendedMemoryEnabled;
    gwonmacTools.checked = settings.gwonmacTools;
    teamManagement.checked = settings.teamManagement;
    xunlaiStorage.checked = settings.xunlaiStorage;
    travelPalette.checked = settings.travelPalette;
    targetReadout.checked = settings.targetReadout;
    void shortcutSettings.then((binder) => binder.render(settings));
    toolFeatures.hidden = !settings.gwonmacTools;
    toolsOff.hidden = settings.gwonmacTools;
    teamManagement.disabled = !settings.gwonmacTools;
    xunlaiStorage.disabled = !settings.gwonmacTools;
    travelPalette.disabled = !settings.gwonmacTools;
    void travelPreferenceSettings.then((binder) =>
      binder.render(settings.gwonmacTools, travelPreferences));
    targetReadout.disabled = !settings.gwonmacTools;
    autoCheckUpdates.checked = settings.autoCheckUpdates;
    updateTrack.value = settings.updateTrack;
    void extendedMemorySetting.then((setting) => {
      setting.render(settings.extendedMemoryEnabled, currentSession?.extendedMemory ?? null);
    });
    void dataStrategy.then((controller) => controller.renderSettings(settings));
    updateRenderScaleDimensions();
  }

  window.gwResolveDataStrategy = async (snapshotBytes) => {
    await (await dataStrategy).resolve(snapshotBytes);
    await resolveClientCompatibility();
  };
  async function openSettings() {
    const wasOpen = dialog.open;
    const needsSettings = currentSettings === null;
    form.setAttribute('aria-busy', String(needsSettings));
    settingsPanes.inert = needsSettings;
    if (!wasOpen) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    setFeedback(needsSettings ? 'Loading settings…' : idleFeedback, needsSettings ? 'progress' : 'neutral');
    selectPane(activeSettingsPane);
    if (!wasOpen) {
      form.querySelector<HTMLElement>('.settings-rtab[aria-selected="true"]')
        ?.focus({ preventScroll: true });
    }
    settingsCache.textContent = 'Checking downloaded game data…';
    try {
      await settingsWrite;
      [currentSettings, currentTravelPreferences] = await Promise.all([
        window.gwNative.settings.get(),
        window.gwNative.travelPreferences.get(),
      ]);
      fillForm(currentSettings);
      // "Last checked 4 minutes ago" goes stale while a window sits open.
      // The client build's status is the answer to "why is my cursor plain?",
      // so it is in Settings whether or not the launcher notice was ever seen.
      await readSession().catch(() => undefined);
      await (await dataStrategy).refresh();
      if (feedback.textContent === 'Loading settings…') setFeedback();
    } catch {
      setFeedback('Settings could not be loaded. Close Settings and try again.', 'error');
    } finally {
      form.setAttribute('aria-busy', 'false');
      settingsPanes.inert = false;
    }
  }

  window.addEventListener('gw:settings', (event) => {
    const detail = event instanceof globalThis.CustomEvent
      ? event.detail as {
          pane?: import('../shared/contracts.js').SettingsPane;
          checkForUpdates?: boolean;
        } | undefined
      : undefined;
    if (detail?.pane) selectPane(detail.pane);
    void openSettings().then(() => {
      if (detail?.checkForUpdates) requestUpdateCheck();
    });
  });

  // A slider's readout follows the thumb; the save waits for `change`, which
  // is the drag ending. Writing on every `input` would put one settings write
  // per pixel of travel through the IPC seam.
  form.addEventListener('input', (event) => {
    const control = event.target;
    if (!(control instanceof globalThis.HTMLInputElement)) return;
    const range = appearanceRanges.find(({ name }) => name === control.name);
    if (!range) return;
    const output = appearanceOutput(range.name);
    if (output) output.value = `${control.value}${range.suffix}`;
  });

  form.addEventListener('change', (event) => {
    const control = event.target;
    if (
      !(control instanceof globalThis.HTMLInputElement) &&
      !(control instanceof globalThis.HTMLSelectElement)
    ) return;
    if (control.name === 'dataStrategy') {
      void dataStrategy.then((controller) => controller.saveSelectedStrategy());
      return;
    }
    if (control.name === 'travelRecentLimit') return;
    const patch = patchForControl(control);
    if (!patch) return;
    setFeedback('Saving…', 'progress');
    void persistSettings(patch)
      .then((saved) => {
        if (
          patch.gwonmacTools !== undefined
          && saved.gwonmacTools !== patch.gwonmacTools
        ) {
          setFeedback('Optional Tools were not changed. Your current setup is still active.', 'warning');
          return;
        }
        if (patch.extendedMemoryEnabled !== undefined) {
          setFeedback('Saved. Restart GWonMac to apply the memory limit.', 'success', 4500);
          return;
        }
        setFeedback('Saved.', 'success', 2200);
      })
      .catch(() => recoverSettingsAfterFailedWrite(
        'Close and reopen Settings to confirm which value is active before retrying.',
      ));
  });

  byId('settings-reveal-data')?.addEventListener('click', () => {
    void window.gwNative.app.reveal('gameData');
  });

  byId('settings-clear-cache')?.addEventListener('click', async () => {
    setFeedback();
    try {
      await window.gwNative.cache.clearAndRestart();
    } catch {
      setFeedback('Game data could not be cleared. Nothing was removed; try again.', 'error');
    }
  });

  settingsReset.addEventListener('click', async () => {
    setFeedback();
    try {
      const outcome = await window.gwNative.settings.reset();
      if (!outcome) return;
      currentSettings = outcome.settings;
      currentTravelPreferences = outcome.travelPreferences;
      fillForm(outcome.settings, outcome.travelPreferences);
      window.gwApplySettings?.(outcome.settings);
      if (outcome.status === 'partial') {
        setFeedback(
          outcome.travelPreferences === null
            ? 'GWonMac settings were reset, but Travel preferences could not be confirmed. Close and reopen Settings before retrying.'
            : 'GWonMac settings were reset, but Travel preferences could not be reset. Choose Reset GWonMac settings again to finish.',
          'warning',
        );
      } else {
        setFeedback(
          'GWonMac settings and Travel preferences were reset. Choose a download mode next launch.',
          'success',
          4500,
        );
      }
    } catch {
      currentSettings = null;
      currentTravelPreferences = null;
      form.setAttribute('aria-busy', 'true');
      settingsPanes.inert = true;
      setFeedback('GWonMac could not confirm whether settings were reset. Close and reopen Settings to review the active values.', 'error');
    }
  });

  window.addEventListener('resize', updateRenderScaleDimensions);
  window.addEventListener('gw:graphics-resized', updateRenderScaleDimensions);
})();
