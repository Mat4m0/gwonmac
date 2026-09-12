/**
 * Keeps one mounted whisper component inside Hub.
 * Reparenting preserves conversation state and avoids a second composer.
 */
import type { WhisperSession } from '../shared/whisper-session.js';
import type { Hub } from './hub.js';

/** Reparents the one mounted conversation view; session and transcript state stay intact. */
export function showWhispersInHub(hub: Hub, root: HTMLElement, parent: HTMLElement, session: WhisperSession) {
  hub.showView('Whispers', (target, back) => {
    session.setPoppedOut(false); root.classList.remove('whisper-popout-host'); root.classList.add('hub-embedded-host'); target.append(root); session.setVisible(true);
    let mounted = true;
    const stop = session.subscribe(state => {
      if (!state.visible) queueMicrotask(() => { if (mounted && !session.state.visible) back(); });
    });
    const goBack = () => back();
    const popOut = () => {
      hub.close();
      session.setPoppedOut(true);
      root.classList.add('whisper-popout-host');
      session.setVisible(true);
      const id = session.state.selected ? `draft-${session.state.selected}` : 'whisper-person';
      requestAnimationFrame(() => root.querySelector<HTMLInputElement>(`input[id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
    };
    root.addEventListener('gw:whispers-popout', popOut);
    root.addEventListener('gw:whispers-back', goBack);
    const frame = requestAnimationFrame(() => {
      const id = session.state.selected ? `draft-${session.state.selected}` : 'whisper-person';
      root.querySelector<HTMLInputElement>(`input[id="${CSS.escape(id)}"]`)?.focus();
    });
    return () => {
      mounted = false; stop(); cancelAnimationFrame(frame); root.removeEventListener('gw:whispers-back', goBack); root.removeEventListener('gw:whispers-popout', popOut);
      root.classList.remove('hub-embedded-host'); parent.append(root); session.setVisible(false);
    };
  }, () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().whispersEnabled);
}

/** Routes all chat entry points through the session's chosen presentation. */
export function toggleHubWhispers(event: Event, hub: Hub, root: HTMLElement, parent: HTMLElement, session: WhisperSession) {
  event.preventDefault();
  const intent = event instanceof CustomEvent ? event.detail : undefined;
  if (intent === 'dock' || !session.state.poppedOut) {
    showWhispersInHub(hub, root, parent, session);
    return;
  }
  session.setVisible(intent === 'show' ? true : !session.state.visible);
  if (session.state.visible) requestAnimationFrame(() => {
    if (!session.state.visible || !session.state.poppedOut) return;
    const id = session.state.selected ? `draft-${session.state.selected}` : 'whisper-person';
    root.querySelector<HTMLInputElement>(`input[id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  });
}
