/**
 * The Settings page for the Hub: the launcher's own page, built a second time as a module the
 * game window imports (`vite build --mode hub`, docs/settings.md). It is part of every launch,
 * Core included, because Tools are turned on here. The game window reads and changes settings
 * only through its bounded `hubSettings` API, which main validates; the launcher's sections
 * open the launcher.
 */
import { createApp, h, shallowRef } from "vue";
import type { ExtendedMemoryRuntimeStatus } from "@shared/contracts";
import SettingsView from "./components/SettingsView.vue";
import type { InGameNative } from "./settings-host";
import "./settings-view.css";
import "./hub-settings.css";
import type { EmbeddedSettings, HubSettingsChange, HubSettingsSnapshot } from "@shared/hub-settings";
import type { SettingsTarget } from "@shared/settings-catalogue";

export const mountSettings: EmbeddedSettings<HTMLElement>["mountSettings"] = (target, { api, target: initial, extendedMemory, openInLauncher, mayTakeFocus }) => {
  const snapshot = shallowRef<HubSettingsSnapshot | null>(null);
  const place = shallowRef<SettingsTarget | null>(initial);
  let disposed = false;
  const memory = shallowRef<ExtendedMemoryRuntimeStatus | null>(null);
  const loadFailed = shallowRef(false);
  /** Reads the stored settings. A failure keeps the last snapshot; with none yet, the page offers Retry. */
  const refresh = async () => {
    try {
      const next = await api.get();
      if (disposed) return;
      snapshot.value = next; loadFailed.value = false;
    } catch { if (!disposed && !snapshot.value) loadFailed.value = true; }
  };
  // The saved choice applies at the next start; the Game section also says what this session uses.
  extendedMemory().then(status => { if (!disposed) memory.value = status; }, () => { /* The row shows the saved choice only. */ });
  // A failed re-read after a save does not undo the save: only the write's own failure reaches the page.
  const change = async (request: HubSettingsChange) => { await api.update(request); await refresh(); };
  const native: InGameNative = {
    settings: { update: patch => change({ kind: "settings", patch }) },
    tools: {
      setMasterEnabled: enabled => change({ kind: "master", enabled }),
      setFeature: ({ tool, enabled }) => change({ kind: "tool", tool, enabled }),
      captureShortcut: action => api.capture(action),
      replaceShortcut: ({ action, binding }) => change({ kind: "shortcut", action, binding }),
    },
  };
  const app = createApp({
    setup: () => () => snapshot.value
      ? h(SettingsView, { snapshot: snapshot.value, native, target: place.value, openInLauncher, extendedMemory: memory.value, mayTakeFocus })
      : loadFailed.value
        ? h("div", { class: "settings-load-error" }, [
          h("p", { role: "alert" }, "Settings could not load. Try again."),
          h("button", { class: "ui-button", type: "button", onClick: () => { loadFailed.value = false; void refresh(); } }, "Retry"),
        ])
        : null,
  });
  app.mount(target);
  void refresh();
  return {
    open: next => { place.value = { ...next }; },
    refresh: () => { void refresh(); },
    dispose: () => { disposed = true; api.cancelCapture().catch(() => undefined); app.unmount(); },
  };
};
