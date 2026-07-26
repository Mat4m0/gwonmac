// One owner for launcher strategy, full-download presentation, and Settings.
// Cache residency is the download-progress truth; dataStrategy is only intent.

(function () {
  /** @param {string} id */
  const byId = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`missing renderer element: ${id}`);
    return element;
  };
  const dialog =
    /** @type {HTMLDialogElement} */ (byId('settings-dialog'));
  const form = /** @type {HTMLFormElement} */ (byId('settings-form'));
  const settingsDownload =
    /** @type {HTMLButtonElement} */ (byId('settings-download-full'));
  const settingsReset =
    /** @type {HTMLButtonElement} */ (byId('settings-reset-launcher'));
  const settingsCache = byId('settings-cache');
  const settingsDataNote = byId('settings-data-note');
  const settingsSaved = byId('settings-saved');
  const settingsProgress = byId('settings-progress');
  const settingsProgressFill = byId('settings-progress-fill');
  const settingsPanes =
    /** @type {HTMLElement} */ (form.querySelector('.settings-panes'));
  const feedback = byId('settings-feedback');
  const dataChoice = byId('data-choice');
  const dataChoiceQuick =
    /** @type {HTMLButtonElement} */ (byId('data-choice-quick'));
  const dataChoiceFull =
    /** @type {HTMLButtonElement} */ (byId('data-choice-full'));
  const dataChoiceFullSize = byId('data-choice-full-size');
  const dataDownload = byId('data-download');
  const dataDownloadStatus = byId('data-download-status');
  const dataDownloadDetail = byId('data-download-detail');
  const dataDownloadFill = byId('data-download-fill');
  const dataDownloadToggle =
    /** @type {HTMLButtonElement} */ (byId('data-download-toggle'));
  const dataDownloadPlay =
    /** @type {HTMLButtonElement} */ (byId('data-download-play'));
  const dataDownloadQuick =
    /** @type {HTMLButtonElement} */ (byId('data-download-quick'));
  const renderScale =
    /** @type {HTMLSelectElement} */ (form.elements.namedItem('renderScale'));
  const touchMode =
    /** @type {HTMLSelectElement} */ (form.elements.namedItem('touchMode'));
  const showDiagnostics =
    /** @type {HTMLInputElement} */ (form.elements.namedItem('showDiagnostics'));
  const autoCheckUpdates =
    /** @type {HTMLInputElement} */ (
      form.elements.namedItem('autoCheckUpdates')
    );
  const choiceAutoUpdates =
    /** @type {HTMLInputElement} */ (byId('data-choice-auto-updates'));
  /** @type {import('./update-action.js').UpdateAction | null} */
  let updateAction = null;

  /** @type {import('../shared/contracts.js').ClientSession | null} */
  let currentSession = null;

  /** @type {import('../shared/contracts.js').AppSettings | null} */
  let currentSettings = null;
  /** @type {Promise<import('../shared/contracts.js').AppSettings> | null} */
  let settingsLoad = null;
  /** @type {Promise<unknown>} */
  let settingsWrite = Promise.resolve();
  /** @type {import('../shared/contracts.js').CacheInfo | null} */
  let currentCache = null;
  /** @type {Promise<boolean> | null} */
  let fullDownloadPromise = null;
  /** @type {'idle' | 'running' | 'stopping'} */
  let downloadPhase = 'idle';
  // Only ever the "image" phase: the dock renders a running download, and a
  // failure arrives as the download's own outcome, not as a progress event.
  /** @type {import('../shared/contracts.js').DownloadActivity | null} */
  let currentDownloadProgress = null;
  let downloadError = '';
  /** @type {(() => void) | null} */
  let launcherResolve = null;
  let launcherTotalBytes = 0;
  /** @type {number | null} */
  let savedTimer = null;
  let activeSettingsPane = 'data';
  const downloadActive = () =>
    downloadPhase === 'running' || downloadPhase === 'stopping';

  // Auto-save proof: a brief "Saved" note in the header when a change lands.
  function flashSaved() {
    if (!settingsSaved) return;
    settingsSaved.classList.add('show');
    if (savedTimer !== null) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => settingsSaved.classList.remove('show'), 1400);
  }

  /** @param {string} name */
  function selectPane(name) {
    activeSettingsPane = name;
    settingsPanes.dataset.active = name;
    for (const tab of /** @type {NodeListOf<HTMLElement>} */ (
      form.querySelectorAll('.settings-rtab')
    )) {
      const selected = tab.dataset.pane === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  }

  const railTabs = [.../** @type {NodeListOf<HTMLElement>} */ (
    form.querySelectorAll('.settings-rtab')
  )];
  for (const tab of railTabs) {
    tab.addEventListener('click', () => {
      if (tab.dataset.pane) selectPane(tab.dataset.pane);
    });
  }

  // Roving tabindex: arrows move between sections, Home/End jump.
  form.querySelector('.settings-rail')?.addEventListener('keydown', (rawEvent) => {
    const event = /** @type {KeyboardEvent} */ (rawEvent);
    const active = document.activeElement;
    const index =
      active instanceof globalThis.HTMLElement ? railTabs.indexOf(active) : -1;
    if (index < 0) return;
    let target = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      target = railTabs[(index + 1) % railTabs.length];
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
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

  /** @param {number} bytes */
  const size = (bytes) => bytes >= 1_073_741_824
    ? `${(bytes / 1_073_741_824).toFixed(2)} GB`
    : `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;

  /** @param {import('../shared/diagnostics.js').RendererMilestone} name */
  const launcherMilestone = (name) => {
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
    for (const output of /** @type {NodeListOf<HTMLElement>} */ (
      form.querySelectorAll('[data-render-scale]')
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
  /** @param {import('../shared/contracts.js').AppSettingsPatch} patch */
  function persistSettings(patch) {
    const operation = settingsWrite.then(async () => {
      const saved = await window.gwNative.settings.set(patch);
      currentSettings = saved;
      toolSettings.render(saved);
      window.gwApplySettings?.(saved);
      return saved;
    });
    settingsWrite = operation.catch(() => undefined);
    return operation;
  }

  // Both tool surfaces are rendered from the settings main returned, never
  // from requested state. Declining the required restart therefore restores
  // what is actually running.
  const toolSettings = window.gwToolSettings.create({
    form,
    byId,
    selection: window.gwNative.init.toolboxSelection,
    persist: persistSettings,
    current: () => currentSettings,
  });

  function requestUpdateCheck() {
    void updateAction?.check();
  }

  void import('./update-action.js')
    .then((module) => {
      const action = module.createUpdateAction({
        check: () => window.gwNative.releaseNotice.check(),
        remember: (checkedAt) => persistSettings({ lastUpdateCheckAt: checkedAt }),
      });
      updateAction = action;
      module.bindUpdateActionDom(
        document,
        action,
        () => window.gwNative.app.openExternal('releases'),
      );
      void loadSettings()
        .then((settings) => {
          action.restore(settings.lastUpdateCheckAt);
          // The only automatic check the renderer makes, and it is off by
          // default. Every other automatic trigger reads the same flag: one
          // answer governs every request the user did not ask for.
          if (settings.autoCheckUpdates) void action.check();
        })
        .catch(() => undefined);
    })
    .catch(() => {
      const updateCheck =
        /** @type {HTMLButtonElement} */ (byId('settings-check-updates'));
      const compatibilityCheck =
        /** @type {HTMLButtonElement} */ (byId('client-compat-check'));
      const launcherCheck = byId('loading-update-check');
      const updateStatus = byId('settings-update-status');
      updateCheck.disabled = true;
      compatibilityCheck.disabled = true;
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
  async function readSession() {
    // The version is known from the first launch, the certification only once
    // a client has been activated, so an early answer is not cached as final.
    if (currentSession?.compatibility) return currentSession;
    const session = await window.gwNative.client.session();
    currentSession = session;
    const { renderClientCompatibility } =
      await import('./client-compatibility-notice.js');
    renderClientCompatibility(
      document,
      session,
      window.gwNative.init.toolboxSelection,
    );
    return session;
  }

  /**
   * The launcher half. It runs after the data-strategy gate and only while
   * something is actually degraded, and it warns once per ArenaNet build:
   * a boolean would either nag every launch or stay silent through the next
   * client update, and both are wrong.
   *
   * @returns {Promise<void>}
   */
  async function resolveClientCompatibility() {
    /** @type {import('../shared/contracts.js').ClientSession} */
    let session;
    try {
      session = await readSession();
    } catch {
      return;
    }
    const compatibility = session.compatibility;
    if (!compatibility) return;
    const compatibilityNotice =
      await import('./client-compatibility-notice.js');
    if (!compatibilityNotice.compatibilityReport(
      compatibility,
      window.gwNative.init.toolboxSelection,
    ).degraded) return;
    const settings = await loadSettings().catch(() => null);
    if (settings?.compatibilityNoticeSeenFor === compatibility.clientSha256) return;

    return compatibilityNotice.showCompatibilityNotice(
      document,
      () => persistSettings({
        // Acknowledged for this build only: the next ArenaNet update warns
        // again.
        compatibilityNoticeSeenFor: compatibility.clientSha256,
      }),
    );
  }

  function cacheComplete(cache = currentCache) {
    return !!cache?.totalBytes && cache.bytes >= cache.totalBytes;
  }

  /** @param {import('../shared/contracts.js').CacheInfo | null} cache */
  function cacheStatus(cache) {
    if (!cache?.totalBytes) return 'Game data is still preparing…';
    if (cacheComplete(cache)) {
      return `Full game ready · ${size(cache.bytes)} downloaded`;
    }
    return `${size(cache.bytes)} of ${size(cache.totalBytes)} downloaded`;
  }

  function selectedStrategy() {
    const selected =
      /** @type {HTMLInputElement | null} */ (
        form.querySelector('input[name="dataStrategy"]:checked')
      );
    return selected?.value === 'quick' || selected?.value === 'full'
      ? selected.value
      : null;
  }

  /**
   * @param {HTMLInputElement | HTMLSelectElement} control
   * @returns {import('../shared/contracts.js').AppSettingsPatch | null}
   */
  function patchForControl(control) {
    const toolPatch = toolSettings.patchFor(control);
    if (toolPatch) return toolPatch;
    switch (control.name) {
      case 'renderScale': {
        const value = Number(control.value);
        return value === 1 || value === 1.5 || value === 2
          ? { renderScale: value }
          : null;
      }
      case 'touchMode': {
        const value = control.value;
        return value === 'dbltap' ||
          value === 'translate' ||
          value === 'augment' ||
          value === 'off'
          ? { touchMode: value }
          : null;
      }
      case 'showDiagnostics':
        return control instanceof globalThis.HTMLInputElement
          ? { showDiagnostics: control.checked }
          : null;
      case 'autoCheckUpdates':
        return control instanceof globalThis.HTMLInputElement
          ? { autoCheckUpdates: control.checked }
          : null;
      case 'dataStrategy':
        return { dataStrategy: selectedStrategy() };
      default:
        return null;
    }
  }

  /** @param {import('../shared/contracts.js').AppSettings} settings */
  function fillForm(settings) {
    renderScale.value = String(settings.renderScale);
    toolSettings.render(settings);
    touchMode.value = settings.touchMode;
    showDiagnostics.checked = settings.showDiagnostics;
    autoCheckUpdates.checked = settings.autoCheckUpdates;
    for (const radio of /** @type {NodeListOf<HTMLInputElement>} */ (
      form.querySelectorAll('input[name="dataStrategy"]')
    )) {
      radio.checked = radio.value === settings.dataStrategy;
    }
    updateRenderScaleDimensions();
  }

  function renderSettingsData(cache = currentCache) {
    currentCache = cache;
    settingsCache.textContent = cacheStatus(cache);
    const strategy = currentSettings?.dataStrategy ?? selectedStrategy();
    settingsDownload.hidden = strategy !== 'full';

    // The panel reuses the dock's progress language while data is incomplete.
    if (settingsProgress && settingsProgressFill) {
      const showBar =
        strategy === 'full' && !!cache?.totalBytes && !cacheComplete(cache);
      settingsProgress.hidden = !showBar;
      if (showBar) {
        const fraction = Math.min(1, (cache.bytes || 0) / cache.totalBytes);
        settingsProgressFill.style.width = `${fraction * 100}%`;
      }
    }

    if (strategy === null) {
      settingsDataNote.textContent =
        'Choose a mode here, or use the launcher choice on the next start.';
    } else if (strategy === 'quick') {
      settingsDataNote.textContent =
        'Guild Wars will start normally and download areas when needed.';
    } else if (cacheComplete(cache)) {
      settingsDataNote.textContent =
        'The full game is available locally. Future launches start normally.';
    } else {
      settingsDataNote.textContent =
        'The remaining data will download before Guild Wars starts next time.';
    }

    if (strategy !== 'full') return;
    // A status is never a button: once the download is complete, the status
    // line already says "Full game ready" and the action disappears.
    if (cacheComplete(cache)) {
      settingsDownload.hidden = true;
    } else if (downloadPhase === 'stopping') {
      settingsDownload.textContent = 'Stopping Download…';
      settingsDownload.disabled = true;
    } else if (downloadPhase === 'running') {
      settingsDownload.textContent = 'Pause Download';
      settingsDownload.disabled = false;
    } else if (!cache?.totalBytes) {
      settingsDownload.textContent = 'Start Downloading Now';
      settingsDownload.disabled = true;
    } else {
      settingsDownload.textContent = 'Start Downloading Now';
      settingsDownload.disabled = false;
    }
  }

  function renderLauncherDownload(cache = currentCache, error = downloadError) {
    currentCache = cache;
    const total = cache?.totalBytes || launcherTotalBytes;
    const received = cache?.bytes || 0;
    const complete = total > 0 && received >= total;
    const ready = complete && !error;
    const fraction = total > 0 ? Math.min(1, received / total) : 0;
    dataDownloadFill.style.width = `${fraction * 100}%`;

    if (error) {
      dataDownloadStatus.textContent = error;
      dataDownloadDetail.textContent =
        'Verified data is safe. Choose Resume Download to try again.';
    } else if (complete) {
      dataDownloadStatus.textContent = `Full game ready · ${size(received)} downloaded`;
      dataDownloadDetail.textContent =
        'Guild Wars will not start until you choose Play Guild Wars.';
    } else if (downloadPhase === 'stopping') {
      dataDownloadStatus.textContent = `Pausing · ${cacheStatus(cache)}`;
      dataDownloadDetail.textContent = 'Verified data is being preserved.';
    } else if (downloadPhase === 'running') {
      const progress = currentDownloadProgress;
      const rate = progress && progress.bytesPerSecond > 0
        ? ` · ${size(progress.bytesPerSecond)}/s avg`
        : '';
      const eta =
        progress &&
        progress.secondsRemaining !== null &&
        Number.isFinite(progress.secondsRemaining)
        ? ` · about ${Math.max(1, Math.ceil(progress.secondsRemaining / 60))} min left`
        : '';
      dataDownloadStatus.textContent = progress?.total
        ? `Downloading · ${size(received)} of ${size(total)}${rate}${eta}`
        : `Starting download · ${cacheStatus(cache)}`;
      dataDownloadDetail.textContent =
        'Guild Wars has not started. You can pause or close the launcher and continue later.';
    } else if (!downloadActive()) {
      dataDownloadStatus.textContent = `Download paused · ${cacheStatus(cache)}`;
      dataDownloadDetail.textContent =
        'You can resume now or close the launcher and continue later.';
    }

    dataDownloadToggle.hidden = ready;
    dataDownloadToggle.disabled = downloadPhase === 'stopping';
    dataDownloadToggle.textContent = downloadPhase === 'stopping'
      ? 'Pausing…'
      : downloadPhase === 'running'
        ? 'Pause Download'
        : 'Resume Download';
    dataDownloadPlay.textContent = ready ? 'Play Guild Wars' : 'Play Now Instead';
    dataDownloadQuick.hidden = ready;
  }

  async function refreshCache() {
    const cache = await window.gwNative.cache.info();
    currentCache = cache;
    renderSettingsData(cache);
    if (!dataDownload.hidden) renderLauncherDownload(cache);
    return cache;
  }

  function startFullDownload() {
    if (fullDownloadPromise) return fullDownloadPromise;
    downloadError = '';
    downloadPhase = 'running';
    currentDownloadProgress = null;
    renderSettingsData();
    if (!dataDownload.hidden) renderLauncherDownload();

    fullDownloadPromise = window.gwNative.cache.downloadAll()
      .then(async (outcome) => {
        // The download reports why it stopped, and the sentence for that
        // reason is written here rather than in the main process.
        downloadError = '';
        if (outcome.status === 'failed') {
          const { describeDownloadFailure } =
            await import('./failure-messages.js');
          downloadError = describeDownloadFailure(outcome.errorCode);
        }
        const cache = await window.gwNative.cache.info();
        currentCache = cache;
        renderSettingsData(cache);
        if (!dataDownload.hidden) renderLauncherDownload(cache);
        if (downloadError) {
          if (dialog.open) feedback.textContent = downloadError;
          return false;
        }
        if (outcome.status === 'stopped' && dialog.open) {
          settingsCache.textContent = `Download paused · ${cacheStatus(cache)}`;
        }
        return outcome.status === 'complete';
      })
      .catch(() => {
        // Only a broken bridge reaches here: the outcome above covers every
        // way the download itself can end.
        downloadError = 'The full game download could not continue.';
        if (dialog.open) feedback.textContent = downloadError;
        if (!dataDownload.hidden) {
          renderLauncherDownload(currentCache, downloadError);
        }
        return false;
      })
      .finally(async () => {
        downloadPhase = 'idle';
        currentDownloadProgress = null;
        fullDownloadPromise = null;
        await refreshCache().catch(() => {
          renderSettingsData(null);
          if (!dataDownload.hidden) {
            renderLauncherDownload(null, 'The download status is unavailable.');
          }
        });
      });
    return fullDownloadPromise;
  }

  async function stopFullDownload() {
    if (downloadPhase !== 'running') return;
    downloadPhase = 'stopping';
    renderSettingsData();
    if (!dataDownload.hidden) renderLauncherDownload();
    try {
      await window.gwNative.cache.stopDownload();
    } catch {
      downloadPhase = 'running';
      feedback.textContent = 'The download could not be paused.';
      renderSettingsData();
      if (!dataDownload.hidden) {
        renderLauncherDownload(currentCache, 'The download could not be paused.');
      }
    }
  }

  /** @param {import('../shared/diagnostics.js').RendererMilestone} reason */
  function releaseGameBoot(reason) {
    if (!launcherResolve) return;
    dataChoice.hidden = true;
    dataDownload.hidden = true;
    launcherMilestone(reason);
    launcherMilestone('launcher.bootReleased');
    const resolve = launcherResolve;
    launcherResolve = null;
    resolve();
  }

  /**
   * @param {import('../shared/contracts.js').CacheInfo} cache
   * @param {number} total
   */
  function showChoice(cache, total) {
    currentCache = cache;
    launcherTotalBytes = total;
    const remaining = Math.max(0, total - (cache.bytes || 0));
    choiceAutoUpdates.checked = currentSettings?.autoCheckUpdates ?? false;
    // The gate runs after the settings load, so the tool boxes show the saved
    // answer rather than a default written a second time in the renderer.
    if (currentSettings) toolSettings.render(currentSettings);
    dataChoiceFullSize.textContent = remaining > 0
      ? `Download ${size(remaining)} before starting.`
      : 'The full game is already downloaded.';
    dataDownload.hidden = true;
    dataChoice.hidden = false;
    launcherMilestone('launcher.choiceShown');
  }

  /**
   * @param {import('../shared/contracts.js').CacheInfo} cache
   * @param {number} total
   */
  function showFullDownload(cache, total) {
    currentCache = cache;
    launcherTotalBytes = total;
    dataChoice.hidden = true;
    dataDownload.hidden = false;
    renderLauncherDownload(cache);
    if (!cacheComplete({ ...cache, totalBytes: total })) {
      void startFullDownload();
    }
  }

  /**
   * @param {number} snapshotBytes
   * @returns {Promise<void>}
   */
  async function resolveDataChoice(snapshotBytes) {
    try {
      const [settings, cache] = await Promise.all([
        loadSettings(),
        window.gwNative.cache.info(),
      ]);
      const total = cache.totalBytes || snapshotBytes;
      const resolvedCache = { ...cache, totalBytes: total };
      currentCache = resolvedCache;
      launcherTotalBytes = total;

      // The offline acceptance shell has no snapshot. There is no real choice
      // to make, so let it continue without persisting fabricated intent.
      if (!Number.isFinite(total) || total <= 0) return;
      if (settings.dataStrategy === 'quick') return;
      if (settings.dataStrategy === 'full' && cache.bytes >= total) {
        // Filenames prove residency, not integrity. Full Game startup always
        // runs the existing bounded verification pass before releasing boot.
        if (await startFullDownload()) return;
      }

      return new Promise((resolve) => {
        launcherResolve = resolve;
        if (settings.dataStrategy === 'full') {
          showFullDownload(resolvedCache, total);
        } else {
          showChoice(resolvedCache, total);
        }
      });
    } catch (error) {
      window.gwLoading?.fail(
        error instanceof Error
          ? error.message
          : 'Launcher settings could not be loaded.',
      );
      return new Promise(() => {});
    }
  }

  // The dock shows one thing at a time: the data question is answered first,
  // then the client build gets its say, then the game starts.
  window.gwResolveDataStrategy = async (snapshotBytes) => {
    await resolveDataChoice(snapshotBytes);
    await resolveClientCompatibility();
  };

  /**
   * The first-run gate answers two questions with one click. Both are written
   * together so a saved data choice can never leave the update answer behind.
   * @param {'quick' | 'full'} dataStrategy
   * @returns {import('../shared/contracts.js').AppSettingsPatch}
   */
  const answeredChoice = (dataStrategy) => ({
    dataStrategy,
    autoCheckUpdates: choiceAutoUpdates.checked,
  });

  dataChoiceQuick.addEventListener('click', async () => {
    dataChoiceQuick.disabled = true;
    dataChoiceFull.disabled = true;
    try {
      await persistSettings(answeredChoice('quick'));
      if (choiceAutoUpdates.checked) requestUpdateCheck();
      releaseGameBoot('launcher.quickSelected');
    } catch {
      dataChoiceFullSize.textContent =
        'Your choice could not be saved. Please try again.';
    } finally {
      dataChoiceQuick.disabled = false;
      dataChoiceFull.disabled = false;
    }
  });

  dataChoiceFull.addEventListener('click', async () => {
    dataChoiceQuick.disabled = true;
    dataChoiceFull.disabled = true;
    try {
      await persistSettings(answeredChoice('full'));
      if (choiceAutoUpdates.checked) requestUpdateCheck();
      if (!currentCache) {
        throw new Error("download status is not ready");
      }
      launcherMilestone('launcher.fullSelected');
      showFullDownload(currentCache, launcherTotalBytes);
    } catch {
      dataChoiceFullSize.textContent =
        'Your choice could not be saved. Please try again.';
    } finally {
      dataChoiceQuick.disabled = false;
      dataChoiceFull.disabled = false;
    }
  });

  dataDownloadToggle.addEventListener('click', () => {
    if (downloadActive()) void stopFullDownload();
    else void startFullDownload();
  });

  dataDownloadPlay.addEventListener('click', () => {
    if (!cacheComplete()) void startFullDownload();
    releaseGameBoot('launcher.playNowSelected');
  });

  dataDownloadQuick.addEventListener('click', async () => {
    dataDownloadQuick.disabled = true;
    try {
      if (downloadActive()) await stopFullDownload();
      await persistSettings({ dataStrategy: 'quick' });
      releaseGameBoot('launcher.quickSelected');
    } catch {
      renderLauncherDownload(currentCache, 'Quick Start could not be saved.');
    } finally {
      dataDownloadQuick.disabled = false;
    }
  });

  async function openSettings() {
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    feedback.textContent = '';
    selectPane(activeSettingsPane);
    settingsCache.textContent = 'Checking downloaded game data…';
    try {
      await settingsWrite;
      currentSettings = await window.gwNative.settings.get();
      fillForm(currentSettings);
      // "Last checked 4 minutes ago" goes stale while a window sits open.
      updateAction?.restore(currentSettings.lastUpdateCheckAt);
      // The client build's status is the answer to "why is my cursor plain?",
      // so it is in Settings whether or not the launcher notice was ever seen.
      await readSession().catch(() => undefined);
      await refreshCache();
    } catch {
      feedback.textContent = 'Settings could not be loaded. Try reopening this window.';
    }
  }

  window.addEventListener('gw:settings', () => { void openSettings(); });

  form.addEventListener('change', (event) => {
    const control = event.target;
    if (
      !(control instanceof globalThis.HTMLInputElement) &&
      !(control instanceof globalThis.HTMLSelectElement)
    ) return;
    const patch = patchForControl(control);
    if (!patch) return;
    feedback.textContent = '';
    const strategyChanged = control.name === 'dataStrategy';
    const nextStrategy = selectedStrategy();
    void persistSettings(patch)
      .then(async (saved) => {
        // A tool selects which client module this launch serves, and that
        // choice is made before the renderer exists, so saving it restarts the
        // app. A player who declined the restart saved nothing, and the box has
        // already gone back to what is true; the sentence explains why.
        const toolResult = toolSettings.resultFor(control, patch, saved);
        if (toolResult) {
          if (toolResult.applied) flashSaved();
          feedback.textContent = toolResult.text;
          return;
        }
        flashSaved();
        if (!strategyChanged) {
          feedback.textContent = 'Settings saved.';
          return;
        }
        if (nextStrategy === 'quick' && downloadActive()) {
          await stopFullDownload();
        }
        renderSettingsData();
        feedback.textContent = nextStrategy === 'full'
          ? 'Full Game will download before Guild Wars starts next time.'
          : 'Quick Start will be used next time. Downloaded data is kept.';
      })
      .catch(() => {
        if (currentSettings) {
          fillForm(currentSettings);
          window.gwApplySettings?.(currentSettings);
        }
        feedback.textContent = 'Settings could not be saved.';
      });
  });

  settingsDownload.addEventListener('click', () => {
    feedback.textContent = '';
    if (downloadActive()) void stopFullDownload();
    else void startFullDownload();
  });

  byId('settings-clear-cache')?.addEventListener('click', async () => {
    feedback.textContent = '';
    try {
      await window.gwNative.cache.clearAndRestart();
    } catch {
      feedback.textContent = 'Game data could not be cleared.';
    }
  });

  settingsReset.addEventListener('click', async () => {
    feedback.textContent = '';
    try {
      const reset = await window.gwNative.settings.reset();
      if (!reset) return;
      currentSettings = reset;
      fillForm(reset);
      updateAction?.restore(reset.lastUpdateCheckAt);
      renderSettingsData();
      window.gwApplySettings?.(reset);
      feedback.textContent =
        'Launcher settings reset. The download choice will appear next launch.';
    } catch {
      feedback.textContent = 'Launcher settings could not be reset.';
    }
  });

  window.gwNative.progress.onChange((progress) => {
    if (progress.phase === 'ready' && !downloadActive()) {
      void refreshCache().catch(() => {});
      return;
    }
    if (progress.phase !== 'image') return;
    // Start/stop/finally exclusively own the operation phase. A queued native
    // progress event must not resurrect a paused or already-settled download.
    if (!fullDownloadPromise || downloadPhase !== 'running') return;
    currentDownloadProgress = progress;
    const next = {
      chunks: currentCache?.chunks ?? 0,
      totalChunks: currentCache?.totalChunks ?? 0,
      bytes: Number.isFinite(progress.received)
        ? Math.max(progress.received, currentCache?.bytes || 0)
        : currentCache?.bytes || 0,
      totalBytes:
        progress.total || currentCache?.totalBytes || launcherTotalBytes || 0,
    };
    currentCache = next;
    renderSettingsData(next);
    renderLauncherDownload(next);

    if (dialog.open) {
      settingsCache.textContent = progress.total
        ? dataDownloadStatus.textContent
        : 'Preparing full game download…';
    }
  });

  window.gwNative.progress.onPrefetch((progress) => {
    if (
      !dialog.open ||
      downloadActive() ||
      !progress?.totalChunks ||
      progress.completedChunks >= progress.totalChunks
    ) return;
    settingsCache.textContent = 'Caching recently used areas in the background…';
  });

  window.addEventListener('resize', updateRenderScaleDimensions);
  window.addEventListener('gw:graphics-resized', updateRenderScaleDimensions);
})();
