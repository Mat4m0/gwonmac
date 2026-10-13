/**
 * The Hub's Settings page: the launcher's Settings page, built as `settings/settings-app.js`
 * (apps/launcher/src/hub-entry.ts) and loaded on first use. It belongs to every launch, Core
 * included, because Tools are turned on here (docs/settings.md).
 */
import type { EmbeddedSettings } from '../shared/hub-settings.js';
import type { HubPresenter } from '../shared/hub.js';
import type { SettingsTarget } from '../shared/settings-catalogue.js';

/** Shown when the launcher window cannot be opened from the game. */
export const LAUNCHER_UNAVAILABLE = 'The launcher could not open. Use Window › Show Launcher.';
type SettingsPage = ReturnType<EmbeddedSettings<HTMLElement>['mountSettings']>;
let module: Promise<EmbeddedSettings<HTMLElement>> | null = null;
let shown: SettingsPage | null = null;

function load(document: Document) {
  if (!document.querySelector('link[data-gwonmac-settings-stylesheet]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'settings/settings-app.css'; link.dataset.gwonmacSettingsStylesheet = 'true';
    document.head.append(link);
  }
  // A build artifact: the specifier goes through a variable so the compiler does not resolve it.
  const specifier = './settings/settings-app.js';
  return module ??= (import(specifier) as Promise<EmbeddedSettings<HTMLElement>>).catch(error => { module = null; throw error; });
}

/** Shows Settings as a Hub page, at a section or control when given. */
export function showHubSettings(hub: HubPresenter<HTMLElement>, target: SettingsTarget | null) {
  let landing: Element | null = null;
  hub.showView('Settings', host => {
    const view = host.ownerDocument.createElement('div');
    view.className = 'hub-settings-host';
    host.append(view);
    let page: SettingsPage | null = null;
    let disposed = false;
    const refresh = () => page?.refresh();
    load(host.ownerDocument).then(settings => {
      if (disposed) return;
      page = shown = settings.mountSettings(view, {
        api: window.gwNative.hubSettings,
        target,
        extendedMemory: () => window.gwNative.client.session().then(session => session.extendedMemory),
        openInLauncher: next => window.gwNative.app.openSettings(next).catch(() => { throw new Error(LAUNCHER_UNAVAILABLE); }),
        // Focus still where the Hub put it means the player is waiting for this page; anywhere else, they moved on.
        mayTakeFocus: () => { const focused = host.ownerDocument.activeElement; return !focused || focused === landing || focused === host.ownerDocument.body || view.contains(focused); },
      });
    }).catch(() => {
      if (!disposed) view.textContent = 'Settings could not be loaded. Use Settings in the launcher.';
    });
    window.addEventListener('gw:tools-settings', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('gw:tools-settings', refresh);
      page?.dispose();
      if (shown === page) shown = null;
      view.remove();
    };
  }, undefined, 'settings');
  landing = document.activeElement;
}

/** Moves a Settings page that is already shown to a section or control. */
export function focusHubSettings(target: SettingsTarget) {
  shown?.open(target);
}
