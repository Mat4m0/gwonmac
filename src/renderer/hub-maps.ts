/**
 * Inline Maps controls write through the existing settings owner.
 * Keeps presentation separate from canonical game and storage owners.
 */
import type { HubPresenter } from '../shared/hub.js';
export function openHubMaps(hub: HubPresenter<HTMLElement>) {
  const available = () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().cartographyEnabled;
  hub.showView('Maps', target => {
    let disposed = false;
    const doc = target.ownerDocument;
    const view = doc.createElement('section'); view.className = 'hub-detail hub-map-settings';
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    target.append(view);
    void window.gwNative.settings.get().then(settings => {
      if (disposed) return;
      for (const [key, label] of [
        ['cartographyGridEnabled', 'Exploration grid'], ['cartographyOverlayEnabled', 'Walkable terrain'], ['compassRangeIndicatorsEnabled', 'Compass ranges'],
      ] as const) {
        const button = doc.createElement('button'); button.className = 'ui-button';
        const paint = () => { button.textContent = `${label} · ${settings[key] ? 'On' : 'Off'}`; button.setAttribute('aria-pressed', String(settings[key])); };
        button.onclick = () => { if (!available()) return; button.disabled = true; void window.gwNative.settings.set({ [key]: !settings[key] }).then(next => { settings = next; paint(); }).catch(() => { status.textContent = 'Could not save this change.'; }).finally(() => { button.disabled = false; }); };
        paint(); view.append(button);
      }
      for (const [key, title] of [['cartographyGridOpacity', 'Grid opacity'], ['cartographyWalkabilityOpacity', 'Terrain opacity']] as const) {
        const label = doc.createElement('label'); label.textContent = title;
        const range = doc.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.value = String(settings[key]); range.setAttribute('aria-label', title);
        const value = doc.createElement('output'); value.textContent = `${range.value}%`;
        range.oninput = () => { value.textContent = `${range.value}%`; };
        range.onchange = () => { if (!available()) return; range.disabled = true; void window.gwNative.settings.set({ [key]: Number(range.value) }).then(next => { settings = next; }).catch(() => { range.value = String(settings[key]); value.textContent = `${range.value}%`; status.textContent = 'Could not save this change.'; }).finally(() => { range.disabled = false; }); };
        label.append(range, value); view.append(label);
      }
      view.append(status); view.querySelector('button')?.focus();
    }).catch(() => { if (!disposed) { status.textContent = 'Maps controls could not load.'; view.append(status); } });
    return () => { disposed = true; view.remove(); };
  }, available);
}
