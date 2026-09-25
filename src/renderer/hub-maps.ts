/**
 * Inline Maps controls write through the existing settings owner.
 * Each layer keeps its state and opacity together and follows external changes.
 */
import type { HubPresenter } from '../shared/hub.js';
export function openHubMaps(hub: HubPresenter<HTMLElement>) {
  const available = () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().cartographyEnabled;
  hub.showView('Maps', target => {
    let disposed = false;
    const doc = target.ownerDocument;
    const view = doc.createElement('section'); view.className = 'hub-detail hub-map-settings';
    const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.hidden = true;
    const painters: (() => void)[] = [];
    const paint = () => painters.forEach(update => update());
    target.append(view);
    void window.gwNative.settings.get().then(initial => {
      if (disposed) return;
      let settings = initial;
      removeListener = window.gwNative.settings.onChange(next => { settings = next; paint(); });
      for (const [key, title, opacity, opacityTitle] of [
        ['cartographyGridEnabled', 'Exploration grid', 'cartographyGridOpacity', 'Grid opacity'],
        ['cartographyOverlayEnabled', 'Walkable terrain', 'cartographyWalkabilityOpacity', 'Terrain opacity'],
        ['compassRangeIndicatorsEnabled', 'Compass ranges', null, null],
        ['eliteSkillsEnabled', 'Elite skills', null, null],
      ] as const) {
        const group = doc.createElement('div'); group.className = 'hub-map-layer';
        const label = doc.createElement('label'); label.className = 'ui-check hub-map-toggle';
        const check = doc.createElement('input'); check.type = 'checkbox'; check.setAttribute('role', 'switch'); check.setAttribute('aria-label', title);
        const name = doc.createElement('span'); name.textContent = title;
        const state = doc.createElement('span'); state.className = 'hub-map-state'; state.setAttribute('aria-hidden', 'true');
        label.append(check, name, state); group.append(label);
        let saving = false;
        const save = async (patch: Parameters<typeof window.gwNative.settings.set>[0]) => {
          if (!available() || saving) { paint(); return; }
          saving = true; status.hidden = true; paint();
          try { settings = await window.gwNative.settings.set(patch); }
          catch { status.textContent = 'Could not save this change. Try again.'; status.hidden = false; }
          finally { saving = false; if (!disposed) paint(); }
        };
        painters.push(() => { check.checked = settings[key]; check.disabled = saving || !available(); state.textContent = settings[key] ? 'On' : 'Off'; });
        check.onchange = () => { void save({ [key]: check.checked }); };
        if (opacity) {
          const control = doc.createElement('label'); control.className = 'hub-map-opacity'; control.textContent = opacityTitle;
          const range = doc.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.setAttribute('aria-label', opacityTitle);
          const value = doc.createElement('output');
          painters.push(() => { range.value = String(settings[opacity]); range.disabled = saving || !available() || !settings[key]; value.textContent = `${range.value}%`; });
          range.oninput = () => { value.textContent = `${range.value}%`; };
          range.onchange = () => { void save({ [opacity]: Number(range.value) }); };
          control.append(range, value); group.append(control);
        }
        view.append(group);
      }
      view.append(status); paint(); view.querySelector('input')?.focus();
    }).catch(() => { if (!disposed) { status.textContent = 'Maps controls could not load.'; status.hidden = false; view.append(status); } });
    let removeListener = () => {};
    return () => { disposed = true; removeListener(); view.remove(); };
  }, available);
}
