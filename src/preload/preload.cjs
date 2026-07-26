// Sandboxed preload must be CommonJS — Electron's sandbox loader does not
// execute ESM preload graphs, so this file stays self-contained.
const { contextBridge, ipcRenderer } = require("electron");
const MAX_SOCKET_PAYLOAD_BYTES = 4 * 1024 * 1024;

const IPC = {
  progressCurrent: "gw:progress:current",
  progressEvent: "gw:progress:event",
  prefetchEvent: "gw:prefetch:event",
  snapshotMetadata: "gw:snapshot:metadata",
  dnsResolve: "gw:dns:resolve",
  socketConnect: "gw:socket:connect",
  socketSend: "gw:socket:send",
  socketClose: "gw:socket:close",
  socketEvent: "gw:socket:event",
  settingsGet: "gw:settings:get",
  settingsSet: "gw:settings:set",
  settingsReset: "gw:settings:reset",
  credentialsLoad: "gw:credentials:load",
  credentialsSave: "gw:credentials:save",
  credentialsClear: "gw:credentials:clear",
  cacheInfo: "gw:cache:info",
  cacheClear: "gw:cache:clear",
  cacheDownloadAll: "gw:cache:downloadAll",
  cacheStopDownload: "gw:cache:stopDownload",
  gameStorageReset: "gw:gameStorage:reset",
  diagnosticsGraphics: "gw:diagnostics:graphics",
  diagnosticsClockSync: "gw:diagnostics:clockSync",
  diagnosticsClockResult: "gw:diagnostics:clockResult",
  diagnosticsRendererMetrics: "gw:diagnostics:rendererMetrics",
  diagnosticsRendererFrames: "gw:diagnostics:rendererFrames",
  diagnosticsRendererMilestone: "gw:diagnostics:rendererMilestone",
  diagnosticsCurrent: "gw:diagnostics:current",
  appOpenExternal: "gw:app:openExternal",
  appRequestQuit: "gw:app:requestQuit",
  clientRetry: "gw:client:retry",
  clientHealthy: "gw:client:healthy",
  releaseNoticeCheck: "gw:releaseNotice:check",
};

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
  },
  releaseNotice: {
    check: () => ipcRenderer.invoke(IPC.releaseNoticeCheck),
  },
};
for (const namespace of Object.values(api)) Object.freeze(namespace);
Object.freeze(api);

contextBridge.exposeInMainWorld("gwNative", api);
