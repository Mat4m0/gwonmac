/**
 * One owner for launcher strategy, full-download presentation, and Settings.
 * Cache residency is the download-progress truth; dataStrategy is only intent.
 *
 * index.html loads this as a classic script, so the file carries no top-level
 * import or export and names the contracts through type-only `import(…)`.
 */

(function () {
  type AppSettings = import('../shared/contracts.js').AppSettings;
  type AppSettingsPatch = import('../shared/contracts.js').AppSettingsPatch;
  type ClientSession = import('../shared/contracts.js').ClientSession;
  type RendererMilestone =
    import('../shared/diagnostics.js').RendererMilestone;
  type UpdateAction = import('./update-action.js').UpdateAction;
  type ShortcutAction = import('../shared/keyboard-shortcuts.js').ShortcutAction;
  type ShortcutBinding = import('../shared/keyboard-shortcuts.js').ShortcutBinding;

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
  let settingsLoad: Promise<AppSettings> | null = null;
  let settingsWrite: Promise<unknown> = Promise.resolve();
  type FeedbackTone = 'neutral' | 'progress' | 'success' | 'warning' | 'error';
  const idleFeedback = 'Changes save automatically.';
  let feedbackTimer: number | null = null;
  let activeSettingsPane = 'data';
  let recordingShortcut: ShortcutAction | null = null;
  let pendingShortcutReplacement:
    | { action: ShortcutAction; conflict: ShortcutAction; binding: ShortcutBinding }
    | null = null;

  const shortcutModule = import('../shared/keyboard-shortcuts.js');
  const shortcutRows = new Map<ShortcutAction, HTMLElement>(
    [...form.querySelectorAll<HTMLElement>('[data-shortcut-action]')].map((row) => [
      row.dataset.shortcutAction as ShortcutAction,
      row,
    ]),
  );

  function shortcutRowParts(action: ShortcutAction) {
    const row = shortcutRows.get(action);
    if (!row) throw new Error(`missing shortcut row: ${action}`);
    const value = row.querySelector<HTMLElement>('.settings-shortcut-value');
    const change = row.querySelector<HTMLButtonElement>('.settings-shortcut-change');
    const message = row.querySelector<HTMLElement>('.settings-shortcut-message');
    const replace = row.querySelector<HTMLButtonElement>('.settings-shortcut-replace');
    if (!value || !change || !message || !replace) {
      throw new Error(`incomplete shortcut row: ${action}`);
    }
    return { value, change, message, replace };
  }

  function clearShortcutMessages(): void {
    for (const action of shortcutRows.keys()) {
      const { message, replace } = shortcutRowParts(action);
      message.textContent = '';
      message.hidden = true;
      replace.hidden = true;
    }
  }

  async function renderShortcuts(settings: AppSettings): Promise<void> {
    const { resolveShortcuts, shortcutDisplay } = await shortcutModule;
    const resolved = resolveShortcuts(settings.shortcutOverrides);
    for (const action of shortcutRows.keys()) {
      const { value, change } = shortcutRowParts(action);
      value.textContent = recordingShortcut === action
        ? 'Listening…'
        : shortcutDisplay(resolved[action]);
      change.textContent = recordingShortcut === action ? 'Cancel' : 'Change';
    }
  }

  async function saveShortcutOverrides(
    overrides: AppSettings['shortcutOverrides'],
  ): Promise<void> {
    setFeedback('Saving…', 'progress');
    try {
      await persistSettings({ shortcutOverrides: overrides });
      setFeedback('Shortcut saved.', 'success', 2200);
    } catch {
      setFeedback('The shortcut could not be saved. Your previous shortcuts are still active; try again.', 'error');
    }
  }

  async function recordShortcut(action: ShortcutAction): Promise<void> {
    if (!currentSettings) return;
    if (recordingShortcut === action) {
      await window.gwNative.shortcuts.cancelCapture();
      return;
    }
    if (recordingShortcut) await window.gwNative.shortcuts.cancelCapture();
    recordingShortcut = action;
    pendingShortcutReplacement = null;
    clearShortcutMessages();
    await renderShortcuts(currentSettings);
    const parts = shortcutRowParts(action);
    parts.message.textContent =
      'Press Command with a letter or number · Delete clears · Escape cancels.';
    parts.message.hidden = false;
    const result = await window.gwNative.shortcuts.capture();
    if (recordingShortcut !== action) return;
    recordingShortcut = null;
    if (result.status === 'cancelled') {
      clearShortcutMessages();
      await renderShortcuts(currentSettings);
      parts.change.focus();
      return;
    }
    if (result.status === 'invalid') {
      parts.message.textContent = 'Use Command with one letter or number.';
      parts.message.hidden = false;
      await renderShortcuts(currentSettings);
      parts.change.focus();
      return;
    }
    let next = { ...currentSettings.shortcutOverrides };
    if (result.status === 'cleared') {
      clearShortcutMessages();
      const { withShortcutOverride } = await shortcutModule;
      next = withShortcutOverride(next, action, null);
      await saveShortcutOverrides(next);
      parts.change.focus();
      return;
    }
    const {
      resolveShortcuts,
      shortcutConflict,
      shortcutDisplay,
      shortcutReserved,
      SHORTCUT_LABELS,
      withShortcutOverride,
    } = await shortcutModule;
    if (shortcutReserved(result.binding)) {
      parts.message.textContent = `${shortcutDisplay(result.binding)} is reserved by macOS or GWonMac.`;
      parts.message.hidden = false;
      await renderShortcuts(currentSettings);
      parts.change.focus();
      return;
    }
    const conflict = shortcutConflict(
      action,
      result.binding,
      resolveShortcuts(currentSettings.shortcutOverrides),
    );
    if (conflict) {
      pendingShortcutReplacement = { action, conflict, binding: result.binding };
      parts.message.textContent = `${shortcutDisplay(result.binding)} is used by ${SHORTCUT_LABELS[conflict]}.`;
      parts.message.hidden = false;
      parts.replace.hidden = false;
      await renderShortcuts(currentSettings);
      parts.replace.focus();
      return;
    }
    next = withShortcutOverride(next, action, result.binding);
    clearShortcutMessages();
    await saveShortcutOverrides(next);
    parts.change.focus();
  }

  for (const [action, row] of shortcutRows) {
    row.querySelector<HTMLButtonElement>('.settings-shortcut-change')
      ?.addEventListener('click', () => void recordShortcut(action));
    row.querySelector<HTMLButtonElement>('.settings-shortcut-replace')
      ?.addEventListener('click', () => {
        const replacement = pendingShortcutReplacement;
        if (!replacement || replacement.action !== action || !currentSettings) return;
        const settings = currentSettings;
        void shortcutModule.then(({ withShortcutOverride }) => {
          let next = withShortcutOverride(
            settings.shortcutOverrides,
            replacement.conflict,
            null,
          );
          next = withShortcutOverride(next, action, replacement.binding);
          pendingShortcutReplacement = null;
          clearShortcutMessages();
          void saveShortcutOverrides(next)
            .then(() => shortcutRowParts(action).change.focus());
        });
      });
  }

  byId('settings-shortcuts-restore').addEventListener('click', () => {
    pendingShortcutReplacement = null;
    clearShortcutMessages();
    void saveShortcutOverrides({});
  });
  dialog.addEventListener('close', () => {
    if (recordingShortcut) void window.gwNative.shortcuts.cancelCapture();
    recordingShortcut = null;
    pendingShortcutReplacement = null;
    clearShortcutMessages();
  });
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
  function persistSettings(patch: AppSettingsPatch) {
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
  ): AppSettingsPatch | null {
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

  function fillForm(settings: AppSettings) {
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
    void renderShortcuts(settings);
    toolFeatures.hidden = !settings.gwonmacTools;
    toolsOff.hidden = settings.gwonmacTools;
    teamManagement.disabled = !settings.gwonmacTools;
    xunlaiStorage.disabled = !settings.gwonmacTools;
    travelPalette.disabled = !settings.gwonmacTools;
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
      currentSettings = await window.gwNative.settings.get();
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
      .catch(() => {
        if (currentSettings) {
          fillForm(currentSettings);
          window.gwApplySettings?.(currentSettings);
        }
        setFeedback('Settings could not be saved. Your previous setting is still active; try again.', 'error');
      });
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
      const reset = await window.gwNative.settings.reset();
      if (!reset) return;
      currentSettings = reset;
      fillForm(reset);
      window.gwApplySettings?.(reset);
      setFeedback(
        'GWonMac settings were reset. Choose a download mode next launch.',
        'success',
        4500,
      );
    } catch {
      setFeedback('GWonMac settings could not be reset. Nothing changed; try again.', 'error');
    }
  });

  accountsEnable.addEventListener('click', async () => {
    if (!window.confirm('Enable Multiple Accounts and restart GWonMac? Your current Single Account data will stay untouched.')) return;
    accountsEnable.disabled = true;
    accountsStatus.textContent = 'Creating the separate workspace…';
    try {
      const { exportEntries, templateFilesystem } = await import('./template-store.js');
      const filesystem = templateFilesystem();
      await window.gwNative.accounts.setup({
        templateEntries: filesystem ? exportEntries(filesystem) : [],
      });
    } catch {
      accountsEnable.disabled = false;
      accountsStatus.textContent = 'Multiple Accounts could not be enabled. Nothing changed.';
    }
  });

  accountsReturnSingle.addEventListener('click', async () => {
    if (!window.confirm('Return to Single Account mode? GWonMac will restart. Multiple Accounts and Single Account data will both be preserved.')) return;
    accountsReturnSingle.disabled = true;
    accountsModeStatus.textContent = 'Restarting in Single Account mode…';
    try {
      await window.gwNative.accounts.useSingle();
    } catch {
      accountsReturnSingle.disabled = false;
      accountsModeStatus.textContent = 'The mode change could not be saved. Nothing changed.';
    }
  });

  void window.gwNative.accounts.get().then((state) => {
    const singleMode = state.mode === 'single';
    const activeProfiles = state.profiles.filter((profile) => !profile.archived);
    const existingWorkspace = singleMode && activeProfiles.length > 0;
    accountsModeStatus.textContent = existingWorkspace
      ? `Single Account mode is active. Your ${activeProfiles.length} Multiple Accounts ${activeProfiles.length === 1 ? 'account is' : 'accounts are'} ready to restore.`
      : singleMode
        ? 'Single Account mode is active.'
      : 'Multiple Accounts mode is active. Use the Account Picker to open and manage accounts.';
    accountsSingleSetup.hidden = !singleMode;
    accountsMultiActive.hidden = singleMode;
    if (existingWorkspace) {
      accountsEnable.textContent = 'Restore Multiple Accounts and Restart…';
    }
  }).catch(() => {
    accountsModeStatus.textContent = 'Account mode could not be read.';
    accountsSingleSetup.hidden = true;
    accountsMultiActive.hidden = true;
  });

  window.addEventListener('resize', updateRenderScaleDimensions);
  window.addEventListener('gw:graphics-resized', updateRenderScaleDimensions);
})();
