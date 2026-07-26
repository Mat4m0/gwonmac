// Sandboxed preload must be CommonJS — Electron's sandbox loader does not
// execute ESM preload graphs, and it whitelists `electron`, `events`, `timers`
// and `url` only, so this file cannot require the canonical contracts. It is
// the *body* of the preload: scripts/generate-preload.mjs prepends the
// constants below from src/shared/contracts.ts and writes the result to
// build/preload/preload.cjs. Copying a channel name back into this file would
// reintroduce the drift the generator exists to remove, so no string literal
// here may start with the gw channel prefix — tests/policy asserts that.
/* global IPC, RENDERER_INIT_ARGUMENT */
const { contextBridge, ipcRenderer } = require("electron");
const MAX_SOCKET_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Launch configuration, read from the one `additionalArguments` entry the main
 * process appends. Booleans only, defaulted off: a renderer that cannot read
 * its argument gets the production posture rather than a developer one.
 */
function rendererInit() {
  const argv = globalThis.process?.argv;
  const raw = Array.isArray(argv)
    ? argv.find((value) => value.startsWith(RENDERER_INIT_ARGUMENT))
    : undefined;
  let parsed = {};
  try {
    if (raw) parsed = JSON.parse(raw.slice(RENDERER_INIT_ARGUMENT.length));
  } catch {
    parsed = {};
  }
  return {
    toolboxAutomation: parsed.toolboxAutomation === true,
    nativeCursor: parsed.nativeCursor === true,
    templateFsTrace: parsed.templateFsTrace === true,
  };
}

function listen(eventChannel, callback) {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(eventChannel, handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(eventChannel, handler);
  };
}

const api = {
  init: rendererInit(),
  commands: {
    // One handler, registered once. The correlation id stays in transport: the
    // renderer sees a command, and main sees the acknowledgement once whatever
    // the handler returned has settled.
    handle: (handler) => {
      ipcRenderer.on(IPC.rendererCommand, (_event, id, command) => {
        void Promise.resolve()
          .then(() => handler(command))
          .catch(() => undefined)
          .then(() => ipcRenderer.send(IPC.rendererCommandDone, id));
      });
    },
  },
  progress: {
    current: () => ipcRenderer.invoke(IPC.progressCurrent),
    onChange: (callback) => listen(IPC.progressEvent, callback),
    onPrefetch: (callback) => listen(IPC.prefetchEvent, callback),
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
  },
  credentials: {
    load: () => ipcRenderer.invoke(IPC.credentialsLoad),
    save: (value) => ipcRenderer.invoke(IPC.credentialsSave, value),
    clear: () => ipcRenderer.invoke(IPC.credentialsClear),
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
    requestQuit: () => ipcRenderer.invoke(IPC.appRequestQuit),
  },
  client: {
    retry: () => ipcRenderer.invoke(IPC.clientRetry),
    healthy: () => ipcRenderer.invoke(IPC.clientHealthy),
    session: () => ipcRenderer.invoke(IPC.clientSession),
  },
  releaseNotice: {
    check: () => ipcRenderer.invoke(IPC.releaseNoticeCheck),
  },
};
for (const namespace of Object.values(api)) Object.freeze(namespace);
Object.freeze(api);

contextBridge.exposeInMainWorld("gwNative", api);
