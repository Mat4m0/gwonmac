/**
 * Routes Hub and shortcut entry points to the one floating whisper session.
 * The existing session retains drafts and transcripts when its window is hidden.
 */
import type { WhisperSession } from '../shared/whisper-session.js';
import type { Hub } from './hub.js';

export function toggleHubWhispers(event: Event, hub: Hub, root: HTMLElement, session: WhisperSession) {
  event.preventDefault();
  const intent = event instanceof CustomEvent ? event.detail : undefined;
  const show = hub.visible || intent === 'show';
  hub.suspend();
  root.classList.add('whisper-popout-host');
  session.setVisible(show || !session.state.visible);
  if (session.state.visible) requestAnimationFrame(() => {
    if (!session.state.visible) return;
    const id = session.state.selected ? `draft-${session.state.selected}` : 'whisper-person';
    root.querySelector<HTMLInputElement>(`input[id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  });
}
