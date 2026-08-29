/**
 * The player-facing dictation control beside Guild Wars' hidden text proxies.
 * Apple owns recognition; this module owns eligibility, visible state, and the
 * final explicit insertion into the still-active draft. It never sends chat.
 */

import type { DictationEvent } from '../shared/contracts.js';
import type { CompanionSkillSlotState } from './companion-interface-geometry-snapshot.js';
import { projectGameRect } from './skill-slot-projection.js';

export interface DictationControl {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export function dictationPlacement(
  chat: Readonly<{ x: number; y: number; width: number; height: number }>,
  viewport: Readonly<{ width: number; height: number }>,
) {
  const size = 36;
  const gap = 8;
  return Object.freeze({
    left: Math.min(viewport.width - size - gap, chat.x + chat.width + gap),
    top: Math.max(gap, Math.min(
      viewport.height - size - gap,
      chat.y + (chat.height - size) / 2,
    )),
  });
}

export function installDictation(document: Document): DictationControl {
  const control = document.getElementById('dictation-control');
  const button = document.getElementById('dictation-button');
  const status = document.getElementById('dictation-status');
  if (!(control instanceof HTMLElement)
      || !(button instanceof HTMLButtonElement)
      || !(status instanceof HTMLElement)) {
    throw new Error('dictation controls are missing');
  }

  let enabled = false;
  let state: 'idle' | 'requesting' | 'preparing' | 'listening' | 'finishing' | 'error' = 'idle';
  let eligibleInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  let geometryReady = false;
  let geometryState: CompanionSkillSlotState | null = null;
  let errorTimer: number | null = null;

  const activeEligibleInput = () => {
    const active = document.activeElement;
    if (window.Module?.oskActiveInput !== active) return null;
    if (active instanceof HTMLTextAreaElement && active.id === 'osk-input-multiline') {
      return active;
    }
    if (active instanceof HTMLInputElement
        && active.id === 'osk-input-text'
        && active.type === 'text') {
      return active;
    }
    return null;
  };

  const render = (message = 'Dictate') => {
    control.hidden = !enabled || eligibleInput === null || !geometryReady;
    control.dataset.state = state;
    status.textContent = message;
    button.disabled = state === 'requesting' || state === 'preparing' || state === 'finishing';
    button.setAttribute(
      'aria-label',
      state === 'listening' ? 'Finish dictation' : 'Start dictation',
    );
  };

  const reset = () => {
    state = 'idle';
    if (errorTimer !== null) window.clearTimeout(errorTimer);
    errorTimer = null;
    render();
  };

  const cancel = () => {
    if (state === 'idle') return;
    void window.gwNative.dictation.cancel();
    reset();
  };

  const syncFocus = () => {
    const next = activeEligibleInput();
    if (next !== eligibleInput) cancel();
    eligibleInput = next;
    render();
  };

  const onEvent = (event: DictationEvent) => {
    const input = eligibleInput;
    if (!enabled || input === null || input !== activeEligibleInput()) {
      cancel();
      return;
    }
    if (event.state === 'requesting') {
      state = 'requesting';
      render('Allow microphone access…');
      return;
    }
    if (event.state === 'preparing') {
      state = 'preparing';
      const percentage = event.progress === undefined
        ? null
        : Math.round(Math.max(0, Math.min(1, event.progress)) * 100);
      render(percentage === null
        ? 'Preparing on-device dictation…'
        : `Downloading on-device dictation… ${percentage}%`);
      return;
    }
    if (event.state === 'listening') {
      state = 'listening';
      render(event.transcript || 'Listening…');
      return;
    }
    if (event.state === 'final') {
      reset();
      return;
    }
    state = 'error';
    const errorMessage = event.reason === 'permission-denied'
      ? 'Allow Microphone and Speech Recognition in System Settings'
      : event.reason === 'audio-unavailable'
        ? 'No microphone is available'
        : event.reason === 'model-unavailable'
          ? 'No on-device model is available for this language'
        : event.reason === 'model-download-failed'
            ? 'Could not download the on-device dictation model'
          : event.reason === 'setup-required'
            ? 'Finish dictation setup in Settings'
        : event.reason === 'unavailable'
          ? 'On-device dictation is unavailable'
          : event.reason === 'insertion-failed'
            ? 'Could not add dictation to chat'
          : 'Dictation could not understand that';
    render(errorMessage);
    errorTimer = window.setTimeout(reset, 6_000);
  };

  const updateGeometry = (state: CompanionSkillSlotState) => {
    const canvas = document.getElementById('canvas');
    const projected = state.status === 'ready'
      && canvas instanceof HTMLCanvasElement
      && state.chatInput != null
      ? projectGameRect(
          state.chatInput,
          { width: state.viewportWidth, height: state.viewportHeight },
          canvas,
        )
      : null;
    geometryReady = projected !== null;
    if (projected !== null) {
      const placement = dictationPlacement(projected, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      control.style.left = `${placement.left}px`;
      control.style.top = `${placement.top}px`;
    }
    render();
  };

  const geometryListener = (event: WindowEventMap['gwonmac:chat-geometry']) => {
    geometryState = event.detail;
    updateGeometry(geometryState);
  };
  const resizeListener = () => {
    if (geometryState !== null) updateGeometry(geometryState);
  };

  const removeEventListener = window.gwNative.dictation.onEvent(onEvent);
  const focusListener = () => window.setTimeout(syncFocus, 0);
  document.addEventListener('focusin', focusListener);
  document.addEventListener('focusout', focusListener);
  window.addEventListener('blur', cancel);
  window.addEventListener('gwonmac:chat-geometry', geometryListener);
  window.addEventListener('resize', resizeListener);

  // Keep the hidden Guild Wars proxy focused when the pointer presses the mic.
  // Losing focus makes the official client close the text editor.
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    if (state === 'listening') {
      state = 'finishing';
      render('Finishing…');
      void window.gwNative.dictation.finish();
      return;
    }
    if (state !== 'idle' && state !== 'error') return;
    if (errorTimer !== null) window.clearTimeout(errorTimer);
    errorTimer = null;
    state = 'requesting';
    render('Requesting access…');
    void window.gwNative.dictation.start().catch(() => {
      onEvent({ state: 'error', reason: 'unavailable' });
    });
  });

  return {
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled) cancel();
      syncFocus();
    },
    dispose() {
      cancel();
      removeEventListener();
      document.removeEventListener('focusin', focusListener);
      document.removeEventListener('focusout', focusListener);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('gwonmac:chat-geometry', geometryListener);
      window.removeEventListener('resize', resizeListener);
      if (errorTimer !== null) window.clearTimeout(errorTimer);
    },
  };
}
