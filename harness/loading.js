// Loading screen: owns everything the user sees before the canvas appears.
//
// Two phases feed one bar. First gw.py fetching the client, polled from
// /progress.json -- that one knows its byte total. Then the module's own boot,
// narrated through Module.setStartupProgress, which reports a percentage for
// 'downloading' and nothing measurable for the rest. gw.js drives the second
// phase by calling into window.gwLoading.

// Tell gw.py we are still here, so it can stop itself when we are not.
//
// The beacon on pagehide is what makes closing the tab shut the server down
// promptly; the interval is only a backstop for a browser that dies without
// firing it. sendBeacon rather than fetch, because a request started during
// pagehide is otherwise cancelled with the page.
//
// pagehide also fires on reload and on navigation, which is why gw.py waits a
// few seconds before acting: the reloaded page pings again and cancels it.
(function heartbeat() {
  // Identify this tab. A beacon fired by the interval can land *after* the
  // goodbye -- sendBeacon promises no ordering -- and without an id the server
  // reads that stray as "still here" and never exits. A reload arrives under a
  // new id, so it still cancels the shutdown; the stray does not.
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ping = (bye) => {
    const url = 'ping?id=' + id + (bye ? '&bye=1' : '');
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else fetch(url, { keepalive: true });
    } catch (e) { /* the watchdog's idle timeout still covers us */ }
  };
  ping();
  setInterval(ping, 1000);
  addEventListener('pagehide', () => ping(true));
})();

window.gwLoading = (function () {
  const el = (id) => document.getElementById(id);
  const root = el('loading'), bar = el('loading-bar'), fill = el('loading-fill');
  const label = el('loading-label'), detail = el('loading-detail');

  // Decimal, to agree with what gw.py prints in the terminal -- the two
  // disagreeing by 5% over a 4 GB download reads as a bug.
  const mb = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB'
                              : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB');

  function setBar(frac) {
    if (frac === null) { bar.classList.add('busy'); return; }
    bar.classList.remove('busy');
    fill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }

  const api = {
    // frac === null means "working, but no meaningful total".
    set(text, frac, sub) {
      label.textContent = text;
      label.classList.remove('error');
      detail.textContent = sub || '';
      setBar(frac);
    },

    fail(text) {
      label.textContent = text;
      label.classList.add('error');
      // The terminal, not the console: a download failure is reported by
      // gw.py, and this screen's audience is someone who double-clicked it.
      detail.textContent = 'Check the gw.py window for detail, then restart it.';
      bar.classList.remove('busy');
      fill.style.width = '100%';
      fill.style.background = '#b8452f';
    },

    // Called once the module says it is done. The canvas has been behind this
    // the whole time, so there is nothing to show -- only this to remove.
    done() {
      if (root.classList.contains('gone')) return;
      api.set('Ready', 1);
      root.classList.add('gone');
      // Only after the fade, or a display:none mid-transition kills it.
      setTimeout(() => { root.style.display = 'none'; }, 700);
      document.getElementById('canvas').focus();
    },
  };

  // Pick a background at random from whatever is in images/. Decoding it
  // before showing avoids a half-painted image sliding in under the logo.
  fetch('images/index.json').then((r) => r.ok ? r.json() : null).then((art) => {
    if (!art) return;
    if (art.logo) el('loading-logo').src = art.logo;
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

  // Phase one: wait for gw.py to finish fetching the client. Polling rather
  // than SSE because a dropped poll is self-healing and this runs for seconds,
  // not hours.
  api.waitForClient = async function () {
    api.set('Starting…', null);
    for (;;) {
      let p;
      try {
        p = await (await fetch('progress.json', { cache: 'no-store' })).json();
      } catch (e) {
        // The server is right there; a failure here means it is still coming up.
        api.set('Connecting to gw.py…', null);
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }

      if (p.error) { api.fail(p.error); return false; }
      if (p.done) { pollPrefetch(); return true; }

      // `note` is the producer's own aside -- rate and ETA on a long download.
      const frac = p.total ? p.received / p.total : null;
      api.set(p.label || 'Working…', frac,
              [p.total ? `${mb(p.received)} of ${mb(p.total)}` : '', p.note || '']
                .filter(Boolean).join(' · '));
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  // gw.py warms the recorded boot working set in the background once the
  // client is downloaded. It runs alongside the game's own startup, so it gets
  // its own line rather than fighting setStartupProgress for the detail line.
  async function pollPrefetch() {
    const sub = el('loading-sub');
    // There is a window where the client is ready but the prefetch has not
    // started, so absence cannot mean "finished" immediately -- but it must
    // mean it eventually, or this polls forever when there is nothing to do.
    let idle = 0;
    for (;;) {
      let p;
      try {
        p = await (await fetch('progress.json', { cache: 'no-store' })).json();
      } catch (e) { return; }
      const f = p.prefetch;
      if (f && f.total && f.done < f.total) {
        idle = 0;
        sub.textContent =
          `Caching game data ahead: ${f.done} of ${f.total} chunks`;
      } else {
        sub.textContent = '';
        if (f && f.total) return;          // ran and finished
        if (++idle > 20) return;           // ~14s with none declared: none coming
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  return api;
})();
