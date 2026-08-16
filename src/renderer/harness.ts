/**
 * Host for Gw.jspi.wasm inside the Electron renderer. Platform services are
 * injected on Module; privileged work goes through window.gwNative.
 *
 * index.html loads this as a classic script, and it must stay one: a top-level
 * import or export would make this an ES module, and the redeclaration below
 * only works between two `var`s in the same global script. Every type here is
 * therefore named through type-only `import(…)`.
 */

/**
 * The generated glue's import object. Four renderer modules patch or read it,
 * and each already declares the view it needs, so this is their intersection
 * rather than a fifth description of the same object. Not `any`: a name none of
 * them declares is still an error here.
 */
type GwClientImports = Parameters<
  typeof import('./client-exit.js').installClientExit
>[0]['imports'] &
  Parameters<
    typeof import('./wasm-memory-attribution.js').installWasmMemoryAttribution
  >[0]['imports'] &
  Parameters<
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
    info: import('../shared/diagnostics.js').RendererMilestoneFieldsByName['build.info'],
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
  gwonmacHeapCapBytes?: number;
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
 * The one federated provider this host answers for. The client probes
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
const isSilentRequest = (options: unknown): boolean => {
  if (typeof options !== 'object' || options === null) return true;
  // Only an explicit `false` asks for a window. The observed client always
  // passes `{ silent }`, so this default is unreachable there — and if a future
  // build stops passing it, the failure is a Steam sign-in that refuses rather
  // than one that opens a window the player did not ask for. Email and password
  // still work either way, which makes that the cheaper way to be wrong.
  return (options as { silent?: unknown }).silent !== false;
};

/**
 * The expiry the client hands back, as epoch milliseconds. It arrives as
 * `new Date(expirationDate)`, which is an Invalid Date when the account service
 * supplied nothing usable — `null` says "no expiry known", which is a token the
 * login exchange proves rather than one that expired at the epoch.
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
let runtimeInitialized = false;
let enhancementInstallationStarted = false;
let hostOnlyToolsInstallationStarted = false;
let templatePublishingAvailable = false;
let rendererUnloading = false;
let crashRecorded = false;

/**
 * How many client launches have crashed this app run. Main's flight recorder
 * owns the tally (it survives the location.reload() a Retry performs and
 * dies with the process), so the renderer records the crash first and then
 * reads the count back — browser storage is deliberately not used anywhere
 * in this app. A count that cannot be read degrades to the first-crash
 * presentation, never worse than showing no count at all.
 */
async function escalateRepeatedCrash(): Promise<void> {
  const { counters } = await native().diagnostics.current();
  const count = counters['wasm.crashes'] || 0;
  if (count > 1) window.gwLoading?.failCrash(count);
}
let disposeSocketHost = () => {};
let disposeHostOnlyTools = () => {};
const native = () => window.gwNative;
const milestone = <
  N extends import('../shared/diagnostics.js').RendererMilestone,
