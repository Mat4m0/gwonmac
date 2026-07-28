// Host for Gw.jspi.wasm inside the Electron renderer. Platform services are
// injected on Module; privileged work goes through window.gwNative.
//
// index.html loads this as a classic script, and it must stay one: a top-level
// import or export would make this an ES module, and the redeclaration below
// only works between two `var`s in the same global script. Every type here is
// therefore named through type-only `import(…)`.

/**
 * The generated glue's import object. Four renderer modules patch or read it,
 * and each already declares the view it needs, so this is their intersection
 * rather than a fifth description of the same object. Not `any`: a name none of
 * them declares is still an error here.
 */
type GwClientImports = Parameters<
  typeof import('./gl-program-cache.js').installGlProgramCache
>[0]['imports'] &
  Parameters<
    typeof import('./template-save-compatibility.js').installTemplateSaveCompatibility
  >[0]['imports'] &
  Parameters<
    typeof import('./template-filesystem-trace.js').installTemplateFilesystemTrace
  >[0]['imports'] & {
    env: Parameters<typeof import('./graphics.js').installGraphics>[0]['env'];
  };

/**
 * The half of `Module` this host owns: everything it assigns, and the few
 * members the generated glue publishes that it reads back. ArenaNet's surface
 * is wider than this — that is the point of the boundary — but a name this
 * host neither writes nor reads has no business being spelled here.
 */
type GwGameModule = {
  canvas: HTMLCanvasElement;
  print(text: unknown): void;
  printErr(text: unknown): void;
  // `{}` rather than an exports table means instantiation is in flight.
  instantiateWasm(
    imports: GwClientImports,
    success: (
      instance: WebAssembly.Instance,
      module: WebAssembly.Module,
    ) => void,
  ): object;
  locateFile(path: string): string;
  dns: { resolve(name: string): Promise<string> };
  secureStorage: {
    getCredentials(): Promise<
      import('../shared/contracts.js').StoredCredentials
    >;
    storeCredentials(username: unknown, password: unknown): Promise<void>;
    clearCredentials(): Promise<void>;
  };
  login: {
    hasProvider(name: unknown): boolean;
    /**
     * The client copies exactly these three strings into wasm memory. It is
     * awaited, and the wait covers a whole Steam round trip.
     */
    getAuthToken(
      name: unknown,
      options: unknown,
    ): Promise<{ userId: string; authCode: string; refreshToken: string }>;
  };
  /**
   * `storeAccountData` and `clearAccountData` exist only here, never on
   * `login`, so the two objects are one seam and both have to be present.
   */
  nativeAccount: {
    storeAccountData(refreshToken: unknown, expirationDate: unknown): Promise<void>;
    clearAccountData(): Promise<void>;
  };
  getPatchMode(): Promise<'onDemand'>;
  // The client passes four trailing values whose meaning depends on the stage.
  setStartupProgress(
    stage: unknown,
    a: unknown,
    b: unknown,
    c: unknown,
    d: unknown,
  ): void;
  handleFatalReadError(): void;
  setBuildInfo(
    info: import('../shared/diagnostics.js').RendererMilestoneFields,
  ): void;
  isMobile: boolean;
  requestFullScreen(): void;
  requestFullscreen(): void;
  onRuntimeInitialized(): void;
  onAbort(reason: unknown): void;
  onExit(code: unknown): void;

  // Installed after the initial assignment, once what they need exists.
  image?: import('./image-source.js').ImageSource['image'];
  socket?: ReturnType<
    typeof import('./socket-host.js').createSocketHost
  >['socket'];
  oskInput?: Record<string, HTMLElement | null>;
  oskIsModal?: boolean;
  preRun?: () => void;

  // Published by the generated glue, so absent until it has run.
  HEAPU8?: Uint8Array;
  SDL2?: { audioContext?: AudioContext };
  audioContext?: AudioContext;
  oskIsActive?: boolean;
  oskActiveInput?: EventTarget | null;
};

