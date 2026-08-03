/**
 * Loading screen: owns everything the user sees before the canvas appears.
 * Progress comes from the main-process updater via gwNative, not HTTP polling.
 *
 * index.html loads this as a classic script, so the file carries no top-level
 * import or export and names the contracts through type-only `import(…)`.
 */

window.gwAutomation = (function (): EnhancementAutomation {
  let stage = 'renderer.loading';
  let sequence = 0;
  const history: { sequence: number; stage: string; atMs: number }[] = [];
  return Object.freeze({
    set(next: string) {
      if (typeof next !== 'string' || next === stage) return;
      stage = next;
      sequence += 1;
      history.push({ sequence, stage, atMs: performance.now() });
      if (history.length > 32) history.shift();
    },
    read() {
      const enhancement = window.gwCompanionState;
      return Object.freeze({
        stage,
        sequence,
        transitions: history.slice(),
        enhancementStatus: enhancement?.status ?? 'not-installed',
        tickCount: enhancement?.tickCount ?? 0,
      });
    },
  });
})();

window.gwLoading = (function (): LoadingController {
  type DownloadProgress = import('../shared/contracts.js').DownloadProgress;

  const el = (id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`missing renderer element: ${id}`);
    return element;
  };
  const root = el('loading'), bar = el('loading-bar'), fill = el('loading-fill');
  const label = el('loading-label'), detail = el('loading-detail');
  const retry = el('loading-retry') as HTMLButtonElement;
  const report = el('loading-report') as HTMLButtonElement;
  let recovery: 'client' | 'filesystem' = 'client';
  // Bumped by every state change so failCrash's async copy upgrade can tell
  // it has been overtaken — e.g. by a Retry already in progress.
  let stateGeneration = 0;

  function setBar(frac: number | null) {
    if (frac === null) { bar.classList.add('busy'); return; }
    bar.classList.remove('busy');
    fill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }

  /** The shared red failure frame; every fail* variant starts from it. */
  function showFailureFrame(text: string, sub: string) {
    stateGeneration += 1;
    root.style.display = '';
    root.classList.remove('gone');
    label.textContent = text;
    label.classList.add('error');
    detail.textContent = sub;
    retry.hidden = false;
    report.hidden = true;
    bar.classList.remove('busy');
    fill.style.width = '100%';
    fill.style.background = '#b8452f';
  }

  function finish() {
    if (root.classList.contains('gone')) return;
    root.classList.add('gone');
    setTimeout(() => { root.style.display = 'none'; }, 700);
    el('canvas').focus();
  }

  const api: LoadingController = {
    set(text, frac, sub) {
      recovery = 'client';
      stateGeneration += 1;
      label.textContent = text;
      label.classList.remove('error');
      detail.textContent = sub || '';
      retry.hidden = true;
      retry.textContent = 'Retry';
      report.hidden = true;
      setBar(frac);
    },

    fail(text, failDetail) {
      recovery = 'client';
      showFailureFrame(
        text,
        failDetail ?? 'You can retry, or choose Help → Report a Problem.',
      );
      retry.textContent = 'Retry';
    },

    failFilesystem() {
      recovery = 'filesystem';
      showFailureFrame(
        'Saved game files could not be opened.',
        'Reset the local Guild Wars files to continue. Downloaded game data and your saved login are kept.',
      );
      retry.textContent = 'Reset Saved Files…';
    },

    failCrash(crashCount) {
      // The synchronous frame first: the overlay must appear even if module
      // loading is broken. The crash copy then upgrades it in place.
      api.fail('The game client stopped unexpectedly.');
      const generation = stateGeneration;
      void import('./failure-messages.js')
        .then(({ clientCrashPresentation }) => {
          // A later state — a Retry in progress, another failure — owns the
          // panel now; upgrading it would repaint stale crash copy over it.
          if (generation !== stateGeneration) return;
          const crash = clientCrashPresentation(crashCount);
          label.textContent = crash.label;
          detail.textContent = crash.detail;
          retry.textContent = crash.retryButton;
          report.textContent = crash.reportButton;
          report.hidden = false;
          // After the live-region sentence, not instead of it.
          setTimeout(() => retry.focus(), 0);
        })
        .catch(() => {});
    },

    done() {
      api.set('Ready', 1);
      finish();
    },
    waitForClient,
  };

  // Motion follows both accessibility preference and app focus. The poster is
  // always available, so pausing never leaves the launcher without artwork.
  const backgroundVideo = el('loading-bg') as HTMLVideoElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function syncBackgroundVideo() {
    if (
      reducedMotion.matches ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus()
    ) {
      backgroundVideo.pause();
      return;
    }
    void backgroundVideo.play().catch(() => {});
  }
  reducedMotion.addEventListener('change', syncBackgroundVideo);
  document.addEventListener('visibilitychange', syncBackgroundVideo);
  window.addEventListener('blur', syncBackgroundVideo);
  window.addEventListener('focus', syncBackgroundVideo);
  syncBackgroundVideo();

  // The passive health line: version, data mode, and (once a client is
  // active) the game build's short id, in the footer on every launch. The
  // version used to live only in the macOS About panel, which meant a bug
  // report had to go hunting for it — and under CalVer the number doubles as
  // a staleness signal. Everything here is already-local data; no request is
  // made to render it.
  async function renderFooterStatus() {
    const native = window.gwNative;
    if (!native) return;
    try {
      const [session, settings] = await Promise.all([
        native.client.session(),
        native.settings.get(),
      ]);
      const mode = settings.dataStrategy === 'quick'
        ? 'Quick Start'
        : settings.dataStrategy === 'full' ? 'Full Game' : '';
      const build = session.compatibility
        ? `game client ${session.compatibility.clientSha256.slice(0, 8)}`
        : '';
      let version = document.getElementById('loading-version');
      if (!version) {
        version = document.createElement('p');
        version.id = 'loading-version';
        el('loading-legal').prepend(version);
      }
      // "App version", not the app's game-shaped name: the number belongs to
      // this fan project, and the line must never read like an ArenaNet
      // product version. The vocabulary matches the compatibility surfaces.
      version.textContent =
        [`App version ${session.appVersion}`, mode, build]
          .filter(Boolean).join(' · ');
    } catch {
      // The footer is informational; a failed read shows nothing extra.
    }
  }
  void renderFooterStatus();

  // A failed boot gets a one-click retry, same as View → Reload Game.
  retry?.addEventListener('click', async () => {
    const requestedRecovery = recovery;
    retry.disabled = true;
    try {
      if (requestedRecovery === 'filesystem') {
        api.set('Resetting saved game files', null);
        const reset = await window.gwNative.gameStorage.resetAndRestart();
        if (!reset) api.failFilesystem();
        return;
      }
      api.set('Retrying the game client', null);
      await window.gwNative.client.retry();
      // A retry answers on the progress channel, the same one the first
      // attempt used. Reading it here is what replaced a rejected promise
      // carrying a sentence the main process had written.
      const progress = await window.gwNative.progress.current();
      if (progress.phase === 'error') {
        const { describeLaunchFailure, failureDetail } =
          await import('./failure-messages.js');
        api.fail(
          describeLaunchFailure(progress.errorCode),
          failureDetail(progress.errorCode),
        );
        return;
      }
      window.location.reload();
    } catch {
      if (requestedRecovery === 'filesystem') {
        api.failFilesystem();
      } else {
        api.fail('The game client still could not be prepared.');
      }
    } finally {
      retry.disabled = false;
    }
  });

  // Main owns the whole report flow — save dialog, export, follow-up dialog,
  // and its own failure dialog — so there is nothing to render here beyond
  // preventing a second dialog while one is up.
  report.addEventListener('click', () => {
    report.disabled = true;
    void window.gwNative.diagnostics.exportReport()
      .catch(() => {})
      .finally(() => { report.disabled = false; });
  });

  // Project links are enum-selected so the renderer never invents arbitrary URLs.
  el('loading-links')?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof globalThis.Element)) return;
    const a = target.closest('a');
    if (!a) return;
    if (a.hasAttribute('data-settings')) {
      e.preventDefault();
      window.dispatchEvent(new window.Event('gw:settings'));
      return;
    }
    // `store` stays in the shared contract for the website; the launcher no
    // longer offers it, so it is not accepted here.
    const kind = a.dataset.external;
    if (
      kind !== 'github' &&
      kind !== 'discord' &&
      kind !== 'donate' &&
      kind !== 'releases'
    ) return;
    e.preventDefault();
    void window.gwNative.app.openExternal(kind);
  });

  async function waitForClient() {
    if (!window.gwNative) {
      api.fail('Native bridge missing — this page must run inside Guild Wars Reforged.app.');
      return false;
    }
    api.set('Checking the game client', null);
    // Resolved before the first progress event can arrive, so the failure
    // path below stays synchronous.
    const [
      { describeLaunchFailure, describeNotice, failureDetail },
      { DownloadDetailLine },
      { launchGateDecision },
    ] = await Promise.all([
      import('./failure-messages.js'),
      import('./progress-display.js'),
      import('./update-action.js'),
    ]);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let gating = false;
      const detailLine = new DownloadDetailLine();
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(ok);
      };

      // The launch gate: an update the launch check discovered lands before
      // the outdated version gets a whole session. The gate holds the client
      // start while the check or its download is in flight, restarts into a
      // ready update, and releases on every settled state — a failed check
      // never delays play, and "Play Without Updating" is the player's
      // override while a download runs.
      const holdForLaunchUpdate = (startClient: () => void) => {
        const skip = el('loading-update-skip');
        let gateSettled = false;
        let unsubscribe = () => {};
        let installFallback: ReturnType<typeof setTimeout> | null = null;
        const release = () => {
          if (gateSettled) return;
          gateSettled = true;
          unsubscribe();
          skip.hidden = true;
          if (installFallback !== null) clearTimeout(installFallback);
          startClient();
        };
        skip.addEventListener('click', (event) => {
          event.preventDefault();
          release();
        });
        const consider = (
          state: import('../shared/contracts.js').AppUpdateState,
        ) => {
          if (gateSettled) return;
          const decision = launchGateDecision(state);
          if (decision === 'proceed') {
            release();
            return;
          }
          if (decision === 'install' && state.phase === 'ready') {
            skip.hidden = true;
            api.set(
              `Updating to version ${state.latestVersion}`,
              null,
              'Guild Wars Reforged restarts to finish the update.',
            );
            void window.gwNative.appUpdates.restartAndInstall();
            // A refused restart must not hold the launch hostage.
            installFallback = setTimeout(release, 10_000);
            return;
          }
          skip.hidden = false;
          api.set(
            state.phase === 'downloading'
              ? `Downloading version ${state.latestVersion}`
              : 'Checking for updates',
            null,
            'The game starts when the update is ready.',
          );
        };
        unsubscribe = window.gwNative.appUpdates.onState(consider);
        void window.gwNative.appUpdates.getState().then(consider).catch(release);
      };

      const apply = (p: DownloadProgress) => {
        if (p.phase === 'error') {
          api.fail(describeLaunchFailure(p.errorCode), failureDetail(p.errorCode));
          finish(false);
          return;
        }
        window.gwAutomation.set(`launcher.${p.phase}`);
        if (p.phase === 'ready') {
          if (gating) return;
          gating = true;
          holdForLaunchUpdate(() => {
            api.set(
              'Starting Guild Wars',
              null,
              p.noticeCode ? describeNotice(p.noticeCode) : '',
            );
            // A client is active now, so the footer can name its build.
            void renderFooterStatus();
            finish(true);
          });
          return;
        }
        const frac = p.total ? p.received / p.total : null;
        // The client phase keeps main's label: only patch-client knows
        // whether this is a first download or a patch-day update.
        const text = p.phase === 'starting' || p.phase === 'checking'
          ? 'Checking the game client'
          : p.label || 'Preparing files needed to start';
        api.set(text, frac, detailLine.update(p));
      };

      const unsub = window.gwNative.progress.onChange(apply);
      void window.gwNative.progress.current().then(apply);
    });
  }

  return api;
})();
