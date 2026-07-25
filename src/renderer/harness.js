// Host for Gw.jspi.wasm inside the Electron renderer. Platform services are
// injected on Module; privileged work goes through window.gwNative.
//
// Module MUST be var: the glue does `var Module = typeof Module != 'undefined'
// ? Module : {}`, and a const/let here collides with it at parse time.
/** @type {any} ArenaNet's generated Emscripten surface is the dynamic boundary. */
var Module;

(function () {
'use strict';

const LOG_LINES = 400;
/** @type {string[]} */
const logBuf = [];
/** @type {WebAssembly.Instance | null} */
let gameWasmInstance = null;
/** @type {WebAssembly.Module | null} */
let gameWasmModule = null;
let disposeSocketHost = () => {};
const native = () => window.gwNative;
/**
 * @param {import('../shared/diagnostics.js').RendererMilestone} name
 * @param {import('../shared/diagnostics.js').RendererMilestoneFields} [fields]
 */
const milestone = (name, fields) => {
  void native().diagnostics
    .recordRendererMilestone(name, performance.now() * 1000, fields)
    .catch(() => {});
};

/** @param {...unknown} a */
const log = (...a) => {
  console.log(...a);
  logBuf.push(a.map(String).join(' '));
  if (logBuf.length > LOG_LINES) logBuf.splice(0, logBuf.length - LOG_LINES);
  const el = document.getElementById('log');
  if (el && el.style.display !== 'none') {
    el.textContent = logBuf.join('\n');
    el.scrollTop = el.scrollHeight;
  }
};

window.gwLog = (on = true) => {
  const el = document.getElementById('log');
  if (!el) return false;
  el.style.display = on ? 'block' : 'none';
  if (on) { el.textContent = logBuf.join('\n'); el.scrollTop = el.scrollHeight; }
  return on;
};

const STARTUP_LABELS = {
  connecting: 'Starting Guild Wars',
  downloading: 'Preparing files needed to start',
  decompressing: 'Preparing files needed to start',
  loading: 'Starting Guild Wars',
};

const SNAPSHOT_URL = 'Gw.snapshot';
/** @type {import('../shared/contracts.js').AppSettings | null} */
let appSettings = null;
/** @type {GameInputController | null} */
let inputHost = null;
/** @param {import('../shared/contracts.js').AppSettings['cursorTheme']} theme */
function applyCursorTheme(theme) {
  document.documentElement.dataset.cursorTheme = theme;
}
window.gwApplySettings = (next) => {
  const previousScale = appSettings?.renderScale;
  const updated = { ...next };
  appSettings = updated;
  inputHost?.applySettings(updated);
  applyCursorTheme(updated.cursorTheme);
  if (previousScale !== undefined && updated.renderScale !== previousScale) {
    window.dispatchEvent(new globalThis.Event('resize'));
  }
  window.gwDiagnostics?.setVisible(updated.showDiagnostics);
  if (inputHost) log('settings applied');
};

// fileSize() is synchronous, so the size must be known before the glue loads.
/** @type {number | null} */
let snapshotSize = null;
let snapshotChunkSize = 262144;
/** @type {string[]} */
let snapshotChunkHashes = [];

// Renderer memory is disposable; native chunk residency lives in the main process.
const CHUNK_CACHE_MAX = 256 * 1024 * 1024;
/** @type {Map<number, Uint8Array>} */
const chunkCache = new Map();
let chunkCacheBytes = 0;

// Derived from snapshot-metadata residentBits — isCached must stay synchronous.
/** @type {Set<string>} */
const residentHashes = new Set();
/** @param {number} i */
const hashOf = (i) => snapshotChunkHashes[i] || '';

const stats = {
  reads: 0,
  bytes: 0,
  fromMemory: 0,
  fromNative: 0,
  coalesced: 0,
  evictions: 0,
  promotions: 0,
};
let burstBytes = 0;
/** @type {number | null} */
let burstTimer = null;
let lastSnapshotError = '';
let gamepadImportsAvailable = false;

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
    chunksFromNative: stats.fromNative,
    chunksCoalesced: stats.coalesced,
    memoryCacheMB: +(chunkCacheBytes / 1048576).toFixed(1),
    memoryCacheChunks: chunkCache.size,
    residentHashes: residentHashes.size,
    gamepadImports: gamepadImportsAvailable,
  };
  if (console.table) console.table(s);
  else console.log(s);
  return s;
};

