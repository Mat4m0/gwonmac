/**
 * The Hub's Settings page: the launcher's Settings page, built as `settings/settings-app.js`
 * (apps/launcher/src/hub-entry.ts) and loaded on first use. It belongs to every launch, Core
 * included, because Tools are turned on here (docs/settings.md).
 */
import type { EmbeddedSettings } from '../shared/hub-settings.js';
import type { HubPresenter } from '../shared/hub.js';
import type { SettingsTarget } from '../shared/settings-catalogue.js';

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
        openInLauncher: next => { void window.gwNative.app.openSettings(next); },
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
}

/** Moves a Settings page that is already shown to a section or control. */
export function focusHubSettings(target: SettingsTarget) {
  shown?.open(target);
}
