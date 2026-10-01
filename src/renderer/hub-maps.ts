/**
 * Inline Maps controls write through the existing settings owner.
 * Each layer keeps its state and opacity together and follows external changes.
 */
import type { HubPresenter } from '../shared/hub.js';
import { createTrailingSave } from './trailing-save.js';
export function openHubMaps(hub: HubPresenter<HTMLElement>) {
  const available = () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().cartographyEnabled;
  hub.showView('Maps', target => {
    let disposed = false;
    const doc = target.ownerDocument;
    const view = doc.createElement('section'); view.className = 'hub-detail hub-map-settings';
    const status = doc.createElement('p'); status.className = 'hub-map-status'; status.setAttribute('role', 'status'); view.append(status);
    const painters: (() => void)[] = [];
    type Patch = Parameters<typeof window.gwNative.settings.set>[0];
    let settings: Awaited<ReturnType<typeof window.gwNative.settings.get>> | null = null;
    // The controls stay enabled and keep the keyboard while saves run; they repaint once the
    // latest values are stored, never in between, so no step of a held arrow is undone.
    const saver = createTrailingSave<Patch>({
      write: async patch => { settings = await window.gwNative.settings.set(patch); },
      merge: (waiting, next) => ({ ...waiting, ...next }),
      settled: failed => { if (disposed) return; status.textContent = failed ? 'Could not save this change. Try again.' : ''; paint(); },
    });
    const paint = () => { if (settings && !saver.pending) painters.forEach(update => update()); };
    const save = (patch: Patch) => {
      if (!available()) { paint(); return; }
      status.textContent = ''; saver.save(patch);
    };
    target.append(view);
    void window.gwNative.settings.get().then(initial => {
      if (disposed) return;
      settings = initial;
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
        painters.push(() => { if (!settings) return; check.checked = settings[key]; check.disabled = !available(); state.textContent = settings[key] ? 'On' : 'Off'; });
        check.onchange = () => { state.textContent = check.checked ? 'On' : 'Off'; save({ [key]: check.checked }); };
        if (opacity) {
          const control = doc.createElement('label'); control.className = 'hub-map-opacity'; control.textContent = opacityTitle;
          const range = doc.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.setAttribute('aria-label', opacityTitle);
          const value = doc.createElement('span');
          painters.push(() => { if (!settings) return; range.value = String(settings[opacity]); range.disabled = !available() || !settings[key]; value.textContent = `${range.value}%`; range.setAttribute('aria-valuetext', value.textContent); });
          range.oninput = () => { value.textContent = `${range.value}%`; range.setAttribute('aria-valuetext', value.textContent); };
          range.onchange = () => { save({ [opacity]: Number(range.value) }); };
          control.append(range, value); group.append(control);
        }
        status.before(group);
      }
      paint(); view.querySelector('input')?.focus();
    }).catch(() => { if (!disposed) { status.textContent = 'Maps controls could not load.'; } });
    let removeListener = () => {};
    return () => { disposed = true; removeListener(); view.remove(); };
  }, available);
}