>(
  name: N,
  ...fields: N extends keyof import('../shared/diagnostics.js').RendererMilestoneFieldsByName
    ? [import('../shared/diagnostics.js').RendererMilestoneFieldsByName[N]]
    : []
) => {
  void native().diagnostics
    .recordRendererMilestone(name, performance.now() * 1000, fields[0])
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

/**
 * Mounts the player-selected Tools application without a client integration.
 *
 * Builds, Teams, import/export, and their native library are host features.
 * They remain useful on the first launch after an ArenaNet update, when the
 * verified official module has no certified companion manifest. Live party
 * observation and Apply stay absent by construction: the existing host receives
 * a null command port and starts with an unavailable party projection.
 */
function installHostOnlyTools(): void {
  if (hostOnlyToolsInstallationStarted || rendererUnloading) return;
  hostOnlyToolsInstallationStarted = true;
  void import('./tools-host.js')
    .then(({ mountHostOnlyTools }) => {
      if (rendererUnloading) return;
      const dispose = mountHostOnlyTools(
        document.body,
        templatePublishingAvailable,
      );
      if (rendererUnloading) {
        dispose();
        return;
      }
      disposeHostOnlyTools = dispose;
    })
    .catch((error) => {
      log(
        '[tools]',
        error instanceof Error ? error.message : String(error),
      );
    });
}

function maybeInstallEnhancements(): void {
  if (enhancementInstallationStarted || !runtimeInitialized) return;

  const init = native().init;
  // Launch intent is the first gate: an all-off launch must not even import
  // Enhancement code. The served module is the second gate. An uncertified
  // launch has no manifest, while the installer separately checks that a
  // manifest's exact hook set matches Main's effective session features.
  const enhancementRequested =
    init.enhancementProgram !== 'none'
    || init.enhancementSelection.nativeCursor
    || init.enhancementSelection.tools;
  if (!gameWasmInstance || !gameWasmModule) return;
  const manifestCount = WebAssembly.Module.customSections(
    gameWasmModule,
    'enhancement_manifest',
  ).length;
  if (manifestCount !== 1) {
    if (init.enhancementSelection.tools) installHostOnlyTools();
    return;
  }
  if (!enhancementRequested) return;

  enhancementInstallationStarted = true;
  const enhancementInstance = gameWasmInstance;
  const enhancementModule = gameWasmModule;
  void import('./enhancements.js')
    .then(({ installEnhancements }) =>
      installEnhancements(
        enhancementInstance,
        enhancementModule,
        init.enhancementProgram,
      ))
    .then((installation) => {
      // Unsupported manifests and exports are a normal soft refusal. The
      // installer returns null for those cases rather than throwing, but the
      // host-owned library remains just as usable as it is on a module with no
      // manifest at all.
      if (!init.enhancementSelection.tools) return;
      if (installation === null) {
        installHostOnlyTools();
        return;
      }
      void native().client.session().then((session) => {
        if (
          session.compatibility?.features.partyObservation.status
          !== 'available'
        ) installHostOnlyTools();
      });
    })
    .catch((error) => {
      log(
        '[enhancement]',
        error instanceof Error ? error.message : String(error),
      );
      // A certified companion is optional to the host library. If its runtime
      // installation refuses, keep the game and host-owned Tools usable while
      // leaving every live observation and command unavailable.
      if (init.enhancementSelection.tools) installHostOnlyTools();
    });
}

window.gwLog = (on = true) => {
  const el = document.getElementById('log');
  if (!el) return false;
  el.style.display = on ? 'block' : 'none';
  if (on) { el.textContent = logBuf.join('\n'); el.scrollTop = el.scrollHeight; }
  return on;
};

/**
 * The memory warning. The client's WASM memory is capped by its own build
 * (`WASM_HEAP_CAP_BYTES` in the shared contracts), it only ever grows within a
 * run, and a session that reaches the cap dies on whatever allocation comes
 * next — historically hours in and mid-mission. The watcher moves that death
 * to a moment the player picks.
 *
 * It counts in time, not bytes remaining. `heap-pressure.ts` owns that
 * arithmetic and the reason for it; what matters here is that the number the
 * player is shown is measured, and that when it cannot be measured no number
 * is shown at all.
 *
 * A classic script cannot static-import, so the cap arrives via a dynamic
 * import — on the first watcher tick, not at boot. Boot would work here, but
 * it would also put the canonical contract into the module cache before the
 * Enhancement runtime imports it, and the packaged proof that the runtime
 * resolves the canonical module observes that import as a request. Until it
 * lands there is no watch and the watcher is silent, which costs one
 * 15-second tick and nothing else: no heap fills that fast.
 */
const MIB = 1_048_576;
let heapCapBytes = 0;
let heapWatch: import('./heap-pressure.js').HeapPressureWatch | null = null;
let heapWarning:
  | import('./memory-warning.js').MemoryWarningPresenter
  | null = null;
let heapCapRequested = false;
function requestHeapCap() {
  if (heapCapRequested) return;
  heapCapRequested = true;
  void Promise.all([
    import('../shared/contracts.js'),
    import('./heap-pressure.js'),
    import('./memory-warning.js'),
  ])
    .then(([
      { WASM_HEAP_CAP_BYTES },
      { createHeapPressureWatch },
      { bindMemoryWarning },
    ]) => {
      const capBytes = Module.gwonmacHeapCapBytes ?? WASM_HEAP_CAP_BYTES;
      heapCapBytes = capBytes;
      heapWatch = createHeapPressureWatch({ capBytes });
      heapWarning = bindMemoryWarning(
        document,
        reloadClientSafely,
        window.gwSurfaces,
      );
    })
    // A failed load retries on the next tick rather than silencing the
    // warning for the whole session.
    .catch(() => { heapCapRequested = false; });
}
let heapNoticeLevel: 'none' | 'low' | 'critical' = 'none';

const wasmHeapBytes = () => Module.HEAPU8?.buffer.byteLength ?? 0;
window.gwWasmHeapBytes = wasmHeapBytes;

/**
 * What the crash overlay shows behind its disclosure: the abort's own prose
 * plus the heap size at death. Renderer-local by design — the diagnostics
 * export carries only the closed reason vocabulary and fingerprint, and this
 * app keeps no browser storage, so the overlay is the one place the prose
 * survives until the player reloads.
 */
const crashTechnicalDetail = (reason: unknown, heapBytes: number): string => {
  const text = reason instanceof Error
    ? `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`
    : String(reason ?? '');
  const cap = heapCapBytes ? ` of ${Math.round(heapCapBytes / MIB)} MiB` : '';
  return (
    `WASM heap at crash: ${Math.round(heapBytes / MIB)} MiB${cap}\n${text}`
  ).slice(0, 8192);
};

/**
 * Best-effort save sync, then the same page reload the crash overlay's Retry
 * performs; the beforeunload dispose closes this run's game sockets on the
 * way out. The quit path has shown the sync can fail, so the reload never
 * waits on it for more than a beat — IDBFS auto-persist has usually written
 * already.
 */
function reloadClientSafely() {
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  setTimeout(reload, 1_500);
  const fs = window.Module?.FS;
  if (fs) fs.syncfs(false, reload);
  else reload();
}

setInterval(() => {
  if (crashRecorded) return;
  requestHeapCap();
  if (!heapWatch) return;
  const reading = heapWatch.sample(wasmHeapBytes(), performance.now());
  if (reading.level === 'none') return;
  if (reading.level !== heapNoticeLevel) {
    heapNoticeLevel = reading.level;
    log(
      `[memory] wasm heap at ${Math.round(reading.bytes / MIB)} MiB`
      + ` — ${reading.minutes ?? '?'} min left`
      + ` at ${Math.round((reading.bytesPerMinute ?? 0) / MIB)} MiB/min`
      + ` — ${reading.level} notice (${reading.raisedBy ?? 'held'})`,
    );
    heapWarning?.present(reading.level, heapCapBytes);
  }
}, 15_000);

const STARTUP_LABELS = {
  connecting: 'Starting Guild Wars',
  downloading: 'Preparing files needed to start',
  decompressing: 'Preparing files needed to start',
  loading: 'Starting Guild Wars',
};

const SNAPSHOT_URL = 'Gw.snapshot';
let appSettings: import('../shared/contracts.js').AppSettings | null = null;
let clientResizeFrame = 0;

function currentRenderScale(): import('../shared/contracts.js').AppSettings['renderScale'] {
  if (!appSettings) {
    throw new Error('graphics initialized before settings');
  }
  return appSettings.renderScale;
}

function scheduleClientResize(): void {
  if (clientResizeFrame) return;
  clientResizeFrame = requestAnimationFrame(() => {
    clientResizeFrame = 0;
    window.dispatchEvent(new globalThis.Event('resize'));
  });
}

let clientHealthConfirmation:
  | import('./client-health.js').ClientHealthConfirmation
  | null = null;
let createClientHealthConfirmation:
  typeof import('./client-health.js').createClientHealthConfirmation;
// A no-op until boot() loads the module: settings can be applied before the
// dynamic imports resolve, and appearance is the one effect that can wait.
let applyAppearance:
  typeof import('./appearance.js').applyAppearance = () => {};
let inputHost: GameInputController | null = null;
let inputTrace: InputTrace | null = null;
window.gwToolsSettings = () => Object.freeze({
  enabled: appSettings?.gwonmacTools ?? false,
  teamManagement: appSettings?.teamManagement ?? true,
  xunlaiStorage: appSettings?.xunlaiStorage ?? false,
  travelPalette: appSettings?.travelPalette ?? false,
  targetReadout: appSettings?.targetReadout ?? false,
});
window.gwApplySettings = (next) => {
  const previousScale = appSettings?.renderScale;
  const updated = { ...next };
  appSettings = updated;
  if (previousScale !== undefined && updated.renderScale !== previousScale) {
    scheduleClientResize();
  }
  window.gwDiagnostics?.setVisible(updated.showDiagnostics);
  applyAppearance(updated);
  window.dispatchEvent(new CustomEvent('gw:tools-settings', {
    detail: window.gwToolsSettings(),
  }));
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
  typeof import('./client-exit.js') &
  typeof import('./wasm-memory-attribution.js') &
  typeof import('./gl-program-cache.js') &
  typeof import('./filesystem.js') &
  typeof import('./input.js') &
  typeof import('./input-trace.js') &
  typeof import('./surface-controller.js') &
  typeof import('./native-double-click.js') &
  typeof import('./clipboard-copy.js') &
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
    const error = new Error(detail || `Game data download failed (HTTP ${res.status}).`);
    const code = res.headers.get('x-gw-error');
    if (code) (error as Error & { gwCode?: string }).gwCode = code;
    throw error;
  }
  return new Uint8Array(await res.arrayBuffer());
}

