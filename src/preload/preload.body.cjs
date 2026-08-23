// Sandboxed preload must be CommonJS — Electron's sandbox loader does not
// execute ESM preload graphs, and it whitelists `electron`, `events`, `timers`
// and `url` only, so this file cannot require the canonical contracts. It is
// the *body* of the preload: scripts/generate-preload.ts prepends the
// constants below from src/shared/contracts.ts and writes the result to
// build/preload/preload.cjs. Copying a channel name back into this file would
// reintroduce the drift the generator exists to remove, so no string literal
// here may start with the gw channel prefix — tests/policy asserts that.
// `process` is declared here for the same reason the generated constants are: the
// sandbox loader supplies it to this file's scope, and it is the only Node-ish
// binding the preload may read. The five spliced constants are declared for the
// type checker in scripts/preload-injected-constants.mts.
/* global IPC, RENDERER_INIT_ARGUMENT, ENHANCEMENTS, ENHANCEMENT_PROGRAMS, WASM_BRIDGE_MARKERS, process */
const { contextBridge, ipcRenderer } = require("electron");
const MAX_SOCKET_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Launch configuration, read from the one `additionalArguments` entry the main
 * process appends. Booleans only, defaulted off: a renderer that cannot read
 * its argument gets the production posture rather than a developer one.
 *
 * @returns {import("../shared/contracts.js").RendererInit}
 */
function rendererInit() {
  // `process` is injected into the sandboxed preload's own scope; it is not a
  // property of `globalThis`. Reading it off `globalThis` found nothing, so
  // every launch silently took the production defaults — no game cursor, no
  // developer program, no template trace — and only tests/electron could see
  // it, because a `vm` fixture's `process` global answers to either spelling.
  const argv = typeof process === "undefined" ? undefined : process.argv;
  const matching = Array.isArray(argv)
    ? argv.filter((value) => value.startsWith(RENDERER_INIT_ARGUMENT))
    : [];
  // Main emits exactly one argument. Ambiguity is a malformed boundary, not a
  // reason to let argv order choose a developer posture.
  const raw = matching.length === 1 ? matching[0] : undefined;
  /** @type {Record<string, unknown>} */
  let parsed = {};
  try {
    if (raw) {
      const value = JSON.parse(raw.slice(RENDERER_INIT_ARGUMENT.length));
      if (isRecord(value)) parsed = value;
    }
  } catch {
    parsed = {};
  }
  // The loop below writes every member of `ENHANCEMENTS`, which is exactly the
  // key set of `EnhancementSelection`; the checker cannot see that a `for…of` over
  // the canonical tuple is exhaustive, and listing the tools here to satisfy it
  // would be the second copy the tuple exists to prevent.
  const enhancementSelection =
    /** @type {import("../shared/enhancement-contracts.js").EnhancementSelection} */ ({});
  /** @type {Record<string, unknown>} */
  const selected = isRecord(parsed.enhancementSelection)
    ? parsed.enhancementSelection
    : {};
  for (const tool of ENHANCEMENTS) {
    enhancementSelection[tool] = selected[tool] === true;
  }
  Object.freeze(enhancementSelection);
  const requestedProgram = parsed.enhancementProgram;
  /** @type {import("../shared/enhancement-contracts.js").EnhancementProgram} */
  const enhancementProgram = typeof requestedProgram === "string"
      && ENHANCEMENT_PROGRAMS.some((program) => program === requestedProgram)
    ? /** @type {import("../shared/enhancement-contracts.js").EnhancementProgram} */ (
        requestedProgram
      )
    : "none";
  return {
    development: parsed.development === true,
    enhancementProgram,
    enhancementSelection,
    templateFsTrace: parsed.templateFsTrace === true,
  };
}

/**
 * @template T
 * @param {string} eventChannel
 * @param {(value: T) => void} callback
 * @returns {() => void}
 */
function listen(eventChannel, callback) {
  const handler = (/** @type {unknown} */ _event, /** @type {T} */ value) =>
    callback(value);
  ipcRenderer.on(eventChannel, handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(eventChannel, handler);
  };
}