// Module MUST be var: the glue does `var Module = typeof Module != 'undefined'
// ? Module : {}`, and a const/let here collides with it at parse time.
var Module: GwGameModule;

(function () {
'use strict';

/**
 * The same object once the generated glue has published its runtime onto it.
 * Everything below that needs these members runs inside a callback the glue
 * itself invokes, so this one view states that the glue has loaded instead of
 * every use guarding against a state it cannot be in.
 */
type GwClientRuntime = GwGameModule & {
  addRunDependency(name: string): void;
  removeRunDependency(name: string): void;
  HEAPU8: Uint8Array;
};
const clientRuntime = () => Module as GwClientRuntime;

/**
 * The one federated provider this host answers for (KD8). The client probes
 * Apple and Google too; neither has an acquisition surface here, so both are
 * answered no rather than advertised and then failed.
 */
const STEAM_PROVIDER = 'steam';
const isSteamProvider = (name: unknown): boolean =>
  typeof name === 'string' && name.toLowerCase() === STEAM_PROVIDER;

/**
 * `userId` as the client's local profile index. The captured `login.xml`
 * exchange sends `<LoginName>1</LoginName>` and the account service answers
 * with the real `<steamid>@steam`, so this is a slot number, not an identity.
 */
const LOCAL_PROFILE_INDEX = '1';

/**
 * Read `{ silent }` off whatever the client passed. Defaulting to a non-silent
 * request would let the launch-time probe open a Steam window, so an
 * unreadable argument is treated as the quiet one.
 */
const isSilentRequest = (options: unknown): boolean =>
  typeof options === 'object' &&
  options !== null &&
  (options as { silent?: unknown }).silent === true;

/**
 * The expiry the client hands back, as epoch milliseconds. It arrives as
 * `new Date(expirationDate)`, which is an Invalid Date when the account service
 * supplied nothing usable — `null` says "no expiry known", which is a token the
 * login exchange proves rather than one that expired at the epoch (R9).
 */
const toEpochMilliseconds = (value: unknown): number | null => {
  if (!(value instanceof Date)) return null;
  const ms = value.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const LOG_LINES = 400;
const logBuf: string[] = [];
let gameWasmInstance: WebAssembly.Instance | null = null;
let gameWasmModule: WebAssembly.Module | null = null;
let disposeSocketHost = () => {};
const native = () => window.gwNative;
const milestone = (
  name: import('../shared/diagnostics.js').RendererMilestone,
  fields?: import('../shared/diagnostics.js').RendererMilestoneFields,
) => {
  void native().diagnostics
    .recordRendererMilestone(name, performance.now() * 1000, fields)
    .catch(() => {});
};

const log = (...a: unknown[]) => {
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
let appSettings: import('../shared/contracts.js').AppSettings | null = null;
let clientHealthConfirmation:
  | import('./client-health.js').ClientHealthConfirmation
  | null = null;
let createClientHealthConfirmation:
  typeof import('./client-health.js').createClientHealthConfirmation;
let inputHost: GameInputController | null = null;
window.gwApplySettings = (next) => {
  const previousScale = appSettings?.renderScale;
  const updated = { ...next };
  appSettings = updated;
  inputHost?.applySettings(updated);
  if (previousScale !== undefined && updated.renderScale !== previousScale) {
    window.dispatchEvent(new globalThis.Event('resize'));
  }
  window.gwDiagnostics?.setVisible(updated.showDiagnostics);
  if (inputHost) log('settings applied');
};

// image.fileSize() is synchronous, so the snapshot metadata is read over IPC
// before the glue loads and the source is constructed from it in boot().
let imageSource: import('./image-source.js').ImageSource | null = null;
let gamepadImportsAvailable = false;

// The host's supporting modules. They are ESM; this bootstrap is not, because
// the generated glue redeclares `var Module`. So boot() imports them and holds
// them here: `instantiateWasm` and `loadGlue` are called synchronously by the
// glue and cannot await. Reading `host` before boot() assigns it is a
// TypeError, not a silently skipped installation.
let host: typeof import('./graphics.js') &
  typeof import('./gl-program-cache.js') &
  typeof import('./filesystem.js') &
  typeof import('./input.js') &
  typeof import('./template-save-compatibility.js') &
  typeof import('./template-filesystem-trace.js');

/**
 * The one HTTP shape the image source is given: a ranged read of the snapshot,
 * carrying the priority the main-process scheduler reads.
 */
async function fetchSnapshotRange(
  start: number,
  length: number,
  priority: 'demand' | 'prefetch',
): Promise<Uint8Array> {
  const res = await fetch(SNAPSHOT_URL, {
    headers: {
      Range: `bytes=${start}-${start + length - 1}`,
      'X-GW-Priority': priority,
    },
  });
  if (!res.ok && res.status !== 206) {
    const detail = await res.text();
    throw new Error(detail || `Game data download failed (HTTP ${res.status}).`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

addEventListener('beforeunload', () => {
  clientHealthConfirmation?.dispose();
  imageSource?.stop();
  disposeSocketHost();
});

Module = {
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  print: (t) => log(t),
  printErr: (t) => log('[err]', t),

  // Take over instantiation so the EGL imports can be patched first.
  instantiateWasm(imports, success) {
    host.installTemplateSaveCompatibility({
      imports,
      module: Module,
      // The directory listing hands the client a block it frees itself, so it
      // has to come from the client's own allocator, which only exists once
      // instantiation below resolves.
      exports: () =>
        (gameWasmInstance?.exports ?? null) as
          | { malloc?: (bytes: number) => number }
          | null,
    });
    host.installTemplateFilesystemTrace({
      imports,
      module: Module,
    });
    host.installGraphics({
      env: imports.env,
      module: Module,
      renderScale: () => appSettings?.renderScale ?? 1,
      firstFrame: () => {
        performance.mark('gw.frame.first-submit');
        milestone('frame.firstSubmit');
        clientHealthConfirmation?.firstFramePresented();
        log('first frame presented');
      },
      log,
    });
    host.installGlProgramCache({ imports, module: Module, log });
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
  locateFile: (path) => path === 'Gw.wasm' ? 'Gw.jspi.wasm' : path,

  // Module.image is assigned in boot(), once the snapshot metadata that
  // makes fileSize() answerable synchronously has arrived.

  dns: {
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

  // Steam is the one federated provider this host answers for. Saying yes is
  // what makes the client render its "Sign in with Steam" button; the ArenaNet
  // email/password form renders beside it, unchanged (R1, R11).
  login: {
    hasProvider(name) {
      const offered = isSteamProvider(name);
      log(`login.hasProvider(${name}) -> ${offered}`);
      return offered;
    },

    /**
     * Hand the client a credential to redeem in `login.xml`, or refuse.
     *
     * `authCode` carries the Steam OAuth token, which the client base64-encodes
     * into `<PasswordToken>`. `userId` is the client's own local profile index
     * — not the SteamID, which the account service derives itself — and
     * `refreshToken` is empty because this flow has no refresh step.
     *
     * Fetched from main on demand and never kept here, mirroring
     * `secureStorage.getCredentials()`: the token exists in this process only
     * for as long as it takes to hand over.
     *
     * Refusing is a normal outcome, not an error to dress up. The client
     * rebuilds its own login screen from a rejection, which is the screen
     * gwonmac does not own and must not draw over (R10).
     */
    async getAuthToken(name, options) {
      if (!isSteamProvider(name)) {
        log(`login.getAuthToken(${name}) -> refused, provider not offered`);
        throw new Error('provider not offered');
      }
      const silent = isSilentRequest(options);
      const token = await native().steam.getToken(silent);
      if (!token) {
        log(`login.getAuthToken(silent=${silent}) -> no token`);
        throw new Error('no Steam token available');
      }
      // Never the value: the token must not reach this log, which is bounded
      // and read back into diagnostics (R20).
      log(`login.getAuthToken(silent=${silent}) -> token vended`);
      return { userId: LOCAL_PROFILE_INDEX, authCode: token, refreshToken: '' };
    },
  },

  nativeAccount: {
    /**
     * What the account service handed back after a successful login. Main
     * refreshes the stored expiry only when this matches the token it already
     * holds, so a value that cannot be replayed is ignored rather than written
     * over a working credential.
     */
    async storeAccountData(refreshToken, expirationDate) {
      const token = typeof refreshToken === 'string' ? refreshToken : '';
      await native().steam.store(token, toEpochMilliseconds(expirationDate));
      log('nativeAccount.storeAccountData -> relayed');
    },

    /** Sign-out. The local copy goes; the account link is ArenaNet's to undo. */
    async clearAccountData() {
      await native().steam.clear();
      log('nativeAccount.clearAccountData -> cleared');
    },
  },

  // Game patch mode: onDemand streams chunks; fullImage is handled natively
  // before glue load. The module still probes getPatchMode at image init.
  getPatchMode: async () => 'onDemand',

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
        ? STARTUP_LABELS[s as keyof typeof STARTUP_LABELS]
        : 'Loading…',
      null,
    );
  },

  handleFatalReadError() {
    milestone('snapshot.fatalRead');
    log('[err] module reported a fatal read error');
    window.gwLoading?.fail(
      imageSource?.lastError() || 'No cached copy of the required game data is available.',
    );
  },
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
    const init = native().init;
    // The module is the effective truth. Main may have requested Enhancement for a
    // selected tool, but an uncertified build is served without the manifest;
    // that launch must not import Enhancement or fetch its kernel. Conversely, the
    // selection is one generated record, so adding a canonical tool cannot
    // leave this gate hand-copying an incomplete list.
    const enhancementRequested =
      init.enhancementAutomation ||
      Object.values(init.enhancementSelection).some(Boolean);
    if (
      enhancementRequested
      && gameWasmInstance
      && gameWasmModule
      && WebAssembly.Module.customSections(
        gameWasmModule,
        'enhancement_manifest',
      ).length === 1
    ) {
      const enhancementInstance = gameWasmInstance;
      const enhancementModule = gameWasmModule;
      void import('./enhancements.js')
        .then(({ installEnhancements }) =>
          installEnhancements(
            enhancementInstance,
            enhancementModule,
            init.enhancementSelection,
            init.enhancementAutomation,
          ))
        .catch((error) => log(
          '[enhancement]',
          error instanceof Error ? error.message : String(error),
        ));
    }
  },
  onAbort(reason) {
    milestone('wasm.abort');
    log('[err] WASM aborted:', reason);
    window.gwLoading?.fail('The game client stopped unexpectedly.');
  },
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

function mountGameFilesystem() {
  host.installGameFilesystem({
    module: clientRuntime(),
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
}

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
  const c = document.getElementById('canvas');
  if (!(c instanceof globalThis.HTMLCanvasElement)) {
    throw new Error('missing renderer canvas');
  }

  c.focus();
  c.addEventListener('pointerdown', () => {
    if (!Module.oskIsActive && document.activeElement !== c) c.focus();
  }, true);

  // Outside Capacitor the client rewrites API hosts to same-origin first labels.
  // Map those onto gw://app/<route>/… so the main-process proxy can forward.
  const PROXY_LABELS = new Set(['webgate', 'account', 'help', 'store', 'www']);
  // The browser's two overloads, viewed as the one variadic signature this
  // wrapper needs: `open(method, url)` and `open(method, url, async)` are
  // different requests, so the tail is forwarded by arity rather than named.
  // `unknown[]` is what keeps it unreadable here rather than untyped.
  const origOpen = XMLHttpRequest.prototype.open as (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) => void;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
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
  function reportAudioFailure(error: unknown) {
    window.gwDiagnostics?.event('audio.resumeFailed', error);
  }
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, resumeAudio, true);
  }

  inputHost = host.installGameInput({
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
  const oskInputs = new Set<EventTarget | null>(
    Object.values(Module.oskInput).filter(Boolean),
  );

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
    const [
      { unavailablePlatformCapabilities },
      { createSocketHost },
      graphics,
      glProgramCache,
      filesystem,
      input,
      templateSaveCompatibility,
      templateFilesystemTrace,
      clientHealth,
    ] = await Promise.all([
      import('./platform-capabilities.js'),
      import('./socket-host.js'),
      import('./graphics.js'),
      import('./gl-program-cache.js'),
      import('./filesystem.js'),
      import('./input.js'),
      import('./template-save-compatibility.js'),
      import('./template-filesystem-trace.js'),
      import('./client-health.js'),
    ]);
    host = {
      ...graphics,
      ...glProgramCache,
      ...filesystem,
      ...input,
      ...templateSaveCompatibility,
      ...templateFilesystemTrace,
    };
    createClientHealthConfirmation =
      clientHealth.createClientHealthConfirmation;
    Object.assign(Module, unavailablePlatformCapabilities(log));
    const socketHost = createSocketHost({
      native: native().sockets,
      diagnostics: window.gwDiagnostics,
      socketOpened: () => {
        clientHealthConfirmation?.gameSocketOpened();
      },
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

  // preRun, so it only has to precede the glue — which appendGlue() loads at
  // the end of this function.
  mountGameFilesystem();

  window.addEventListener('gw:diagnostics-toggle', async () => {
    appSettings = await native().settings.get();
    window.gwDiagnostics?.setVisible(!!appSettings.showDiagnostics);
  });

  if (!await window.gwLoading.waitForClient()) return;
  window.gwLoading.set('Preparing…', null);

  try {
    const [settings, session] = await Promise.all([
      native().settings.get(),
      native().client.session(),
    ]);
    appSettings = settings;
    clientHealthConfirmation = createClientHealthConfirmation({
      token: session.healthToken,
      confirm: (token) => native().client.healthy(token),
      onFailure: (error, attempt, willRetry) => {
        log(
          `[warn] client health confirmation failed (attempt ${attempt}${willRetry ? ', retrying' : ', giving up'}):`,
          error instanceof Error ? error.message : String(error),
        );
      },
    });
    window.gwDiagnostics?.setVisible(!!appSettings.showDiagnostics);
  } catch (e) {
    window.gwLoading?.fail('Settings could not be loaded.');
    return log(
      '[err] settings load failed:',
      e instanceof Error ? e.message : String(e),
    );
  }

  try {
    const [{ createImageSource }, meta] = await Promise.all([
      import('./image-source.js'),
      native().snapshot.metadata(),
    ]);
    const source = createImageSource({
      metadata: meta,
      fetchRange: fetchSnapshotRange,
      writeBytes: (data, address) => clientRuntime().HEAPU8.set(data, address),
      diagnostics: window.gwDiagnostics,
      log,
    });
    imageSource = source;
    Module.image = source.image;
    window.gwEvictMemory = source.evictMemory;
    window.gwSnapshotState = source.state;
    window.gwStats = () => {
      const image = source.stats();
      const s = {
        reads: image.reads,
        readMB: +(image.bytes / 1048576).toFixed(1),
        chunksFromMemory: image.fromMemory,
        chunksFromNative: image.fromNative,
        chunksCoalesced: image.coalesced,
        memoryCacheMB: +(image.cacheBytes / 1048576).toFixed(1),
        memoryCacheChunks: image.cacheChunks,
        residentHashes: image.residentHashes,
        gamepadImports: gamepadImportsAvailable,
      };
      if (console.table) console.table(s);
      else console.log(s);
      return s;
    };
    await window.gwResolveDataStrategy(meta.size);
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