/** @param {number} i */
function markResident(i) {
  const h = hashOf(i);
  if (h) residentHashes.add(h);
}

/** @param {Uint8Array} bits */
function applyResidentBits(bits) {
  if (!bits || !bits.length) return;
  for (let i = 0; i < snapshotChunkHashes.length; i++) {
    const byte = bits[i >> 3];
    if (byte !== undefined && (byte & (1 << (i & 7)))) markResident(i);
  }
}

/**
 * @param {number} offset
 * @param {number} size
 * @returns {[number, number]}
 */
const chunkRange = (offset, size) => [
  Math.floor(offset / snapshotChunkSize),
  Math.floor((offset + size - 1) / snapshotChunkSize),
];

// Re-insert on hit to move the entry to the LRU tail.
/** @param {number} i */
function cacheTouch(i) {
  const buf = chunkCache.get(i);
  if (buf !== undefined) { chunkCache.delete(i); chunkCache.set(i, buf); }
  return buf;
}

/** @param {number} i @param {Uint8Array} buf */
function cachePut(i, buf) {
  if (chunkCache.has(i)) return;
  chunkCache.set(i, buf);
  chunkCacheBytes += buf.length;
  while (chunkCacheBytes > CHUNK_CACHE_MAX && chunkCache.size > 1) {
    const oldest = chunkCache.keys().next().value;
    if (oldest === undefined) break;
    const oldestBuffer = chunkCache.get(oldest);
    if (!oldestBuffer) break;
    chunkCacheBytes -= oldestBuffer.length;
    chunkCache.delete(oldest);
    stats.evictions++;
    window.gwDiagnostics?.scheduler('eviction');
  }
}

const MAX_CHUNK_REQUESTS = 8;
/**
 * @typedef {{
 *   index: number,
 *   priority: 'demand' | 'prefetch',
 *   state: 'queued' | 'active',
 *   promise: Promise<Uint8Array>,
 *   resolve: (value: Uint8Array) => void,
 *   reject: (reason?: unknown) => void
 * }} ChunkTask
 */
/** @type {Map<number, ChunkTask>} */
const inflight = new Map();
/** @type {ChunkTask[]} */
const demandQueue = [];
/** @type {ChunkTask[]} */
const prefetchQueue = [];
let activeDemand = 0;
let activePrefetch = 0;
let schedulerStopped = false;

window.gwSnapshotState = () => ({
  memoryCacheBytes: chunkCacheBytes,
  memoryCacheChunks: chunkCache.size,
  pendingChunks: inflight.size,
  activeDemand,
  activePrefetch,
  queuedDemand: demandQueue.length,
  queuedPrefetch: prefetchQueue.length,
});

/** @param {ChunkTask} task */
function promote(task) {
  if (task.priority !== 'prefetch' || task.state !== 'queued') return;
  const index = prefetchQueue.indexOf(task);
  if (index < 0) return;
  prefetchQueue.splice(index, 1);
  task.priority = 'demand';
  demandQueue.push(task);
  stats.promotions++;
  window.gwDiagnostics?.scheduler('promotion');
}

