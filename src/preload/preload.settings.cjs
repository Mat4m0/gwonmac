/* global LAUNCHER_IPC */
// The Settings window's sandbox bridge: settings only, no accounts. Channel constants are
// injected by generate-preload.ts so this file contains no parallel IPC list.
const { contextBridge, ipcRenderer } = require("electron");

/** @template T @param {string} channel @param {(value: T) => void} callback */
function listen(channel, callback) {
  /** @param {Electron.IpcRendererEvent} _event @param {T} value */
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(channel, handler);
  };
}

/** @type {import("../shared/launcher-contracts.js").SettingsNativeApi} */
const settingsApi = {
  target: {
    take: () => ipcRenderer.invoke(LAUNCHER_IPC.settingsTargetGet),
    onRequest: (callback) => listen(LAUNCHER_IPC.settingsTargetEvent, callback),
  },
  state: {
    get: () => ipcRenderer.invoke(LAUNCHER_IPC.stateGet),
    onChange: (callback) => listen(LAUNCHER_IPC.stateEvent, callback),
  },
  experience: {
    updatePreferences: (patch) => ipcRenderer.invoke(LAUNCHER_IPC.experienceUpdatePreferences, patch),
  },
  settings: {
    update: (patch) => ipcRenderer.invoke(LAUNCHER_IPC.settingsUpdate, patch),
    reset: () => ipcRenderer.invoke(LAUNCHER_IPC.settingsReset),
  },
  tools: {
    setMasterEnabled: (enabled) => ipcRenderer.invoke(LAUNCHER_IPC.toolsSetMasterEnabled, enabled),
    setFeature: (input) => ipcRenderer.invoke(LAUNCHER_IPC.toolsSetFeature, input),
    captureShortcut: (tool) => ipcRenderer.invoke(LAUNCHER_IPC.toolsCaptureShortcut, tool),
    replaceShortcut: (input) => ipcRenderer.invoke(LAUNCHER_IPC.toolsReplaceShortcut, input),
    restartToApply: () => ipcRenderer.invoke(LAUNCHER_IPC.toolsRestartToApply),
  },
  gameFiles: {
    info: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesInfo),
    repair: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesRepair),
    pauseDownload: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesPauseDownload),
    resumeDownload: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesResumeDownload),
    resetAndRestart: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesResetAndRestart),
  },
  texturePacks: {
    import: () => ipcRenderer.invoke(LAUNCHER_IPC.texturePacksImport),
    select: (id) => ipcRenderer.invoke(LAUNCHER_IPC.texturePacksSelect, id),
    remove: (id) => ipcRenderer.invoke(LAUNCHER_IPC.texturePacksRemove, id),
  },
  updates: {
    check: () => ipcRenderer.invoke(LAUNCHER_IPC.updatesCheck),
    restartAndInstall: () => ipcRenderer.invoke(LAUNCHER_IPC.updatesRestartAndInstall),
  },
  external: {
    open: (kind) => ipcRenderer.invoke(LAUNCHER_IPC.externalOpen, kind),
    revealLogs: () => ipcRenderer.invoke(LAUNCHER_IPC.externalRevealLogs),
  },
};

for (const namespace of Object.values(settingsApi)) Object.freeze(namespace);
Object.freeze(settingsApi);
contextBridge.exposeInMainWorld("settingsNative", settingsApi);