/**
 * @type {((
 *   command: import("../shared/contracts.js").RendererCommand,
 * ) => void | "unhandled" | Promise<void | "unhandled">) | null}
 */
let rendererCommandHandler = null;
ipcRenderer.on(IPC.rendererCommand, (_event, id, command) => {
  const handler = rendererCommandHandler;
  if (!handler) {
    ipcRenderer.send(IPC.rendererCommandDone, id, "failed");
    return;
  }
  void Promise.resolve()
    .then(() => handler(command))
    .then(
      (result) => ipcRenderer.send(
        IPC.rendererCommandDone,
        id,
        result === "unhandled" ? "unhandled" : "completed",
      ),
      () => ipcRenderer.send(IPC.rendererCommandDone, id, "failed"),
    );
});

/** @type {import("../shared/contracts.js").GwNativeApi} */
const api = {
  init: rendererInit(),
  // A constant, not a capability: the derived client's dirfd markers, which the
  // sandboxed renderer cannot import from src/shared and must not re-type.
  wasmBridgeMarkers: WASM_BRIDGE_MARKERS,
  commands: {
    // One handler, registered once. The transport listener above exists before
    // renderer scripts run, so an early command fails explicitly instead of
    // disappearing. The correlation id and completion stay in transport.
    handle: (handler) => {
      if (rendererCommandHandler) {
        throw new Error("renderer command handler is already registered");
      }
      rendererCommandHandler = handler;
    },
  },
  inputTrace: {
    onEntry: (callback) => listen(IPC.inputTraceEvent, callback),
  },
  progress: {
    current: () => ipcRenderer.invoke(IPC.progressCurrent),
    onChange: (callback) => listen(IPC.progressEvent, callback),
  },
  snapshot: {
    metadata: () => ipcRenderer.invoke(IPC.snapshotMetadata),
  },
  dns: {
    resolve: (name) => ipcRenderer.invoke(IPC.dnsResolve, name),
  },
  sockets: {
    connect: (destination) => ipcRenderer.invoke(IPC.socketConnect, destination),
    send: (socketId, data) => {
      if (
        !data
        || typeof data.byteLength !== "number"
        || data.byteLength < 0
        || data.byteLength > MAX_SOCKET_PAYLOAD_BYTES
      ) {
        return Promise.reject(new TypeError("invalid socket payload"));
      }
      return ipcRenderer.invoke(IPC.socketSend, socketId, data);
    },
    close: (socketId) => ipcRenderer.invoke(IPC.socketClose, socketId),
    onEvent: (callback) => listen(IPC.socketEvent, callback),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (value) => ipcRenderer.invoke(IPC.settingsSet, value),
    reset: () => ipcRenderer.invoke(IPC.settingsReset),
    onChange: (callback) => listen(IPC.settingsEvent, callback),
  },
  travelPreferences: {
    get: () => ipcRenderer.invoke(IPC.travelPreferencesGet),
    set: (value) => ipcRenderer.invoke(IPC.travelPreferencesSet, value),
  },
  shortcuts: {
    capture: () => ipcRenderer.invoke(IPC.shortcutCapture),
    cancelCapture: () => ipcRenderer.invoke(IPC.shortcutCaptureCancel),
  },
  buildLibrary: {
    get: () => ipcRenderer.invoke(IPC.buildLibraryGet),
    set: (value) => ipcRenderer.invoke(IPC.buildLibrarySet, value),
  },
  credentials: {
    load: () => ipcRenderer.invoke(IPC.credentialsLoad),
    save: (value) => ipcRenderer.invoke(IPC.credentialsSave, value),
    clear: () => ipcRenderer.invoke(IPC.credentialsClear),
  },
  steam: {
    getToken: (silent) => ipcRenderer.invoke(IPC.steamToken, silent),
    store: (token, expiry) => ipcRenderer.invoke(IPC.steamStore, token, expiry),
    clear: () => ipcRenderer.invoke(IPC.steamClear),
  },
  cache: {
    info: () => ipcRenderer.invoke(IPC.cacheInfo),
    clearAndRestart: () => ipcRenderer.invoke(IPC.cacheClear),
    downloadAll: () => ipcRenderer.invoke(IPC.cacheDownloadAll),
    stopDownload: () => ipcRenderer.invoke(IPC.cacheStopDownload),
  },
  gameStorage: {
    resetAndRestart: () => ipcRenderer.invoke(IPC.gameStorageReset),
  },
  diagnostics: {
    clockSync: (rendererNowUs) =>
      ipcRenderer.invoke(IPC.diagnosticsClockSync, rendererNowUs),
    recordClockOffset: (offsetUs, rttUs) =>
      ipcRenderer.invoke(IPC.diagnosticsClockResult, offsetUs, rttUs),
    recordGraphics: (value) => ipcRenderer.invoke(IPC.diagnosticsGraphics, value),
    recordRendererMetrics: (value) =>
      ipcRenderer.invoke(IPC.diagnosticsRendererMetrics, value),
    recordRendererFrames: (value) =>
      ipcRenderer.invoke(IPC.diagnosticsRendererFrames, value),
    recordRendererMilestone: (name, rendererTimestampUs, fields) =>
      ipcRenderer.invoke(
        IPC.diagnosticsRendererMilestone,
        name,
        rendererTimestampUs,
        fields,
      ),
    current: () => ipcRenderer.invoke(IPC.diagnosticsCurrent),
  },
  app: {
    openExternal: (kind) => ipcRenderer.invoke(IPC.appOpenExternal, kind),
    reveal: (kind) => ipcRenderer.invoke(IPC.appRevealPath, kind),
    requestQuit: () => ipcRenderer.invoke(IPC.appRequestQuit),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.clipboardWriteText, text),
    readText: () => ipcRenderer.invoke(IPC.clipboardReadText),
    edit: (request) => ipcRenderer.invoke(IPC.clipboardEdit, request),
  },
  templates: {
    export: (entries) => ipcRenderer.invoke(IPC.templatesExport, entries),
  },
  client: {
    retry: () => ipcRenderer.invoke(IPC.clientRetry),
    healthy: (token) => ipcRenderer.invoke(IPC.clientHealthy, token),
    session: () => ipcRenderer.invoke(IPC.clientSession),
    featureFailure: (features) =>
      ipcRenderer.invoke(IPC.clientFeatureFailure, features),
  },
  appUpdates: {
    getState: () => ipcRenderer.invoke(IPC.appUpdatesGetState),
    check: () => ipcRenderer.invoke(IPC.appUpdatesCheck),
    restartAndInstall: () =>
      ipcRenderer.invoke(IPC.appUpdatesRestartAndInstall),
    onState: (callback) => listen(IPC.appUpdatesState, callback),
  },
  accounts: {
    get: () => ipcRenderer.invoke(IPC.accountsGet),
    setup: (value) => ipcRenderer.invoke(IPC.accountsSetup, value),
    open: (profileIds) => ipcRenderer.invoke(IPC.accountsOpen, profileIds),
    create: (value) => ipcRenderer.invoke(IPC.accountsCreate, value),
    update: (value) => ipcRenderer.invoke(IPC.accountsUpdate, value),
    archive: (profileId) => ipcRenderer.invoke(IPC.accountsArchive, profileId),
    restore: (profileId) => ipcRenderer.invoke(IPC.accountsRestore, profileId),
    delete: (profileId) => ipcRenderer.invoke(IPC.accountsDelete, profileId),
    loadTemplates: () => ipcRenderer.invoke(IPC.accountsTemplatesLoad),
    saveTemplates: (entries) => ipcRenderer.invoke(IPC.accountsTemplatesSave, entries),
    useSingle: () => ipcRenderer.invoke(IPC.accountsUseSingle),
  },
};
for (const namespace of Object.values(api)) Object.freeze(namespace);
Object.freeze(api);

contextBridge.exposeInMainWorld("gwNative", api);