function drainChunkQueue() {
  while (activeDemand + activePrefetch < MAX_CHUNK_REQUESTS) {
    const task = demandQueue.shift() || prefetchQueue.shift();
    if (!task) return;
    if (snapshotSize === null) {
      task.reject(new Error('snapshot metadata is unavailable'));
      inflight.delete(task.index);
      continue;
    }
    if (schedulerStopped && task.priority === 'prefetch') {
      task.reject(new Error('background download stopped'));
      inflight.delete(task.index);
      continue;
    }
    task.state = 'active';
    if (task.priority === 'demand') activeDemand++;
    else activePrefetch++;
    const start = task.index * snapshotChunkSize;
    const end = Math.min(start + snapshotChunkSize, snapshotSize) - 1;
    void fetch(SNAPSHOT_URL, {
      headers: {
        Range: `bytes=${start}-${end}`,
        'X-GW-Priority': task.priority,
      },
    }).then(async (res) => {
      if (!res.ok && res.status !== 206) {
        const detail = await res.text();
        throw new Error(detail || `Game data download failed (HTTP ${res.status}).`);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      cachePut(task.index, buf);
      markResident(task.index);
      stats.fromNative++;
      window.gwDiagnostics?.cache('native');
      task.resolve(buf);
    }).catch((error) => {
      lastSnapshotError = error instanceof Error ? error.message : String(error);
      task.reject(error);
    }).finally(() => {
      inflight.delete(task.index);
      if (task.priority === 'demand') activeDemand--;
      else activePrefetch--;
      drainChunkQueue();
    });
  }
}

addEventListener('beforeunload', () => {
  schedulerStopped = true;
  disposeSocketHost();
  for (const task of prefetchQueue.splice(0)) {
    inflight.delete(task.index);
    task.reject(new Error('background download stopped'));
  }
});

/**
 * @param {number} i
 * @param {'demand' | 'prefetch'} priority
 * @returns {Promise<Uint8Array>}
 */
function chunkBytes(i, priority) {
  const hit = cacheTouch(i);
  if (hit !== undefined) {
    stats.fromMemory++;
    window.gwDiagnostics?.cache('memory');
    return Promise.resolve(hit);
  }

  const pending = inflight.get(i);
  if (pending) {
    stats.coalesced++;
    window.gwDiagnostics?.cache('coalesced');
    if (priority === 'demand') promote(pending);
    return pending.promise;
  }

  /** @type {(value: Uint8Array) => void} */
  let resolve = () => {};
  /** @type {(reason?: unknown) => void} */
  let reject = () => {};
  /** @type {Promise<Uint8Array>} */
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  /** @type {ChunkTask} */
  const task = { index: i, priority, state: 'queued', promise, resolve, reject };
  inflight.set(i, task);
  (priority === 'demand' ? demandQueue : prefetchQueue).push(task);
  drainChunkQueue();
  return promise;
}

/** @param {number} first @param {number} last */
async function fetchDemandChunks(first, last) {
  return Promise.all(
    Array.from({ length: last - first + 1 }, (_, n) =>
      chunkBytes(first + n, 'demand')),
  );
}

/**
 * @param {number} first
 * @param {number} last
 * @param {((bytes: number) => void) | undefined} progress
 */
async function fetchPrefetchChunks(first, last, progress) {
  for (let i = first; i <= last; i++) {
    const buf = await chunkBytes(i, 'prefetch');
    if (progress) progress(buf.length);
  }
}

/**
 * @param {number} offset
 * @param {number} size
 * @param {(index: number) => Uint8Array | undefined} chunk
 */
function assembleRange(offset, size, chunk) {
  const [first, last] = chunkRange(offset, size);
  if (first === last) {
    const buf = chunk(first);
    if (buf === undefined) return null;
    const start = offset - first * snapshotChunkSize;
    return buf.subarray(start, start + size);
  }
  const out = new Uint8Array(size);
  let pos = offset, written = 0;
  while (written < size) {
    const i = Math.floor(pos / snapshotChunkSize);
    const buf = chunk(i);
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

// Assemble a byte range from cached chunks; null if any part is missing.
/** @param {number} offset @param {number} size */
function readFromCache(offset, size) {
  return assembleRange(offset, size, cacheTouch);
}

Module = {
  canvas:
    /** @type {HTMLCanvasElement} */ (document.getElementById('canvas')),
  /** @param {unknown} t */
  print: (t) => log(t),
  /** @param {unknown} t */
  printErr: (t) => log('[err]', t),

  // Take over instantiation so the EGL imports can be patched first.
  /**
   * @param {any} imports ArenaNet's generated WebAssembly imports.
  * @param {(instance: WebAssembly.Instance, module: WebAssembly.Module) => void} success
  */
  instantiateWasm(imports, success) {
    window.gwInstallTemplateSaveCompatibility(imports, Module);
    window.gwInstallTemplateFilesystemTrace({
      imports,
      module: Module,
    });
    window.gwInstallGraphics({
      env: imports.env,
      module: Module,
      renderScale: () => appSettings?.renderScale ?? 1,
      firstFrame: () => {
        performance.mark('gw.frame.first-submit');
        milestone('frame.firstSubmit');
        void native().client.healthy().catch((error) => {
          log(
            '[warn] client health confirmation failed:',
            error instanceof Error ? error.message : String(error),
          );
        });
        log('first frame presented');
      },
      log,
    });
    const gamepadImports = [
      'emscripten_sample_gamepad_data',
      'emscripten_set_gamepadconnected_callback_on_thread',
      'emscripten_set_gamepaddisconnected_callback_on_thread',
      'emscripten_get_num_gamepads',
      'emscripten_get_gamepad_status',
    ];
    gamepadImportsAvailable =
      typeof navigator.getGamepads === 'function' &&
      gamepadImports.every((name) => typeof imports.env?.[name] === 'function');
    log(`gamepad host: ${gamepadImportsAvailable ? 'available' : 'unavailable'}`);
    const url = 'Gw.jspi.wasm';
    performance.mark('gw.wasm.instantiate.begin');
    milestone('wasm.instantiate.begin');
    window.gwAutomation?.set('runtime.instantiating');
    (async () => {
      let result;
      try {
        result = await WebAssembly.instantiateStreaming(fetch(url), imports);
      } catch (e) {
        log(
          '[warn] streaming instantiate failed, falling back:',
          e instanceof Error ? e.message : String(e),
        );
        milestone('wasm.streamingFallback');
        result = await WebAssembly.instantiate(
          await (await fetch(url)).arrayBuffer(),
          imports,
        );
      }
      performance.mark('gw.wasm.instantiate.end');
      milestone('wasm.instantiate.end');
      gameWasmInstance = result.instance;
      gameWasmModule = result.module;
      success(result.instance, result.module);
    })().catch((error) => {
      window.gwDiagnostics?.event('client.glueLoadFailed', error);
      log(
        '[err] WASM instantiation failed:',
        error instanceof Error ? error.message : String(error),
      );
      window.gwLoading?.fail('The game client could not start.');
    });
    return {};   // signals that instantiation is in flight
  },

  // Both builds share an output basename, so Gw.jspi.js also asks for
  // "Gw.wasm". Without this it silently pairs with the Asyncify binary.
  /** @param {string} path */
  locateFile: (path) => path === 'Gw.wasm' ? 'Gw.jspi.wasm' : path,

  image: {
    _handles: new Map(),
    _next: 1,

    // Only the snapshot is backed. image is a filesystem over the whole
    // manifest, so the module asks for other files (ChatFilter.ini among
    // them); handing back a handle makes fileSize answer 4.2GB for a small ini
    // and the module aborts allocating for it.
    /** @param {string} path */
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
    /** @param {number} handle */
    fileSize(handle) {
      if (!this._handles.has(handle)) return log('[warn] image.fileSize on unknown handle', handle), 0;
      if (snapshotSize === null) return log('[warn] image.fileSize but no snapshot size known'), 0;
      return snapshotSize;
    },

    /** @param {number} handle */
    close(handle) {
      log('image.close', handle);
      this._handles.delete(handle);
    },

    /**
     * @param {number} imageId
     * @param {number} offset
     * @param {unknown} _unused
     * @param {number} buffer
     * @param {number} bytes
     */
    async readAsync(imageId, offset, _unused, buffer, bytes) {
      if (!this._handles.has(imageId)) throw new Error('bad image handle ' + imageId);
      const started = performance.now();
      let data = readFromCache(offset, bytes);
      const source = data === null ? 'native' : 'memory';
      if (data === null) {
        const [first, last] = chunkRange(offset, bytes);
        const fetched = await fetchDemandChunks(first, last);
        data = assembleRange(offset, bytes, (index) => fetched[index - first]);
      }
      if (data === null || data.length !== bytes) {
        throw new Error(`image read ${offset}+${bytes}: assembled ${data && data.length}`);
      }
      stats.reads++;
      stats.bytes += bytes;

      // Summarise a burst once it goes quiet for the optional game console.
      burstBytes += bytes;
      if (burstTimer !== null) clearTimeout(burstTimer);
      burstTimer = setTimeout(() => {
        if (burstBytes > 4 * 1024 * 1024) {
          log(`image: read ${(burstBytes / 1048576).toFixed(1)}MB (mem ${stats.fromMemory}, ` +
              `native ${stats.fromNative} chunks)`);
        }
        burstBytes = 0;
      }, 400);

      Module.HEAPU8.set(data, buffer);
      window.gwDiagnostics?.snapshot((performance.now() - started) * 1000, bytes, source);
    },

    // Memory plus native residency both count; eviction must not erase native.
    /**
     * @param {number} handle
     * @param {number} offset
     * @param {number} size
     */
    isCached(handle, offset, size) {
      const [first, last] = chunkRange(offset, size);
      for (let i = first; i <= last; i++) {
        if (!chunkCache.has(i) && !residentHashes.has(hashOf(i))) return 0;
      }
      return 1;
    },

    /**
     * @param {number} handle
     * @param {number} offset
     * @param {number} size
     * @param {(bytes: number) => void} progress
     */
    async cacheAsync(handle, offset, size, progress) {
      const [first, last] = chunkRange(offset, size);
      await fetchPrefetchChunks(first, last, (n) => {
        try { progress(n); } catch (e) { log('[cache progress]', e); }
      });
    },
  },

  dns: {
    /** @param {string} name */
    async resolve(name) {
      log('dns.resolve', name);
      return native().dns.resolve(name);
    },
  },

  // All three methods must exist: the generated glue's missing-method branches
  // call their fallback without returning. Main owns encrypted persistence.
  secureStorage: {
    async getCredentials() {
      const stored = await native().credentials.load();
      if (!stored) {
        log('secureStorage: no saved credentials — the module should prompt');
        throw new Error('no stored credentials');
      }
      log('secureStorage: returning saved credentials');
      return stored;
    },
    /** @param {unknown} username @param {unknown} password */
    async storeCredentials(username, password) {
      if (typeof username !== 'string' || typeof password !== 'string') {
        throw new TypeError('credentials must be strings');
      }
      await native().credentials.save({ username, password });
      log('secureStorage: saved encrypted credentials');
    },
    async clearCredentials() {
      await native().credentials.clear();
      log('secureStorage: cleared saved credentials');
    },
  },

  // No federated auth: reporting no providers falls back to email/password.
  // getAuthToken is absent and nativeAccount is left undefined on purpose.
  login: {
    /** @param {unknown} name */
    hasProvider(name) {
      log(`login.hasProvider(${name}) -> false (no federated auth in this harness)`);
      return false;
    },
  },

  // Game patch mode: onDemand streams chunks; fullImage is handled natively
  // before glue load. The module still probes getPatchMode at image init.
  getPatchMode: async () => 'onDemand',

  /**
   * @param {unknown} stage
   * @param {unknown} a
   * @param {unknown} b
   * @param {unknown} c
   * @param {unknown} d
   */
  setStartupProgress(stage, a, b, c, d) {
    log(`[startup] ${stage}`, [a, b, c, d].filter((v) => v !== undefined).join(' '));
    const L = window.gwLoading;
    if (!L) return;
    const s = String(stage || '').toLowerCase();
    if (s === 'complete') {
      milestone('startup.complete');
      return L.done();
    }
    if (s === 'downloading' && typeof a === 'number') {
      const eta =
        typeof d === 'number' && d > 0
          ? `${Math.ceil(d / 60)} min remaining`
          : '';
      const rate =
        typeof c === 'number' && c > 0
          ? `${(c / 1048576).toFixed(1)} MB/s`
          : '';
      return L.set('Preparing files needed to start', a / 100,
                   [rate, eta].filter(Boolean).join(' · '));
    }
    L.set(
      s in STARTUP_LABELS
        ? STARTUP_LABELS[/** @type {keyof typeof STARTUP_LABELS} */ (s)]
        : 'Loading…',
      null,
    );
  },

  handleFatalReadError() {
    milestone('snapshot.fatalRead');
    log('[err] module reported a fatal read error');
    window.gwLoading?.fail(
      lastSnapshotError || 'No cached copy of the required game data is available.',
    );
  },
  /** @param {import('../shared/diagnostics.js').RendererMilestoneFields} info */
  setBuildInfo(info) {
    window.gwBuildInfo = Object.freeze({
      programId: Number(info.programId),
      buildId: Number(info.buildId),
    });
    milestone('build.info', {
      programId: info.programId,
      buildId: info.buildId,
    });
    log(`build info: program=${info.programId} build=${info.buildId}`);
  },

  isMobile: false,

  requestFullScreen: () => Module.canvas.requestFullscreen?.(),
  requestFullscreen: () => Module.canvas.requestFullscreen?.(),

  onRuntimeInitialized() {
    performance.mark('gw.runtime.initialized');
    milestone('runtime.initialized');
    window.gwAutomation?.set('client.frontend');
    log('runtime initialised');
    if (
      new URL(window.location.href).searchParams.get('toolbox-automation') === '1'
      && gameWasmInstance
      && gameWasmModule
    ) {
      const toolboxInstance = gameWasmInstance;
      const toolboxModule = gameWasmModule;
      void import('./toolbox.js')
        .then(({ installToolbox }) =>
          installToolbox(toolboxInstance, toolboxModule))
        .catch((error) => log(
          '[toolbox]',
          error instanceof Error ? error.message : String(error),
        ));
    }
  },
  /** @param {unknown} reason */
  onAbort(reason) {
    milestone('wasm.abort');
    log('[err] WASM aborted:', reason);
    window.gwLoading?.fail('The game client stopped unexpectedly.');
  },
  /** @param {unknown} code */
  onExit(code) {
    log('WASM exited:', code);
    if (code === 0) {
      void native().app.requestQuit().catch((error) => {
        log(
          '[err] clean client exit could not close the app:',
          error instanceof Error ? error.message : String(error),
        );
      });
    } else {
      window.gwLoading?.fail('The game client stopped unexpectedly.');
    }
  },
};

window.gwInstallGameFilesystem({
  module: Module,
  log,
  failed(error) {
    window.gwDiagnostics?.event('filesystem.persistenceFailed', error);
    log(
      '[err] persistent filesystem unavailable:',
      error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : 'unknown error',
    );
    window.gwLoading?.failFilesystem();
  },
});

function appendGlue() {
  const src = 'Gw.jspi.js';
  log('loading', src, '(wasm: Gw.jspi.wasm) ...');
  const s = document.createElement('script');
  s.src = src;
  s.onerror = () => {
    log(`[err] ${src} not available`);
    window.gwLoading?.fail('The game client could not be loaded.');
  };
  document.body.appendChild(s);
}

function loadGlue() {
  if (!appSettings) {
    window.gwLoading.fail('Settings were not ready.');
    return;
  }
  const c =
    /** @type {HTMLCanvasElement | null} */ (
      document.getElementById('canvas')
    );
  if (!c) throw new Error('missing renderer canvas');
  applyCursorTheme(appSettings.cursorTheme);

  c.focus();
  c.addEventListener('pointerdown', () => {
    if (!Module.oskIsActive && document.activeElement !== c) c.focus();
  }, true);

  // Outside Capacitor the client rewrites API hosts to same-origin first labels.
  // Map those onto gw://app/<route>/… so the main-process proxy can forward.
  const PROXY_LABELS = new Set(['webgate', 'account', 'help', 'store', 'www']);
  /** @type {any} Browser overload boundary retained by the wrapper. */
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = /**
   * @this {XMLHttpRequest}
   * @param {string} method
   * @param {string | URL} url
   * @param {...any} rest Browser overload boundary.
   */
  function (
    method,
    url,
    ...rest
  ) {
    try {
      const u = new URL(url, location.href);
      const label = u.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
      const hostLabel = u.hostname.split('.')[0] ?? '';
      if (PROXY_LABELS.has(label) ||
          (u.hostname === location.hostname && PROXY_LABELS.has(hostLabel))) {
        const path = u.pathname.startsWith('/') ? u.pathname : '/' + u.pathname;
        const rewritten = `gw://app${path}${u.search}`;
        log(`api: ${method} ${path}`);
        return origOpen.call(this, method, rewritten, ...rest);
      }
    } catch { /* not a URL we can rewrite */ }
    return origOpen.call(this, method, url, ...rest);
  };

  const resumeAudio = () => {
    const ctx = Module.SDL2?.audioContext || Module.audioContext;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume()
        .then(() => log('audio: resumed'))
        .catch(reportAudioFailure);
    }
  };
  /** @param {unknown} error */
  function reportAudioFailure(error) {
    window.gwDiagnostics?.event('audio.resumeFailed', error);
  }
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, resumeAudio, true);
  }

  inputHost = window.gwInstallGameInput({
    canvas: c,
    initialSettings: appSettings,
    diagnostics: window.gwDiagnostics,
    log,
  });
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
  const oskInputs = new Set(Object.values(Module.oskInput).filter(Boolean));

  // The desktop text proxy is part of the game, not a loss of game focus.
  // Keep the client's canvas-blur callback from muting audio while chat is
  // active. Real window blur still reaches the canvas and releases input.
  c.addEventListener('blur', (event) => {
    if (oskInputs.has(event.relatedTarget)) event.stopImmediatePropagation();
  }, true);

  for (const type in Module.oskInput) {
    const el = Module.oskInput[type];
    if (!el) { log(`[warn] missing OSK element for "${type}"`); continue; }
    el.addEventListener('focus', () => {
      globalThis.queueMicrotask(() => {
        if (Module.oskActiveInput !== el && document.activeElement === el) el.blur();
      });
    });
    if (Module.oskIsModal) {
      el.parentElement?.classList.add('osk-input-container-modal');
    }
  }
  log(`osk: ${Object.keys(Module.oskInput).length} fields, modal=${Module.oskIsModal}`);

  appendGlue();
}

