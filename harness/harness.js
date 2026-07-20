// Host for Gw.wasm / Gw.jspi.wasm. Every platform service is injected on
// Module; see CLAUDE.md for the recovered contracts. Serve with gw.py.
//
// Module MUST be var: the glue does `var Module = typeof Module != 'undefined'
// ? Module : {}`, and a const/let here collides with it at parse time.
var Module;

(function () {
'use strict';

const LOG_LINES = 400;
const logBuf = [];

const log = (...a) => {
  console.log(...a);
  logBuf.push(a.join(' '));
  if (logBuf.length > LOG_LINES) logBuf.splice(0, logBuf.length - LOG_LINES);
  const el = document.getElementById('log');
  if (el && el.style.display !== 'none') {
    el.textContent = logBuf.join('\n');
    el.scrollTop = el.scrollHeight;
  }
};

window.gwLog = (on = true) => {
  const el = document.getElementById('log');
  el.style.display = on ? 'block' : 'none';
  if (on) { el.textContent = logBuf.join('\n'); el.scrollTop = el.scrollHeight; }
  localStorage.setItem('gw.log', on ? 'on' : 'off');
  return on;
};

// The module's own startup stages, in the words it uses for them.
const STARTUP_LABELS = {
  connecting: 'Connecting…',
  downloading: 'Downloading game data…',
  decompressing: 'Decompressing…',
  loading: 'Loading…',
};

const SNAPSHOT_URL = 'Gw.snapshot';
const CRED_KEY = 'gw.credentials';
let useJspi = false;

// fileSize() is synchronous, so the size must be known before the glue loads.
let snapshotSize = null;
let snapshotChunkSize = 262144;
let snapshotChunkHashes = [];

// Chunk-aligned rather than range-keyed: the module repeats regions, not exact
// ranges, so aligned entries are shared between overlapping reads.
const CHUNK_CACHE_MAX = 256 * 1024 * 1024;   // against a 4.2GB image
const chunkCache = new Map();                // index -> Uint8Array, LRU order
let chunkCacheBytes = 0;

// Second tier surviving reloads, keyed by content hash so it stays valid across
// a snapshot update. storedHashes mirrors it synchronously because isCached()
// cannot await -- consulting memory alone made every eviction look like a miss
// and drove the module into re-caching regions it already had.
let chunkStore = null;
const storedHashes = new Set();
const hashOfKey = (url) => url.split('/').pop();
const chunkKey = (i) => `/__chunk__/${snapshotChunkHashes[i] || 'idx-' + i}`;

const stats = { reads: 0, bytes: 0, fromMemory: 0, fromStore: 0, fromNetwork: 0,
                coalesced: 0 };
let burstBytes = 0, burstTimer = null;

window.gwEvictMemory = () => {
  const n = chunkCache.size;
  chunkCache.clear();
  chunkCacheBytes = 0;
  return n;
};

window.gwStats = () => {
  const s = {
    reads: stats.reads,
    readMB: +(stats.bytes / 1048576).toFixed(1),
    chunksFromMemory: stats.fromMemory,
    chunksFromCacheStore: stats.fromStore,
    chunksFromNetwork: stats.fromNetwork,
    chunksCoalesced: stats.coalesced,
    memoryCacheMB: +(chunkCacheBytes / 1048576).toFixed(1),
    memoryCacheChunks: chunkCache.size,
  };
  console.table ? console.table(s) : console.log(s);
  return s;
};

const chunkRange = (offset, size) => [
  Math.floor(offset / snapshotChunkSize),
  Math.floor((offset + size - 1) / snapshotChunkSize),
];

// Re-insert on hit to move the entry to the LRU tail.
function cacheTouch(i) {
  const buf = chunkCache.get(i);
  if (buf !== undefined) { chunkCache.delete(i); chunkCache.set(i, buf); }
  return buf;
}

function cachePut(i, buf) {
  if (chunkCache.has(i)) return;
  chunkCache.set(i, buf);
  chunkCacheBytes += buf.length;
  while (chunkCacheBytes > CHUNK_CACHE_MAX && chunkCache.size > 1) {
    const oldest = chunkCache.keys().next().value;
    chunkCacheBytes -= chunkCache.get(oldest).length;
    chunkCache.delete(oldest);
  }
}

// One in-flight fetch per chunk, shared by every caller that wants it.
//
// The module issues cacheAsync over overlapping regions with a hundred-plus
// requests in flight, so without this the same chunk is fetched several times
// over: a measured boot made 3557 requests for 886 distinct chunks and moved
// 932MB to deliver 227MB. Deduping is the difference, and it lightens
// ArenaNet's load rather than adding to it.
const inflight = new Map();   // chunk index -> Promise<Uint8Array>

function chunkBytes(i) {
  const hit = cacheTouch(i);
  if (hit !== undefined) { stats.fromMemory++; return Promise.resolve(hit); }

  const pending = inflight.get(i);
  if (pending) { stats.coalesced++; return pending; }

  const p = (async () => {
    if (chunkStore) {
      try {
        const hit = await chunkStore.match(chunkKey(i));
        if (hit) {
          const buf = new Uint8Array(await hit.arrayBuffer());
          cachePut(i, buf);
          stats.fromStore++;
          return buf;
        }
      } catch (e) { /* fall through to network */ }
    }

    const start = i * snapshotChunkSize;
    const end = Math.min(start + snapshotChunkSize, snapshotSize) - 1;
    const res = await fetch(SNAPSHOT_URL, { headers: { Range: `bytes=${start}-${end}` } });
    if (!res.ok && res.status !== 206) throw new Error(`chunk ${i}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    cachePut(i, buf);
    stats.fromNetwork++;

    if (chunkStore) {
      // Recorded optimistically so isCached sees it at once; dropped if the
      // write fails, rather than claiming residency we do not have.
      const hash = hashOfKey(chunkKey(i));
      storedHashes.add(hash);
      chunkStore.put(chunkKey(i), new Response(buf)).catch(() => storedHashes.delete(hash));
    }
    return buf;
  })();

  // Cleared on settle either way: a failed fetch must not be cached as a
  // permanently pending promise that every later reader awaits forever.
  inflight.set(i, p);
  p.then(() => inflight.delete(i), () => inflight.delete(i));
  return p;
}

// Whole chunks only, so what lands in the cache is aligned and reusable.
async function fetchChunks(first, last, progress) {
  for (let i = first; i <= last; i++) {
    const buf = await chunkBytes(i);
    if (progress) progress(buf.length);
  }
}

// Assemble a byte range from cached chunks; null if any part is missing.
function readFromCache(offset, size) {
  const out = new Uint8Array(size);
  let pos = offset, written = 0;
  while (written < size) {
    const i = Math.floor(pos / snapshotChunkSize);
    const buf = cacheTouch(i);
    if (buf === undefined) return null;
    const off = pos - i * snapshotChunkSize;
    const take = Math.min(size - written, buf.length - off);
    if (take <= 0) return null;
    out.set(buf.subarray(off, off + take), written);
    written += take;
    pos += take;
  }
  return out;
}

// Host functions the glue awaits or calls .then() on. Returning undefined from
// one throws "Cannot read properties of undefined (reading 'then')" mid-connect.
const ASYNC_METHODS = new Set([
  'adProvider.showInterstitial', 'ageSignals.check',
  'shop.initialize', 'shop.inAppPurchase',
]);

// Call sites test `typeof Module.x.y === 'function'`, so every property must
// read back callable.
const stub = (name) => new Proxy({}, {
  get: (_, k) => (...args) => {
    const meth = `${name}.${String(k)}`;
    log('[stub]', meth, args.length ? `(${args.length} args)` : '');
    return ASYNC_METHODS.has(meth) ? Promise.resolve(undefined) : undefined;
  },
  has: () => true,
});

// The game renders to an OffscreenCanvas and presents each frame as an
// ImageBitmap; without this wiring it runs and paints nowhere visible. Mirrors
// Od() in the shipped launcher, which patches imports before instantiating.
function patchEgl(env) {
  if (!env || typeof env.eglCreateContext !== 'function') {
    return log('[warn] no eglCreateContext import — nothing will be presented');
  }

  const createContext = env.eglCreateContext;
  env.eglCreateContext = (...args) => {
    const visible = Module.canvas;
    visible.offscreen = new OffscreenCanvas(visible.width, visible.height);
    Module.canvas = visible.offscreen;          // context is created on this
    const ctx = createContext(...args);
    Module.canvas = visible;
    Module.canvas.context = visible.getContext('bitmaprenderer');
    log(`egl context on offscreen ${visible.width}x${visible.height}`);
    return ctx;
  };

  const swap = env.eglSwapBuffers;
  let firstFrame = true;
  env.eglSwapBuffers = (...args) => {
    const ok = swap(...args);
    if (ok && Module.canvas.offscreen && Module.canvas.context) {
      Module.canvas.context.transferFromImageBitmap(
        Module.canvas.offscreen.transferToImageBitmap());
    }
    if (firstFrame) { firstFrame = false; log('first frame presented'); }
    return ok;
  };

  // Keep the offscreen buffer matched, or we present at the wrong resolution.
  const setSize = env.emscripten_set_canvas_element_size;
  if (typeof setSize === 'function') {
    env.emscripten_set_canvas_element_size = (target, w, h) => {
      const rc = setSize(target, w, h);
      if (rc === 0 && Module.canvas.offscreen) {
        Module.canvas.offscreen.width = w;
        Module.canvas.offscreen.height = h;
      }
      return rc;
    };
  }
}

Module = {
  canvas: document.getElementById('canvas'),
  print: (t) => log(t),
  printErr: (t) => log('[err]', t),

  // Take over instantiation so the EGL imports can be patched first.
  instantiateWasm(imports, success) {
    patchEgl(imports.env);
    const url = useJspi ? 'Gw.jspi.wasm' : 'Gw.wasm';
    (async () => {
      try {
        const r = await WebAssembly.instantiateStreaming(fetch(url), imports);
        success(r.instance, r.module);
      } catch (e) {
        log('[warn] streaming instantiate failed, falling back:', e.message);
        const r = await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), imports);
        success(r.instance, r.module);
      }
    })();
    return {};   // signals that instantiation is in flight
  },

  // Both builds share an output basename, so Gw.jspi.js also asks for
  // "Gw.wasm". Without this it silently pairs with the Asyncify binary.
  locateFile: (path) => (useJspi && path === 'Gw.wasm') ? 'Gw.jspi.wasm' : path,

  image: {
    _handles: new Map(),
    _next: 1,

    // Only the snapshot is backed. image is a filesystem over the whole
    // manifest, so the module asks for other files (ChatFilter.ini among
    // them); handing back a handle makes fileSize answer 4.2GB for a small ini
    // and the module aborts allocating for it.
    open(path) {
      if (!/(^|[/\\])Gw\.snapshot$/i.test(path)) {
        log(`image.open ${path} -> 0 (not in the image)`);
        return 0;
      }
      const h = this._next++;
      this._handles.set(h, { path, url: SNAPSHOT_URL });
      log('image.open', path, '-> handle', h);
      return h;
    },

    // Synchronous by contract, hence the size read at boot.
    fileSize(handle) {
      if (!this._handles.has(handle)) return log('[warn] image.fileSize on unknown handle', handle), 0;
      if (snapshotSize === null) return log('[warn] image.fileSize but no snapshot size known'), 0;
      return snapshotSize;
    },

    close(handle) {
      log('image.close', handle);
      this._handles.delete(handle);
    },

    async readAsync(imageId, offset, _unused, buffer, bytes) {
      if (!this._handles.has(imageId)) throw new Error('bad image handle ' + imageId);
      let data = readFromCache(offset, bytes);
      if (data === null) {
        const [first, last] = chunkRange(offset, bytes);
        await fetchChunks(first, last);
        data = readFromCache(offset, bytes);
      }
      if (data === null || data.length !== bytes) {
        throw new Error(`image read ${offset}+${bytes}: assembled ${data && data.length}`);
      }
      stats.reads++;
      stats.bytes += bytes;

      // Summarise a burst once it goes quiet: these reads never reach run.py,
      // so without this a heavy load looks like nothing is happening.
      burstBytes += bytes;
      clearTimeout(burstTimer);
      burstTimer = setTimeout(() => {
        if (burstBytes > 4 * 1024 * 1024) {
          log(`image: read ${(burstBytes / 1048576).toFixed(1)}MB (mem ${stats.fromMemory}, ` +
              `store ${stats.fromStore}, net ${stats.fromNetwork} chunks)`);
        }
        burstBytes = 0;
      }, 400);

      Module.HEAPU8.set(data, buffer);
    },

    // The glue defaults to 1 when this is absent, so answering 0 blindly is
    // worse than not implementing it. Both tiers count as resident.
    isCached(handle, offset, size) {
      const [first, last] = chunkRange(offset, size);
      for (let i = first; i <= last; i++) {
        if (!chunkCache.has(i) && !storedHashes.has(hashOfKey(chunkKey(i)))) return 0;
      }
      return 1;
    },

    async cacheAsync(handle, offset, size, progress) {
      const [first, last] = chunkRange(offset, size);
      await fetchChunks(first, last, (n) => {
        try { progress(n); } catch (e) { log('[cache progress]', e); }
      });
    },
  },

  // Raw TCP via the relay gw.py runs on this same origin. The glue assigns
  // onopen/onclose/onmessage on the returned object and calls onmessage with
  // the payload, not an event.
  socket: {
    connect(destAddr) {
      log('socket.connect', destAddr);
      const ws = new WebSocket(`ws://${location.host}/?dest=${encodeURIComponent(destAddr)}`);
      ws.binaryType = 'arraybuffer';
      const sock = {
        onopen: null, onclose: null, onmessage: null,
        send: (data) => ws.send(data),
        close: () => ws.close(),
      };
      ws.onopen = () => sock.onopen && sock.onopen();
      ws.onclose = () => sock.onclose && sock.onclose();
      ws.onerror = () => log('socket error (is gw.py still running?)');
      ws.onmessage = (ev) => sock.onmessage && sock.onmessage(new Uint8Array(ev.data));
      return sock;
    },
  },

  dns: {
    async resolve(name) {
      log('dns.resolve', name);
      const res = await fetch(`/dns?name=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error('dns lookup failed: ' + res.status);
      return (await res.text()).trim();
    },
  },

  shop:       stub('shop'),
  adProvider: stub('adProvider'),
  browser:    stub('browser'),
  events:     stub('events'),
  ageSignals: stub('ageSignals'),

  // The module has its own login screen: it asks for stored credentials, and a
  // rejection makes it prompt, then hands back what was typed. So the harness
  // is never told a password, only asked to keep one.
  //
  // NOT secure storage. On a device this is Keychain; here it is plaintext in
  // localStorage, readable by any script on this origin. Clear with
  // localStorage.removeItem('gw.credentials').
  //
  // All three or none: the glue's missing-method branches call the result
  // callback without returning, so a partial object throws.
  secureStorage: {
    async getCredentials() {
      const raw = localStorage.getItem(CRED_KEY);
      if (!raw) {
        log('secureStorage: none stored — the module should prompt');
        throw new Error('no stored credentials');
      }
      const creds = JSON.parse(raw);
      log(`secureStorage: returning credentials for ${creds.username}`);
      return creds;
    },
    async storeCredentials(username, password) {
      localStorage.setItem(CRED_KEY, JSON.stringify({ username, password }));
      log(`secureStorage: stored credentials for ${username} (plaintext localStorage)`);
    },
    async clearCredentials() {
      localStorage.removeItem(CRED_KEY);
      log('secureStorage: cleared');
    },
  },

  // No federated auth here: running Steam/Google/Apple flows would mean
  // brokering third-party OAuth and holding identity tokens. Reporting no
  // providers falls the module back to its own email/password screen.
  //
  // getAuthToken is absent rather than stubbed, and nativeAccount is left
  // undefined: with no provider promise the glue reports a clean "no token".
  login: {
    hasProvider(name) {
      log(`login.hasProvider(${name}) -> false (no federated auth in this harness)`);
      return false;
    },
  },

  // 'onDemand' or 'preload'. The launcher hardcodes onDemand, but that is a
  // phone; gwPatchMode('preload') switches, read once at image init.
  getPatchMode: async () => localStorage.getItem('gw.patchMode') || 'onDemand',

  // The module narrates its own startup -- the only direct view into which
  // stage it thinks it is in, and what drives the loading bar once the glue
  // is running. Stage names come from the data section: connecting,
  // downloading, decompressing, complete.
  //
  // For 'downloading' the args are (percent, bytesDone, bytesPerSec,
  // secondsRemaining) -- matching the module's own "Downloading %u.%uMB
  // (%uKB/sec)" string. The other stages carry no measurable total.
  setStartupProgress(stage, a, b, c, d) {
    log(`[startup] ${stage}`, [a, b, c, d].filter((v) => v !== undefined).join(' '));
    const L = window.gwLoading;
    if (!L) return;
    const s = String(stage || '').toLowerCase();
    if (s === 'complete') return L.done();
    if (s === 'downloading' && typeof a === 'number') {
      const eta = d > 0 ? `${Math.ceil(d / 60)} min remaining` : '';
      const rate = c > 0 ? `${(c / 1048576).toFixed(1)} MB/s` : '';
      return L.set('Downloading game data…', a / 100,
                   [rate, eta].filter(Boolean).join(' · '));
    }
    L.set(STARTUP_LABELS[s] || 'Loading…', null);
  },

  handleFatalReadError: () => log('[err] module reported a fatal read error'),
  setBuildInfo: (info) => log(`build info: program=${info.programId} build=${info.buildId}`),

  // Computed as the launcher computes it; also drives oskIsModal.
  isMobile: /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent)
            || navigator.maxTouchPoints > 0,

  // No setWindowTitle: modern Emscripten asserts that option was removed and
  // aborts startup if it is present.
  requestFullScreen: () => Module.canvas.requestFullscreen?.(),
  requestFullscreen: () => Module.canvas.requestFullscreen?.(),

  onRuntimeInitialized() { log('runtime initialised'); },
};

let wired = false;

function appendGlue(src, candidates) {
  useJspi = src === 'Gw.jspi.js';
  log('loading', src, `(wasm: ${useJspi ? 'Gw.jspi.wasm' : 'Gw.wasm'}) ...`);
  const s = document.createElement('script');
  s.src = src;
  s.onerror = () => {
    log(`[warn] ${src} not available`);
    if (candidates) loadGlue(candidates.slice(1));
  };
  document.body.appendChild(s);
}

// Wiring must happen once: loadGlue recurses when the preferred glue is
// missing, and re-registering gave duplicate touch events and focus handlers.
function loadGlue(candidates) {
  const src = candidates[0];
  if (!src) {
    window.gwLoading?.fail('No game build could be loaded.');
    return log('[err] no glue could be loaded — check that gw.py finished downloading');
  }
  if (wired) return appendGlue(src);
  wired = true;
  useJspi = src === 'Gw.jspi.js';

  // CSS only stretches the display size; without this the module renders at
  // the 300x150 default and the OffscreenCanvas is created that size too.
  const c = Module.canvas;
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  log(`canvas ${c.width}x${c.height}`);

  // Keys only reach the module while the canvas holds focus, and focus is
  // easily lost. Refocus only when it has actually gone elsewhere -- calling
  // focus() mid-click perturbs a sequence the module is timing.
  c.focus();
  c.addEventListener('pointerdown', () => {
    if (!Module.oskIsActive && document.activeElement !== c) c.focus();
  }, true);

  // Outside a Capacitor WebView the client rewrites API calls through its own
  // origin, but builds the URL from location.hostname with no port -- so it
  // lands on :80 and gets ECONNREFUSED. Put our port back; run.py proxies on.
  if (location.port) {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        const u = new URL(url, location.href);
        if (u.hostname === location.hostname && u.port !== location.port &&
            (u.port === '' || u.port === '80' || u.port === '443')) {
          u.protocol = location.protocol;
          u.port = location.port;
          log(`api: ${method} ${u.pathname}`);
          return origOpen.call(this, method, u.toString(), ...rest);
        }
      } catch (e) { /* not a URL we can rewrite */ }
      return origOpen.call(this, method, url, ...rest);
    };
  }

  // Browsers refuse to start an AudioContext before a user gesture.
  const resumeAudio = () => {
    const ctx = Module.SDL2?.audioContext || Module.audioContext;
    if (ctx && ctx.state === 'suspended') ctx.resume().then(() => log('audio: resumed')).catch(() => {});
  };
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, resumeAudio, true);
  }

  // ---- mouse -> touch --------------------------------------------------
  // The module imports touch events but no dblclick, so it does its own
  // gesture timing. Measured: touch-only breaks movement, mouse-only breaks
  // double-click, and touch on every click double-handles (the tap wins over
  // the click). So a single click stays purely mouse, and only a rapid second
  // click emits taps -- both of them, since the game never saw the first.
  //
  // Modes: dbltap (default), augment, translate, off. Left button only;
  // right-drag turns the camera and stays as mouse.
  let touchMode = localStorage.getItem('gw.touchMode') || 'dbltap';
  const DBL_MS = 400, DBL_PX = 10;
  let lastClick = null, pendingTap = null, touchId = 0, active = null;

  window.gwPatchMode = (m) => {
    if (!['onDemand', 'preload'].includes(m)) return log(`[warn] unknown patch mode ${m}`);
    localStorage.setItem('gw.patchMode', m);
    log(`patch mode: ${m} (reload to apply)`);
    return m;
  };

  window.gwTouchMode = (m) => {
    if (!['dbltap', 'translate', 'augment', 'off'].includes(m)) return log(`[warn] unknown mode ${m}`);
    touchMode = m;
    localStorage.setItem('gw.touchMode', m);
    log(`touch mode: ${m}`);
    return m;
  };

  const mkTouch = (x, y, id) => new Touch({
    identifier: id, target: c,
    clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
    radiusX: 5, radiusY: 5, rotationAngle: 0, force: 1,
  });

  const sendTouch = (type, touch) => {
    const ended = type === 'touchend' || type === 'touchcancel';
    c.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      touches: ended ? [] : [touch],
      targetTouches: ended ? [] : [touch],
      changedTouches: [touch],
    }));
  };

  // Timers are tracked so an in-flight pair can be cancelled: a tap landing
  // inside a later click's mouse stream trips the game's input assertion
  // (evt.buttonState, FrMouse.cpp:486).
  let tapTimers = [];
  const cancelTaps = () => { tapTimers.forEach(clearTimeout); tapTimers = []; };
  const tapAt = (x, y, delay) => tapTimers.push(setTimeout(() => {
    const t = mkTouch(x, y, ++touchId);
    sendTouch('touchstart', t);
    tapTimers.push(setTimeout(() => sendTouch('touchend', t), 30));
  }, delay));

  // Registered in capture and before the glue loads, so these run ahead of the
  // module's own listeners -- which is what makes suppression possible.
  c.addEventListener('mousedown', (e) => {
    if (touchMode === 'off' || e.button !== 0) return;
    if (touchMode === 'dbltap') {
      cancelTaps();          // nothing may land between this down and its up
      const now = performance.now();
      const near = lastClick && now - lastClick.t < DBL_MS &&
        Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < DBL_PX;
      if (near) { lastClick = null; pendingTap = { x: e.clientX, y: e.clientY }; }
      else lastClick = { t: now, x: e.clientX, y: e.clientY };
      return;                // mouse always passes through
    }
    active = mkTouch(e.clientX, e.clientY, ++touchId);
    sendTouch('touchstart', active);
    if (touchMode === 'translate') e.stopImmediatePropagation();
  }, true);

  c.addEventListener('mousemove', (e) => {
    if (touchMode === 'off' || touchMode === 'dbltap' || !active) return;
    active = mkTouch(e.clientX, e.clientY, active.identifier);
    sendTouch('touchmove', active);
    if (touchMode === 'translate') e.stopImmediatePropagation();
  }, true);

  c.addEventListener('mouseup', (e) => {
    if (touchMode === 'dbltap') {
      if (e.button !== 0 || !pendingTap) return;
      const { x, y } = pendingTap;
      pendingTap = null;
      tapAt(x, y, 20);       // both taps, after the mouse stream has finished
      tapAt(x, y, 100);
      return;
    }
    if (touchMode === 'off' || e.button !== 0 || !active) return;
    const t = mkTouch(e.clientX, e.clientY, active.identifier);
    active = null;
    sendTouch('touchend', t);
    if (touchMode === 'translate') e.stopImmediatePropagation();
  }, true);

  // A drag leaving the canvas would otherwise strand a touch as held.
  for (const ev of ['mouseleave', 'blur']) {
    c.addEventListener(ev, () => {
      if (!active) return;
      const t = active;
      active = null;
      sendTouch('touchcancel', t);
    }, true);
  }

  window.gwTap = (x, y) => {
    const t = mkTouch(x, y, ++touchId);
    sendTouch('touchstart', t);
    setTimeout(() => sendTouch('touchend', t), 40);
  };
  window.gwDoubleTap = (x, y) => { window.gwTap(x, y); setTimeout(() => window.gwTap(x, y), 120); };
  log(`touch mode: ${touchMode} (gwTouchMode('off') to disable)`);

  // ---- pointer lock for right-drag camera -------------------------------
  // Without it the cursor leaves the window mid-swing. While locked
  // clientX/clientY freeze and only movementX/Y move, so we feed the module a
  // virtual cursor: accumulate the movement and re-dispatch mousemove with
  // those coordinates. Unclamped -- clamping would zero the deltas and stall
  // the camera, which is the bug being fixed.
  //
  // Promoted on movement rather than on mousedown: capturing the cursor the
  // moment the button goes down costs the plain right-click.
  const DRAG_PX = 4;
  let lockEnabled = localStorage.getItem('gw.pointerLock') !== 'off';
  let virt = null, rmb = null;

  window.gwPointerLock = (on) => {
    lockEnabled = !!on;
    localStorage.setItem('gw.pointerLock', on ? 'on' : 'off');
    if (!on && document.pointerLockElement === c) document.exitPointerLock();
    log(`pointer lock: ${on ? 'enabled' : 'disabled'}`);
    return lockEnabled;
  };

  c.addEventListener('mousedown', (e) => {
    if (e.button === 2) rmb = { x: e.clientX, y: e.clientY, locked: false };
  }, true);

  c.addEventListener('mousemove', (e) => {
    if (lockEnabled && rmb && !rmb.locked && e.isTrusted &&
        Math.hypot(e.clientX - rmb.x, e.clientY - rmb.y) > DRAG_PX) {
      rmb.locked = true;
      virt = { x: e.clientX, y: e.clientY };
      // A plain call, no unadjustedMovement: that option is refused often
      // enough that its fallback matters, and the fallback ran from a promise
      // callback, outside the gesture context pointer lock requires.
      if (document.pointerLockElement !== c) {
        try { c.requestPointerLock(); } catch (err) { log('[warn] pointer lock refused:', err.message); }
      }
    }
    if (document.pointerLockElement !== c || !virt || !e.isTrusted) return;
    e.stopImmediatePropagation();
    virt.x += e.movementX;
    virt.y += e.movementY;
    c.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, composed: true,
      clientX: virt.x, clientY: virt.y, screenX: virt.x, screenY: virt.y,
      movementX: e.movementX, movementY: e.movementY,
      buttons: e.buttons, button: e.button,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
    }));
  }, true);

  // blur too: a button released while unfocused never produces a mouseup here
  // and would strand the cursor locked.
  const releaseLock = () => {
    virt = null;
    rmb = null;
    if (document.pointerLockElement === c) document.exitPointerLock();
  };
  c.addEventListener('mouseup', (e) => { if (e.button === 2) releaseLock(); }, true);
  window.addEventListener('blur', releaseLock);
  document.addEventListener('pointerlockerror', () =>
    log('[warn] pointer lock failed (needs a user gesture, and a focused document)'));

  // Right-drag turns the camera, so the context menu has to go -- but
  // shift+right-click still reaches it, or there is no right-click route into
  // devtools. The shipped client suppresses it unconditionally.
  c.addEventListener('contextmenu', (e) => { if (!e.shiftKey) e.preventDefault(); });

  // Text entry runs through these, not through keydown on the canvas. Stray
  // focus must bounce off, or a field silently swallows keys meant for the game.
  Module.oskInput = {
    text:      document.getElementById('osk-input-text'),
    email:     document.getElementById('osk-input-email'),
    password:  document.getElementById('osk-input-password'),
    number:    document.getElementById('osk-input-number'),
    multiline: document.getElementById('osk-input-multiline'),
  };
  Module.oskIsModal = Module.isMobile;   // on desktop the field stays behind the canvas

  for (const type in Module.oskInput) {
    const el = Module.oskInput[type];
    if (!el) { log(`[warn] missing OSK element for "${type}"`); continue; }
    el.addEventListener('focus', () => { if (Module.oskActiveInput !== el) el.blur(); });
    if (Module.oskIsModal) el.parentElement.classList.add('osk-input-container-modal');
  }
  log(`osk: ${Object.keys(Module.oskInput).length} fields, modal=${Module.oskIsModal}`);

  appendGlue(src, candidates);
}

(async function boot() {
  if (localStorage.getItem('gw.log') === 'on') window.gwLog(true);

  // gw.py serves the page before it has finished fetching the client, so that
  // this screen can show the download rather than the user staring at a
  // terminal. Nothing below can run until those files exist.
  if (!await window.gwLoading.waitForClient()) return;
  window.gwLoading.set('Preparing…', null);

  try {
    chunkStore = await caches.open('gw.chunks.v1');
    for (const req of await chunkStore.keys()) storedHashes.add(hashOfKey(req.url));
    if (storedHashes.size) log(`chunk store: ${storedHashes.size} chunks already resident`);
  } catch (e) {
    log('[warn] no Cache API; chunks will not survive reload:', e.message);
  }

  // The decompressed image lives in IDBFS; without a grant that is
  // best-effort storage the browser may clear. Mirrors _loadPersist().
  try {
    if (navigator.storage?.persist && !await navigator.storage.persisted()) {
      log(await navigator.storage.persist()
        ? 'storage: persistence granted'
        : '[warn] storage persistence refused — the browser may evict image data');
    }
  } catch (e) {
    log('[warn] storage persistence check failed:', e.message);
  }

  try {
    const res = await fetch('snapshot-chunks.json');
    if (res.ok) {
      const idx = await res.json();
      snapshotSize = idx.size;
      if (idx.chunkSize) snapshotChunkSize = idx.chunkSize;
      snapshotChunkHashes = idx.chunkHashes || [];
      log('snapshot:', snapshotSize, 'bytes,', snapshotChunkHashes.length,
          'chunks of', snapshotChunkSize);
    } else {
      log(`[warn] no snapshot-chunks.json (HTTP ${res.status})`);
    }
  } catch (e) {
    log('[warn] could not read snapshot-chunks.json:', e.message);
  }

  // JSPI suspends via engine stack switching; Asyncify instruments every
  // suspendable function, hence 27.8MB against 8.2MB. iOS is excluded by the
  // real client regardless of WebKit support, so match that.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const jspi = !isIOS && ('Suspending' in WebAssembly);
  log(`build: ${jspi ? 'JSPI' : 'Asyncify'}` +
      (isIOS ? ' (iOS)' : jspi ? '' : ' (no WebAssembly.Suspending)'));

  // Fall back if the preferred glue is absent: the pair downloaded may not be
  // the pair this browser would pick.
  window.gwLoading.set('Starting the game…', null);
  loadGlue(jspi ? ['Gw.jspi.js', 'Gw.js'] : ['Gw.js', 'Gw.jspi.js']);
})();

})();
