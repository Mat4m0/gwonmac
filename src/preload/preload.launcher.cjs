/* global LAUNCHER_IPC */
// The launcher's deliberately small sandbox bridge. Channel constants are
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

/** @type {import("../shared/launcher-contracts.js").LauncherNativeApi} */
const launcherApi = {
  navigation: {
    onRequest: (callback) => listen(LAUNCHER_IPC.navigationEvent, callback),
  },
  state: {
    get: () => ipcRenderer.invoke(LAUNCHER_IPC.stateGet),
    onChange: (callback) => listen(LAUNCHER_IPC.stateEvent, callback),
  },
  profiles: {
    create: (input) => ipcRenderer.invoke(LAUNCHER_IPC.profilesCreate, input),
    updateAppearance: (input) => ipcRenderer.invoke(LAUNCHER_IPC.profilesUpdateAppearance, input),
    setSelection: (ids) => ipcRenderer.invoke(LAUNCHER_IPC.profilesSetSelection, ids),
    play: (ids) => ipcRenderer.invoke(LAUNCHER_IPC.profilesPlay, ids),
    show: (id) => ipcRenderer.invoke(LAUNCHER_IPC.profilesShow, id),
    cancelQueued: (ids) => ipcRenderer.invoke(LAUNCHER_IPC.profilesCancelQueued, ids),
    archive: (id) => ipcRenderer.invoke(LAUNCHER_IPC.profilesArchive, id),
    restore: (id) => ipcRenderer.invoke(LAUNCHER_IPC.profilesRestore, id),
    delete: (id) => ipcRenderer.invoke(LAUNCHER_IPC.profilesDelete, id),
  },
  experience: {
    completeSetup: (input) => ipcRenderer.invoke(LAUNCHER_IPC.experienceCompleteSetup, input),
    completeIntroduction: () => ipcRenderer.invoke(LAUNCHER_IPC.experienceCompleteIntroduction),
    replayIntroduction: () => ipcRenderer.invoke(LAUNCHER_IPC.experienceReplayIntroduction),
    dismissMigrationNotice: () => ipcRenderer.invoke(LAUNCHER_IPC.experienceDismissMigration),
    dismissPreferencesReset: () => ipcRenderer.invoke(LAUNCHER_IPC.experienceDismissPreferencesReset),
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
    restoreDefaultShortcut: (tool) => ipcRenderer.invoke(LAUNCHER_IPC.toolsRestoreDefaultShortcut, tool),
    restartToApply: () => ipcRenderer.invoke(LAUNCHER_IPC.toolsRestartToApply),
  },
  gameFiles: {
    info: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesInfo),
    retryPreparation: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesRetryPreparation),
    repair: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesRepair),
    pauseDownload: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesPauseDownload),
    resumeDownload: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesResumeDownload),
    resetAndRestart: () => ipcRenderer.invoke(LAUNCHER_IPC.gameFilesResetAndRestart),
  },
  external: {
    open: (kind) => ipcRenderer.invoke(LAUNCHER_IPC.externalOpen, kind),
    revealLogs: () => ipcRenderer.invoke(LAUNCHER_IPC.externalRevealLogs),
  },
  updates: {
    check: () => ipcRenderer.invoke(LAUNCHER_IPC.updatesCheck),
    restartAndInstall: () => ipcRenderer.invoke(LAUNCHER_IPC.updatesRestartAndInstall),
  },
};

for (const namespace of Object.values(launcherApi)) Object.freeze(namespace);
Object.freeze(launcherApi);
contextBridge.exposeInMainWorld("launcherNative", launcherApi);
