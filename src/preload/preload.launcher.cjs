/* global LAUNCHER_IPC */
// The launcher's deliberately small sandbox bridge. Channel constants are
// injected by generate-preload.ts so this file contains no parallel IPC list.
const { contextBridge, ipcRenderer } = require("electron");

/** @template T @param {string} channel @param {(value: T) => void} callback */
function listen(channel, callback) {
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
  state: {
    get: () => ipcRenderer.invoke(LAUNCHER_IPC.stateGet),
    onChange: (callback) => listen(LAUNCHER_IPC.stateEvent, callback),
  },
  profiles: {
    create: (input) => ipcRenderer.invoke(LAUNCHER_IPC.profilesCreate, input),
    setSelection: (ids) => ipcRenderer.invoke(LAUNCHER_IPC.profilesSetSelection, ids),
    play: (ids) => ipcRenderer.invoke(LAUNCHER_IPC.profilesPlay, ids),
    show: (id) => ipcRenderer.invoke(LAUNCHER_IPC.profilesShow, id),
    cancelQueued: (ids) => ipcRenderer.invoke(LAUNCHER_IPC.profilesCancelQueued, ids),
  },
  experience: {
    completeIntroduction: () => ipcRenderer.invoke(LAUNCHER_IPC.experienceCompleteIntroduction),
    dismissMigrationNotice: () => ipcRenderer.invoke(LAUNCHER_IPC.experienceDismissMigration),
    updatePreferences: (patch) => ipcRenderer.invoke(LAUNCHER_IPC.experienceUpdatePreferences, patch),
  },
  updates: {
    check: () => ipcRenderer.invoke(LAUNCHER_IPC.updatesCheck),
    restartAndInstall: () => ipcRenderer.invoke(LAUNCHER_IPC.updatesRestartAndInstall),
  },
};

for (const namespace of Object.values(launcherApi)) Object.freeze(namespace);
Object.freeze(launcherApi);
contextBridge.exposeInMainWorld("launcherNative", launcherApi);
