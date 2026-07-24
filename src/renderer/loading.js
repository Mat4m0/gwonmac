// Loading screen: owns everything the user sees before the canvas appears.
// Progress comes from the main-process updater via gwNative, not HTTP polling.

window.gwLoading = (function () {
  /** @param {string} id */
  const el = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`missing renderer element: ${id}`);
    return element;
  };
  const root = el('loading'), bar = el('loading-bar'), fill = el('loading-fill');
  const label = el('loading-label'), detail = el('loading-detail');
  const retry = /** @type {HTMLButtonElement} */ (el('loading-retry'));

  /** @param {number} n */
  const mb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB'
                              : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB');

  /** @param {number | null} frac */
  function setBar(frac) {
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

  const api = {
    /**
     * @param {string} text
     * @param {number | null} frac
     * @param {string} [sub]
     */
    set(text, frac, sub) {
      label.textContent = text;
      label.classList.remove('error');
      detail.textContent = sub || '';
      retry.hidden = true;
      setBar(frac);
    },

    /** @param {string} text */
    fail(text) {
      root.style.display = '';
      root.classList.remove('gone');
      label.textContent = text;
      label.classList.add('error');
      detail.textContent =
        'You can retry, or choose Help → Report a Problem.';
      retry.hidden = false;
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
  fetch('images/index.json').then((r) => r.ok ? r.json() : null).then((art) => {
    if (!art) return;
    if (art.logo) {
      /** @type {HTMLImageElement} */ (el('loading-logo')).src = art.logo;
    }
    if (art.credit) el('loading-credit').innerHTML = art.credit;
    if (!art.backgrounds || !art.backgrounds.length) return;
    const pick = art.backgrounds[Math.floor(Math.random() * art.backgrounds.length)];
    const img = new Image();
    img.onload = () => {
      const bg = el('loading-bg');
      bg.style.backgroundImage = `url("${pick}")`;
      bg.classList.add('shown');
    };
    img.src = pick;
  }).catch(() => {});

  // A failed boot gets a one-click retry, same as View → Reload Game.
  retry?.addEventListener('click', async () => {
    retry.disabled = true;
    api.set('Retrying the game client', null);
    try {
      await window.gwNative.client.retry();
      window.location.reload();
    } catch (error) {
      api.fail(
        error instanceof Error
          ? error.message
          : 'The game client still could not be prepared.',
      );
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

  // Quiet update awareness: one corner link when a newer release exists.
  // Main returns null for dev builds and on any network failure.
  void (async () => {
    const status = window.gwNative?.update?.status
      ? await window.gwNative.update.status().catch(() => null)
      : null;
    if (!status || !status.hasUpdate) return;
    const links = el('loading-links');
    if (!links || links.querySelector('[data-external="releases"]')) return;
    const link = document.createElement('a');
    link.href = '#';
    link.dataset.external = 'releases';
    link.className = 'update';
    link.textContent = `Update available · ${status.latestVersion}`;
    links.prepend(link);
  })();

  async function waitForClient() {
    if (!window.gwNative) {
      api.fail('Native bridge missing — this page must run inside Guild Wars.app.');
      return false;
    }
    api.set('Checking the game client', null);

    return new Promise((resolve) => {
      let settled = false;
      /** @param {boolean} ok */
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(ok);
      };

      /** @param {import('../shared/contracts.js').DownloadProgress} p */
      const apply = (p) => {
        if (p.error) { api.fail(p.error); finish(false); return; }
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
