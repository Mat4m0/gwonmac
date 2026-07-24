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
  const pointerLock =
    /** @type {HTMLInputElement} */ (form.elements.namedItem('pointerLock'));
  const cursorTheme =
    /** @type {HTMLSelectElement} */ (form.elements.namedItem('cursorTheme'));
  const touchMode =
    /** @type {HTMLSelectElement} */ (form.elements.namedItem('touchMode'));
  const showDiagnostics =
    /** @type {HTMLInputElement} */ (form.elements.namedItem('showDiagnostics'));

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
  /** @type {import('../shared/contracts.js').DownloadProgress | null} */
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

  /** @param {import('../shared/contracts.js').AppSettings} settings */
  function applyRuntimeSettings(settings) {
    const canvas = document.getElementById('canvas');
    if (canvas) canvas.dataset.cursorTheme = settings.cursorTheme;
    const preview = byId('settings-cursor-preview');
    if (preview) preview.dataset.cursorTheme = settings.cursorTheme;
    window.gwApplySettings?.(settings);
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
      applyRuntimeSettings(saved);
      return saved;
    });
    settingsWrite = operation.catch(() => undefined);
    return operation;
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
    switch (control.name) {
      case 'renderScale': {
        const value = Number(control.value);
        return value === 1 || value === 1.5 || value === 2
          ? { renderScale: value }
          : null;
      }
      case 'pointerLock':
        return control instanceof globalThis.HTMLInputElement
          ? { pointerLock: control.checked }
          : null;
      case 'cursorTheme': {
        const value = control.value;
        return value === 'system' ||
          value === 'guild-wars' ||
          value === 'guild-wars-2'
          ? { cursorTheme: value }
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
      case 'dataStrategy':
        return { dataStrategy: selectedStrategy() };
      default:
        return null;
    }
  }

  /** @param {import('../shared/contracts.js').AppSettings} settings */
  function fillForm(settings) {
    renderScale.value = String(settings.renderScale);
    pointerLock.checked = settings.pointerLock;
    cursorTheme.value = settings.cursorTheme;
    touchMode.value = settings.touchMode;
    showDiagnostics.checked = settings.showDiagnostics;
    for (const radio of /** @type {NodeListOf<HTMLInputElement>} */ (
      form.querySelectorAll('input[name="dataStrategy"]')
    )) {
      radio.checked = radio.value === settings.dataStrategy;
    }
    const preview = byId('settings-cursor-preview');
    if (preview) preview.dataset.cursorTheme = settings.cursorTheme;
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
      .then(async (complete) => {
        downloadError = '';
        const cache = await window.gwNative.cache.info();
        currentCache = cache;
        renderSettingsData(cache);
        if (!dataDownload.hidden) renderLauncherDownload(cache);
        if (!complete && dialog.open) {
          settingsCache.textContent = `Download paused · ${cacheStatus(cache)}`;
        }
        return complete;
      })
      .catch((error) => {
        const message =
          error?.message || 'The full game download could not continue.';
        downloadError = message;
        if (dialog.open) feedback.textContent = message;
        if (!dataDownload.hidden) renderLauncherDownload(currentCache, message);
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

  window.gwResolveDataStrategy = async (snapshotBytes) => {
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
  };

  dataChoiceQuick.addEventListener('click', async () => {
    dataChoiceQuick.disabled = true;
    dataChoiceFull.disabled = true;
    try {
      await persistSettings({ dataStrategy: 'quick' });
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
      await persistSettings({ dataStrategy: 'full' });
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
    if (control.name === 'cursorTheme') {
      const preview = byId('settings-cursor-preview');
      preview.dataset.cursorTheme = control.value;
    }
    void persistSettings(patch)
      .then(async () => {
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
          applyRuntimeSettings(currentSettings);
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
      renderSettingsData();
      applyRuntimeSettings(reset);
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
    downloadPhase = 'running';
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
