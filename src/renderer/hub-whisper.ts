/**
 * Routes Hub and shortcut entry points to the one floating whisper session.
 * The existing session retains drafts and transcripts when its window is hidden.
 */
import type { WhisperSession } from '../shared/whisper-session.js';
import type { Hub } from './hub.js';
import { focusable } from './surface-controller.js';

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

/**
 * Where the keyboard goes when Whispers hides while holding it: back to the control that
 * opened it, such as the Trade row whose seller it addresses, while that control is
 * still usable (HUB-132); otherwise to `release` (the game). A keyboard already
 * elsewhere stays there.
 */
export function whisperFocusReturn(root: HTMLElement, release: () => void) {
  let opener: HTMLElement | null = null;
  return (visible: boolean) => {
    const active = root.ownerDocument.activeElement;
    if (visible) {
      opener = active instanceof HTMLElement && active !== root.ownerDocument.body && !root.contains(active) ? active : null;
      return;
    }
    const held = active === null || active === root.ownerDocument.body || root.contains(active);
    if (held) {
      if (opener?.isConnected && focusable(opener)) opener.focus({ preventScroll: true });
      else release();
    }
    opener = null;
  };
}
