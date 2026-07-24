// Sandboxed preload must be CommonJS — Electron's sandbox loader does not
// execute ESM preload graphs, so this file stays self-contained.
const { contextBridge, ipcRenderer } = require("electron");

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
  diagnosticsGraphics: "gw:diagnostics:graphics",
  diagnosticsClockSync: "gw:diagnostics:clockSync",
  diagnosticsClockResult: "gw:diagnostics:clockResult",
  diagnosticsRendererMetrics: "gw:diagnostics:rendererMetrics",
  diagnosticsRendererFrames: "gw:diagnostics:rendererFrames",
  diagnosticsRendererMilestone: "gw:diagnostics:rendererMilestone",
  diagnosticsCurrent: "gw:diagnostics:current",
  diagnosticsStartCapture: "gw:diagnostics:startCapture",
  diagnosticsStopCapture: "gw:diagnostics:stopCapture",
  diagnosticsExport: "gw:diagnostics:export",
  appOpenExternal: "gw:app:openExternal",
  appRequestQuit: "gw:app:requestQuit",
  clientRetry: "gw:client:retry",
  clientHealthy: "gw:client:healthy",
  updateStatus: "gw:update:status",
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

const api = Object.freeze({
  progress: {
    current: () => ipcRenderer.invoke(IPC.progressCurrent),
    onChange: (callback) => listen(IPC.progressEvent, callback),
    onPrefetch: (callback) => listen(IPC.prefetchEvent, callback),
  },
  snapshot: {
    metadata: async () => {
      const wire = await ipcRenderer.invoke(IPC.snapshotMetadata);
      const bin = atob(wire.residentBits);
      const residentBits = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) residentBits[i] = bin.charCodeAt(i);
      return {
        size: wire.size,
        chunkSize: wire.chunkSize,
        chunkHashes: wire.chunkHashes,
        residentBits,
      };
    },
  },
  dns: {
    resolve: (name) => ipcRenderer.invoke(IPC.dnsResolve, name),
  },
  sockets: {
    connect: (destination) => ipcRenderer.invoke(IPC.socketConnect, destination),
    send: (socketId, data) => ipcRenderer.invoke(IPC.socketSend, socketId, data),
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
    startCapture: (level) => ipcRenderer.invoke(IPC.diagnosticsStartCapture, level),
    stopCapture: () => ipcRenderer.invoke(IPC.diagnosticsStopCapture),
    export: () => ipcRenderer.invoke(IPC.diagnosticsExport),
  },
  app: {
    openExternal: (kind) => ipcRenderer.invoke(IPC.appOpenExternal, kind),
    requestQuit: () => ipcRenderer.invoke(IPC.appRequestQuit),
  },
  client: {
    retry: () => ipcRenderer.invoke(IPC.clientRetry),
    healthy: () => ipcRenderer.invoke(IPC.clientHealthy),
  },
  update: {
    status: () => ipcRenderer.invoke(IPC.updateStatus),
  },
});

contextBridge.exposeInMainWorld("gwNative", api);