(async function boot() {
  if (!window.gwNative) {
    window.gwLoading?.fail('Native bridge missing — open this page from Guild Wars.app.');
    return;
  }
  milestone('renderer.loaded');
  try {
    const [{ unavailablePlatformCapabilities }, { createSocketHost }] =
      await Promise.all([
        import('./platform-capabilities.js'),
        import('./socket-host.js'),
      ]);
    Object.assign(Module, unavailablePlatformCapabilities(log));
    const socketHost = createSocketHost({
      native: native().sockets,
      diagnostics: window.gwDiagnostics,
      log,
    });
    Module.socket = socketHost.socket;
    disposeSocketHost = socketHost.dispose;
  } catch (error) {
    window.gwLoading?.fail('The game host contract could not be loaded.');
    return log(
      '[err] platform contract load failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  window.addEventListener('gw:diagnostics-toggle', async () => {
    appSettings = await native().settings.get();
    window.gwDiagnostics?.setVisible(!!appSettings.showDiagnostics);
  });

  if (!await window.gwLoading.waitForClient()) return;
  window.gwLoading.set('Preparing…', null);

  try {
    appSettings = await native().settings.get();
    applyCursorTheme(appSettings.cursorTheme);
    window.gwDiagnostics?.setVisible(!!appSettings.showDiagnostics);
  } catch (e) {
    window.gwLoading?.fail('Settings could not be loaded.');
    return log(
      '[err] settings load failed:',
      e instanceof Error ? e.message : String(e),
    );
  }

  try {
    const meta = await native().snapshot.metadata();
    snapshotSize = meta.size;
    snapshotChunkSize = meta.chunkSize || 262144;
    snapshotChunkHashes = meta.chunkHashes || [];
    applyResidentBits(meta.residentBits);
    log('snapshot:', snapshotSize, 'bytes,', snapshotChunkHashes.length,
        'chunks of', snapshotChunkSize, `(${residentHashes.size} resident)`);
    await window.gwResolveDataStrategy(snapshotSize);
  } catch (e) {
    window.gwLoading?.fail('Game data could not be prepared.');
    return log(
      '[err] could not prepare snapshot metadata:',
      e instanceof Error ? e.message : String(e),
    );
  }

  if (!('Suspending' in WebAssembly)) {
    window.gwLoading?.fail('This Electron build lacks WebAssembly JSPI (WebAssembly.Suspending).');
    return log('[err] JSPI unavailable');
  }

  window.gwLoading.set('Starting the game…', null);
  loadGlue();
})();

})();
