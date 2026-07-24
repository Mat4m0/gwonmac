// One owner for launcher strategy, full-download presentation, and Settings.
// Cache residency is the download-progress truth; dataStrategy is only intent.

(function () {
  const byId = (id) => document.getElementById(id);
  const dialog = byId('settings-dialog');
  const form = byId('settings-form');
  const settingsDownload = byId('settings-download-full');
  const settingsReset = byId('settings-reset-launcher');
  const settingsCache = byId('settings-cache');
  const settingsDataNote = byId('settings-data-note');
  const settingsSaved = byId('settings-saved');
  const settingsProgress = byId('settings-progress');
  const settingsProgressFill = byId('settings-progress-fill');
  const settingsPanes = form?.querySelector('.settings-panes');
  const feedback = byId('settings-feedback');
  const dataChoice = byId('data-choice');
  const dataChoiceQuick = byId('data-choice-quick');
  const dataChoiceFull = byId('data-choice-full');
  const dataChoiceFullSize = byId('data-choice-full-size');
  const dataDownload = byId('data-download');
  const dataDownloadStatus = byId('data-download-status');
  const dataDownloadDetail = byId('data-download-detail');
  const dataDownloadFill = byId('data-download-fill');
  const dataDownloadToggle = byId('data-download-toggle');
  const dataDownloadPlay = byId('data-download-play');
  const dataDownloadQuick = byId('data-download-quick');

  if (
    !dialog ||
    !form ||
    !settingsDownload ||
    !settingsReset ||
    !settingsCache ||
    !settingsDataNote ||
    !feedback ||
    !dataChoice ||
    !dataChoiceQuick ||
    !dataChoiceFull ||
    !dataChoiceFullSize ||
    !dataDownload ||
    !dataDownloadStatus ||
    !dataDownloadDetail ||
    !dataDownloadFill ||
    !dataDownloadToggle ||
    !dataDownloadPlay ||
    !dataDownloadQuick ||
    !window.gwNative
  ) return;

  let currentSettings = null;
  let settingsLoad = null;
  let settingsWrite = Promise.resolve();
  let currentCache = null;
  let fullDownloadPromise = null;
  let downloadPhase = 'idle';
  let currentDownloadProgress = null;
  let downloadError = '';
  let launcherResolve = null;
  let launcherTotalBytes = 0;
  let savedTimer = null;
  let activeSettingsPane = 'data';
  const downloadActive = () =>
    downloadPhase === 'running' || downloadPhase === 'stopping';

  // Auto-save proof: a brief "Saved" note in the header when a change lands.
  function flashSaved() {
    if (!settingsSaved) return;
    settingsSaved.classList.add('show');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => settingsSaved.classList.remove('show'), 1400);
  }

  function selectPane(name) {
    if (!settingsPanes) return;
    activeSettingsPane = name;
    settingsPanes.dataset.active = name;
    for (const tab of form.querySelectorAll('.settings-rtab')) {
      const selected = tab.dataset.pane === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  }

  const railTabs = [...form.querySelectorAll('.settings-rtab')];
  for (const tab of railTabs) {
    tab.addEventListener('click', () => selectPane(tab.dataset.pane));
  }

  // Roving tabindex: arrows move between sections, Home/End jump.
  form.querySelector('.settings-rail')?.addEventListener('keydown', (event) => {
    const index = railTabs.indexOf(document.activeElement);
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
    selectPane(target.dataset.pane);
  });

  const size = (bytes) => bytes >= 1_073_741_824
    ? `${(bytes / 1_073_741_824).toFixed(2)} GB`
    : `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;

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
    const activeScale = Number(form.renderScale.value);
    const offscreen = window.Module?.canvas?.offscreen;
    for (const output of form.querySelectorAll('[data-render-scale]')) {
      const scale = Number(output.dataset.renderScale);
      const measured =
        scale === activeScale &&
        Number.isFinite(offscreen?.width) &&
        Number.isFinite(offscreen?.height) &&
        offscreen.width > 0 &&
        offscreen.height > 0;
      const backingWidth = measured ? offscreen.width : Math.round(width * scale);
      const backingHeight = measured ? offscreen.height : Math.round(height * scale);
      output.textContent =
        `${measured ? '' : '≈ '}${backingWidth} × ${backingHeight}`;
      output.title = measured
        ? 'Current measured backing buffer'
        : 'Estimated backing resolution';
    }
  }

  // Serialize writes so a slower earlier write cannot replace newer intent.
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

  function cacheStatus(cache) {
    if (!cache?.totalBytes) return 'Game data is still preparing…';
    if (cacheComplete(cache)) {
      return `Full game ready · ${size(cache.bytes)} downloaded`;
    }
    return `${size(cache.bytes)} of ${size(cache.totalBytes)} downloaded`;
  }

  function selectedStrategy() {
    return form.querySelector('input[name="dataStrategy"]:checked')?.value || null;
  }

  function patchForControl(control) {
    switch (control.name) {
      case 'renderScale':
        return { renderScale: Number(control.value) };
      case 'pointerLock':
        return { pointerLock: control.checked };
      case 'cursorTheme':
        return { cursorTheme: control.value };
      case 'touchMode':
        return { touchMode: control.value };
      case 'showDiagnostics':
        return { showDiagnostics: control.checked };
      case 'dataStrategy':
        return { dataStrategy: selectedStrategy() };
      default:
        return null;
    }
  }

  function fillForm(settings) {
    form.renderScale.value = String(settings.renderScale);
    form.pointerLock.checked = !!settings.pointerLock;
    form.cursorTheme.value = settings.cursorTheme;
    form.touchMode.value = settings.touchMode;
    form.showDiagnostics.checked = !!settings.showDiagnostics;
    for (const radio of form.querySelectorAll('input[name="dataStrategy"]')) {
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
      const rate = progress?.bytesPerSecond > 0
        ? ` · ${size(progress.bytesPerSecond)}/s avg`
        : '';
      const eta = Number.isFinite(progress?.secondsRemaining)
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

    dataDownloadToggle.hidden = complete;
    dataDownloadToggle.disabled = downloadPhase === 'stopping';
    dataDownloadToggle.textContent = downloadPhase === 'stopping'
      ? 'Pausing…'
      : downloadPhase === 'running'
        ? 'Pause Download'
        : 'Resume Download';
    dataDownloadPlay.textContent = complete ? 'Play Guild Wars' : 'Play Now Instead';
    dataDownloadQuick.hidden = complete;
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
      currentCache = { ...cache, totalBytes: total };
      launcherTotalBytes = total;

      // The offline acceptance shell has no snapshot. There is no real choice
      // to make, so let it continue without persisting fabricated intent.
      if (!Number.isFinite(total) || total <= 0) return;
      if (settings.dataStrategy === 'quick') return;
      if (settings.dataStrategy === 'full' && cache.bytes >= total) return;

      return new Promise((resolve) => {
        launcherResolve = resolve;
        if (settings.dataStrategy === 'full') {
          showFullDownload(currentCache, total);
        } else {
          showChoice(currentCache, total);
        }
      });
    } catch (error) {
      window.gwLoading?.fail(
        error?.message || 'Launcher settings could not be loaded.',
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
    if (!event.target.matches('input, select')) return;
    const patch = patchForControl(event.target);
    if (!patch) return;
    feedback.textContent = '';
    const strategyChanged = event.target.name === 'dataStrategy';
    const nextStrategy = selectedStrategy();
    if (event.target.name === 'cursorTheme') {
      const preview = byId('settings-cursor-preview');
      if (preview) preview.dataset.cursorTheme = event.target.value;
    }
    void persistSettings(patch)
      .then(async () => {
        flashSaved();
        if (!strategyChanged) return;
        if (nextStrategy === 'quick' && downloadActive()) {
          await stopFullDownload();
        }
        renderSettingsData();
        feedback.textContent = nextStrategy === 'full'
          ? 'Full Game will download before Guild Wars starts next time.'
          : 'Quick Start will be used next time. Downloaded data is kept.';
      })
      .catch(() => {
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
      ...(currentCache || {}),
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