// The one explanation the host draws beside the client's login screen: why an
// interactive Steam sign-in produced no login. Transient and non-blocking —
// the login screen itself stays entirely the client's.
let loginStatusTimer: ReturnType<typeof setTimeout> | null = null;
function showLoginStatus(
  reason: import('../shared/contracts.js').SteamRefusalReason,
): void {
  void (async () => {
    const { describeSteamRefusal } = await import('./failure-messages.js');
    const text = describeSteamRefusal(reason);
    const status = document.getElementById('login-status');
    if (!text || !status) return;
    status.textContent = text;
    status.hidden = false;
    if (loginStatusTimer) clearTimeout(loginStatusTimer);
    loginStatusTimer = setTimeout(() => {
      status.hidden = true;
    }, 12_000);
  })();
}

addEventListener('beforeunload', () => {
  rendererUnloading = true;
  clientHealthConfirmation?.dispose();
  imageSource?.stop();
  disposeHostOnlyTools();
  disposeSocketHost();
});

Module = {
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  print: (t) => log(t),
  printErr: (t) => log('[err]', t),

  // Take over instantiation so the EGL imports can be patched first.
  instantiateWasm(imports, success) {
    const memoryAttribution = host.installWasmMemoryAttribution({
      imports,
      module: Module,
      recordGrowth: (fields) => milestone('wasm.growthRequested', fields),
      log,
    });
    milestone('wasm.memoryProbe', {
      status: memoryAttribution ? 'installed' : 'resizeImportMissing',
    });
    host.installClientExit({
      imports,
      instance: () => gameWasmInstance,
      onExit: () => Module.onExit(0),
      onFailure: (error) => Module.onAbort(error),
      log,
    });
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
      renderScale: currentRenderScale,
      firstFrame: () => {
        performance.mark('gw.frame.first-submit');
        milestone('frame.firstSubmit');
        clientHealthConfirmation?.firstFramePresented();
        log('first frame presented');
        // The client is now running and has installed its resize handling.
        // Give it one settled-layout signal so the initial backing buffer
        // cannot remain at the canvas element's 1280x800 placeholder size.
        scheduleClientResize();
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
      maybeInstallEnhancements();
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
      inputHost?.setLoginProviderChooser(false);
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
  // what makes the client offer its account-provider chooser; choosing the
  // ArenaNet path then opens the client's unchanged email/password form.
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
     * gwonmac does not own and must not draw over.
     */
    async getAuthToken(name, options) {
      if (!isSteamProvider(name)) {
        log(`login.getAuthToken(${name}) -> refused, provider not offered`);
        throw new Error('provider not offered');
      }
      const silent = isSilentRequest(options);
      if (!silent) inputHost?.setLoginProviderChooser(false);
      const result = await native().steam.getToken(silent);
      if (!result.token) {
        log(`login.getAuthToken(silent=${silent}) -> no token`);
        inputHost?.setLoginProviderChooser(true);
        // The refusal still ends on the client's own login screen; the line
        // below is the one explanation the host may add beside it. A plain
        // cancel stays silent — describeSteamRefusal answers null for it.
        if (!silent && result.reason) showLoginStatus(result.reason);
        throw new Error('no Steam token available');
      }
      // Never the value: the token must not reach this log, which is bounded
      // and read back into diagnostics.
      inputHost?.setLoginProviderChooser(false);
      log(`login.getAuthToken(silent=${silent}) -> token vended`);
      return {
        userId: LOCAL_PROFILE_INDEX,
        authCode: result.token,
        refreshToken: '',
      };
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
    // The read failure carries a code, never prose: the sentence the player
    // sees is written and reviewed in failure-messages.ts.
    void (async () => {
      const { describeSnapshotReadFailure, failureDetail } =
        await import('./failure-messages.js');
      const code = imageSource?.lastErrorCode() ?? null;
      window.gwLoading?.fail(
        describeSnapshotReadFailure(code),
        code ? failureDetail(code) : undefined,
      );
    })();
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
    runtimeInitialized = true;
    maybeInstallEnhancements();
  },
  onAbort(reason) {
    log('[err] WASM aborted:', reason);
    // Emscripten can abort more than once while unwinding; only the first
    // call presents and records — a repeat would reset the escalated copy
    // back to first-crash and steal focus again. The prose never crosses
    // IPC — it collapses into the closed reason vocabulary plus a
    // fingerprint, and stays readable on the overlay's disclosure.
    if (crashRecorded) return;
    crashRecorded = true;
    // The crash overlay is taking the screen; nothing animates out from under
    // it.
    heapWarning?.hide();
    const heapBytes = wasmHeapBytes();
    // The overlay first, with the first-crash presentation; the recorded
    // count upgrades it below once main has counted this crash.
    window.gwLoading?.failCrash(1, crashTechnicalDetail(reason, heapBytes));
    void (async () => {
      const { classifyWasmAbortReason, wasmAbortFingerprint } =
        await import('./wasm-abort-reason.js');
      await native().diagnostics.recordRendererMilestone(
        'wasm.abort',
        performance.now() * 1000,
        {
          reasonKind: classifyWasmAbortReason(reason),
          fingerprint: wasmAbortFingerprint(reason),
          heapBytes,
        },
      );
      await escalateRepeatedCrash();
    })().catch(() => {});
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
      // An abort that unwinds into a non-zero exit was already presented and
      // counted by onAbort; re-running this branch would reset the copy to
      // first-crash and count the same death twice.
      if (crashRecorded) return;
      crashRecorded = true;
      heapWarning?.hide();
      // `code` is declared unknown at the Module boundary; anything the
      // glue passes that is not a plain integer records as the -1 the
      // schema can still account for.
      const exitCode =
        typeof code === 'number' && Number.isSafeInteger(code) ? code : -1;
      const heapBytes = wasmHeapBytes();
      window.gwLoading?.failCrash(
        1,
        crashTechnicalDetail(`client exit code ${exitCode}`, heapBytes),
      );
      void (async () => {
        await native().diagnostics.recordRendererMilestone(
          'wasm.exit',
          performance.now() * 1000,
          { code: exitCode, heapBytes },
        );
        await escalateRepeatedCrash();
      })().catch(() => {});
    }
  },
};

function mountGameFilesystem() {
  host.installGameFilesystem({
    module: clientRuntime(),
    log,
    async restoreTemplates(fs) {
      const library = await native().accounts.loadTemplates();
      if (!library) return;
      const { replaceTemplateProjection } = await import('./template-store.js');
      await replaceTemplateProjection(fs, library.entries);
    },
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

function loadGlue(isProxyRouteLabel: (route: string) => boolean) {
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
      if (isProxyRouteLabel(label) ||
          (u.hostname === location.hostname && isProxyRouteLabel(hostLabel))) {
        const path = u.pathname.startsWith('/') ? u.pathname : '/' + u.pathname;
        const rewritten = `gw://app${path}${u.search}`;
        log(`api: ${method} ${path}`);
        // This is the last account-service request before the client opens
        // character selection. It occurs for password and federated accounts,
        // including when the player chose not to save credentials.
        if (path === '/webgate/my_account/token.xml') {
          inputHost?.expectCharacterSelection();
        }
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

  // The trace observes the input host and is switched on from the menu. It is
  // built here, before the host, because the host takes it once and never asks
  // again — a trace created later would watch nothing.
  inputTrace = host.createInputTrace(
    document.body,
    (text) => native().clipboard.writeText(text),
  );
  // Install before game input so a key claimed by the topmost GWonMac surface
  // cannot also reach the official client's window-capture listener.
  window.gwSurfaces = host.installSurfaceController(document);
  window.addEventListener('gw:input-trace', () => {
    log(`input trace: ${inputTrace?.toggle() ? 'on' : 'off'}`);
  });

  // Text entry runs through these, not through keydown on the canvas. The
  // input host also needs their identity before the generated glue installs
  // its own Tab listener, so Chromium cannot perform a second focus move.
  Module.oskInput = {
    text:      document.getElementById('osk-input-text'),
    email:     document.getElementById('osk-input-email'),
    password:  document.getElementById('osk-input-password'),
    number:    document.getElementById('osk-input-number'),
    multiline: document.getElementById('osk-input-multiline'),
  };
  Module.oskIsModal = Module.isMobile;
  const oskInputs = new Set<EventTarget | null>(
    Object.values(Module.oskInput).filter((input): input is HTMLElement => !!input),
  );

  // Claim the one supported clipboard chord before game input sees it. The
  // client otherwise treats Cmd+C as its ordinary C binding while the host is
  // copying from the active text proxy.
  host.installClipboardCopy({
    fields: oskInputs,
    writeText: (text) => native().clipboard.writeText(text),
    diagnostics: window.gwDiagnostics,
    log,
  });

  inputHost = host.installGameInput({
    canvas: c,
    textInputs: oskInputs,
    diagnostics: window.gwDiagnostics,
    trace: inputTrace,
    // Read through the window global rather than a module handle: input
    // installs before the enhancement chain decides whether a certified
    // cursor readout exists at all.
    clientCursorHidden: () => window.gwCursorState?.()?.hidden ?? null,
    log,
  });

  // After the input host, and both before the glue. Correctness only needs the
  // flag written before the client's own canvas listener runs, and a
  // window-capture listener always precedes one on the canvas. Order between
  // these two settles something smaller: registered first, this recorded its
  // trace row above the press it belongs to, which read like the flag arrived
  // before the click. The instance is read per press because input installs
  // long before the glue instantiates anything.
  host.installNativeDoubleClick({
    flag: () => {
      const exported = gameWasmInstance?.exports?.['gwonmac_double_click'];
      return exported && typeof exported === 'object' && 'value' in exported
        ? (exported as { value: number })
        : null;
    },
    trace: inputTrace,
    log,
  });
  // Every same-document control is part of the game experience, not a loss of
  // application focus. Keep the client's canvas-blur callback from muting
  // audio when focus moves into Settings, Tools, Travel, a warning, or a game
  // text proxy. A real window blur has no related element, so it still reaches
  // the client and releases input.
  c.addEventListener('blur', (event) => {
    if (event.relatedTarget instanceof Element) {
      event.stopImmediatePropagation();
    }
  }, true);

  for (const type in Module.oskInput) {
    const el = Module.oskInput[type];
    if (!el) { log(`[warn] missing OSK element for "${type}"`); continue; }
    el.addEventListener('focus', () => {
      globalThis.queueMicrotask(() => {
        if (Module.oskActiveInput !== el && document.activeElement === el) c.focus();
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
    window.gwLoading?.fail(
      // Identical to loading.ts's sentence for the same fault; a shared
      // constant is not worth an import in a classic-script context.
      'Native bridge missing — this page must run inside Guild Wars Reforged.app.',
    );
    return;
  }
  milestone('renderer.loaded');
  let isProxyRouteLabel: (route: string) => boolean;
  try {
    const [
      { unavailablePlatformCapabilities },
      { createSocketHost },
      clientExit,
      memoryAttribution,
      graphics,
      glProgramCache,
      filesystem,
      input,
      inputTraceModule,
      surfaceController,
      nativeDoubleClickModule,
      clipboardCopy,
      templateSaveCompatibility,
      templateFilesystemTrace,
      clientHealth,
      appearance,
      proxyRoutes,
    ] = await Promise.all([
      import('./platform-capabilities.js'),
      import('./socket-host.js'),
      import('./client-exit.js'),
      import('./wasm-memory-attribution.js'),
      import('./graphics.js'),
      import('./gl-program-cache.js'),
      import('./filesystem.js'),
      import('./input.js'),
      import('./input-trace.js'),
      import('./surface-controller.js'),
      import('./native-double-click.js'),
      import('./clipboard-copy.js'),
      import('./template-save-compatibility.js'),
      import('./template-filesystem-trace.js'),
      import('./client-health.js'),
      import('./appearance.js'),
      import('../shared/proxy-routes.js'),
    ]);
    host = {
      ...clientExit,
      ...memoryAttribution,
      ...graphics,
      ...glProgramCache,
      ...filesystem,
      ...input,
      ...inputTraceModule,
      ...surfaceController,
      ...nativeDoubleClickModule,
      ...clipboardCopy,
      ...templateSaveCompatibility,
      ...templateFilesystemTrace,
    };
    createClientHealthConfirmation =
      clientHealth.createClientHealthConfirmation;
    applyAppearance = appearance.applyAppearance;
    isProxyRouteLabel = proxyRoutes.isProxyRouteName;
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
    templatePublishingAvailable =
      session.compatibility?.features.gameFileSaving.status === 'available';
    applyAppearance(
      settings,
      document.documentElement,
      session.compatibility?.clientSha256
        ?? String(session.healthToken?.generation ?? "active"),
    );
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
      writeBytes: (data, address) =>
        clientRuntime().HEAPU8.set(data, address >>> 0),
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
  loadGlue(isProxyRouteLabel);
})();

})();
