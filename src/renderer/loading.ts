// Loading screen: owns everything the user sees before the canvas appears.
// Progress comes from the main-process updater via gwNative, not HTTP polling.
//
// index.html loads this as a classic script, so the file carries no top-level
// import or export and names the contracts through type-only `import(…)`.

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
  // The art index scripts/copy-renderer.mjs writes beside the images. It is
  // fetched rather than imported, so nothing but this shape is guaranteed.
  type ArtIndex = {
    logo?: string | null;
    credit?: string | null;
    backgrounds?: string[] | null;
  };

  const el = (id: string) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`missing renderer element: ${id}`);
    return element;
  };
  const root = el('loading'), bar = el('loading-bar'), fill = el('loading-fill');
  const label = el('loading-label'), detail = el('loading-detail');
  const retry = el('loading-retry') as HTMLButtonElement;
  let recovery: 'client' | 'filesystem' = 'client';

  const mb = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB'
                              : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB');

  function setBar(frac: number | null) {
    if (frac === null) { bar.classList.add('busy'); return; }
    bar.classList.remove('busy');
    fill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
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
      label.textContent = text;
      label.classList.remove('error');
      detail.textContent = sub || '';
      retry.hidden = true;
      retry.textContent = 'Retry';
      setBar(frac);
    },

    fail(text) {
      recovery = 'client';
      root.style.display = '';
      root.classList.remove('gone');
      label.textContent = text;
      label.classList.add('error');
      detail.textContent =
        'You can retry, or choose Help → Report a Problem.';
      retry.hidden = false;
      retry.textContent = 'Retry';
      bar.classList.remove('busy');
      fill.style.width = '100%';
      fill.style.background = '#b8452f';
    },

    failFilesystem() {
      recovery = 'filesystem';
      root.style.display = '';
      root.classList.remove('gone');
      label.textContent = 'Saved game files could not be opened.';
      label.classList.add('error');
      detail.textContent =
        'Reset the local Guild Wars files to continue. Downloaded game data and your saved login are kept.';
      retry.hidden = false;
      retry.textContent = 'Reset Saved Files…';
      bar.classList.remove('busy');
      fill.style.width = '100%';
      fill.style.background = '#b8452f';
    },

    done() {
      api.set('Ready', 1);
      finish();
    },
    waitForClient,
  };

  // Art index is generated at package time next to the images.
  fetch('images/index.json')
    .then(async (r): Promise<ArtIndex | null> => (r.ok ? r.json() : null))
    .then((art) => {
      if (!art) return;
      if (art.logo) {
        (el('loading-logo') as HTMLImageElement).src = art.logo;
      }
      if (art.credit) el('loading-credit').innerHTML = art.credit;
      if (!art.backgrounds || !art.backgrounds.length) return;
      const backgrounds = art.backgrounds;
      const pick = backgrounds[Math.floor(Math.random() * backgrounds.length)];
      if (!pick) return;
      const img = new Image();
      img.onload = () => {
        const bg = el('loading-bg');
        bg.style.backgroundImage = `url("${pick}")`;
        bg.classList.add('shown');
      };
      img.src = pick;
    })
    .catch(() => {});

  // The running version, in the footer, on every launch. It used to live only
  // in the native About panel, which means a bug report had to go hunting for
  // it — and under CalVer the number doubles as a staleness signal.
  window.gwNative?.client.session().then((session) => {
    const platform = window.gwNative?.init.desktopPlatform;
    const platformName = platform
      ? {
          macos: 'macOS',
          windows: 'Windows',
          linux: 'Linux',
        }[platform]
      : 'Desktop';
    const version = document.createElement('p');
    version.id = 'loading-version';
    version.textContent = `Guild Wars for ${platformName} ${session.appVersion}`;
    el('loading-legal').prepend(version);
  }).catch(() => {});

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
        const { describeLaunchFailure } = await import('./failure-messages.js');
        api.fail(describeLaunchFailure(progress.errorCode));
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

  // The artwork's ambient drift (loading.css) pauses while the window is
  // unfocused: an idle launcher in the background should cost zero GPU.
  window.addEventListener('blur', () => el('loading-bg')?.classList.add('idle'));
  window.addEventListener('focus', () => el('loading-bg')?.classList.remove('idle'));

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
    const kind = a.dataset.external;
    if (
      kind !== 'github' &&
      kind !== 'discord' &&
      kind !== 'donate' &&
      kind !== 'releases' &&
      kind !== 'store'
    ) return;
    e.preventDefault();
    void window.gwNative.app.openExternal(kind);
  });

  async function waitForClient() {
    if (!window.gwNative) {
      api.fail('Native bridge missing — this page must run inside Guild Wars.app.');
      return false;
    }
    api.set('Checking the game client', null);
    // Resolved before the first progress event can arrive, so the failure
    // path below stays synchronous.
    const { describeLaunchFailure } = await import('./failure-messages.js');

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(ok);
      };

      const apply = (p: DownloadProgress) => {
        if (p.phase === 'error') {
          api.fail(describeLaunchFailure(p.errorCode));
          finish(false);
          return;
        }
        window.gwAutomation.set(`launcher.${p.phase}`);
        if (p.phase === 'ready') {
          api.set('Starting Guild Wars', null, p.notice || '');
          finish(true);
          return;
        }
        const frac = p.total ? p.received / p.total : null;
        const eta = p.secondsRemaining != null
          ? `${Math.ceil(p.secondsRemaining / 60)} min remaining` : '';
        const rate = p.bytesPerSecond > 0
          ? `${(p.bytesPerSecond / 1e6).toFixed(1)} MB/s avg` : '';
        const text = p.phase === 'starting' || p.phase === 'checking'
          ? 'Checking the game client'
          : p.phase === 'client'
            ? 'Preparing files needed to start'
            : p.label || 'Preparing files needed to start';
        api.set(text, frac,
                [p.total ? `${mb(p.received)} of ${mb(p.total)}` : '', rate, eta]
                  .filter(Boolean).join(' · '));
      };

      const unsub = window.gwNative.progress.onChange(apply);
      void window.gwNative.progress.current().then(apply);
    });
  }

  return api;
})();
