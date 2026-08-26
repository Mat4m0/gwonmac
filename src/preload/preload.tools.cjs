/**
 * Adds optional Tools transports to the generated Tools preload only.
 * The Core preload never contains or evaluates this source.
 *
 * @param {import("../shared/contracts.js").CoreGwNativeApiBase & Partial<import("../shared/contracts.js").ToolsNativeApiExtension>} api
 * @param {Electron.IpcRenderer} ipcRenderer
 * @param {typeof import("../shared/contracts.js").IPC} IPC
 * @param {<T>(channel: string, callback: (value: T) => void) => () => void} listen
 */
function installToolsApi(api, ipcRenderer, IPC, listen) {
api.trade = {
  subscribe: (source) => ipcRenderer.invoke(IPC.tradeSubscribe, source),
  unsubscribe: () => ipcRenderer.invoke(IPC.tradeUnsubscribe),
  search: (request) => ipcRenderer.invoke(IPC.tradeSearch, request),
  retry: (source) => ipcRenderer.invoke(IPC.tradeRetry, source),
  getSaved: () => ipcRenderer.invoke(IPC.tradeSavedGet),
  setSaved: (value) => ipcRenderer.invoke(IPC.tradeSavedSet, value),
  getTraderQuotes: () => ipcRenderer.invoke(IPC.traderQuotesGet),
  getTraderPriceHistory: (request) => ipcRenderer.invoke(IPC.traderPriceHistoryGet, request),
  onEvent: (callback) => listen(IPC.tradeEvent, callback),
};
api.travelPreferences = {
  get: () => ipcRenderer.invoke(IPC.travelPreferencesGet),
  set: (value) => ipcRenderer.invoke(IPC.travelPreferencesSet, value),
};
api.travelHistory = {
  get: (value) => ipcRenderer.invoke(IPC.travelHistoryGet, value),
  record: (value) => ipcRenderer.invoke(IPC.travelHistoryRecord, value),
};
api.buildLibrary = {
  get: () => ipcRenderer.invoke(IPC.buildLibraryGet),
  set: (value) => ipcRenderer.invoke(IPC.buildLibrarySet, value),
};
}

// The generator appends the invocation after it splices this checked function.
void installToolsApi;
