/**
 * Minimal game-start fallback owned by the game renderer.
 * Client preparation, updates, repair, and recovery live in the launcher.
 */
window.gwAutomation = (function (): EnhancementAutomation {
  let stage = 'renderer.loading';
  let sequence = 0;
  const history: { sequence: number; stage: string; atMs: number }[] = [];
  return Object.freeze({
    set(next: string) {
      if (typeof next !== 'string' || next === stage) return;
      stage = next;
      sequence += 1;
      history.push({ sequence, stage, atMs: performance.now() });
      if (history.length > 32) history.shift();
    },
    read() {
      const enhancement = window.gwCompanionState;
      return Object.freeze({ stage, sequence, transitions: history.slice(), enhancementStatus: enhancement?.status ?? 'not-installed', tickCount: enhancement && 'tickCount' in enhancement ? enhancement.tickCount : 0 });
    },
  });
})();

window.gwLoading = (function (): LoadingController {
  const required = (id: string): HTMLElement => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`missing renderer element: ${id}`);
    return element;
  };
  const root = required('loading');
  const label = required('loading-label');
  const detail = required('loading-detail');
  const crashDetail = required('loading-crash-detail') as HTMLDetailsElement;
  const crashText = required('loading-crash-text');
  const showFailure = (text: string, explanation = ''): void => {
    root.classList.add('failed');
    root.classList.remove('gone');
    label.textContent = text;
    detail.textContent = explanation;
  };
  const api: LoadingController = {
    set(text, _fraction, explanation) { label.textContent = text; detail.textContent = explanation || ''; },
    fail(text, explanation) { showFailure(text, explanation ?? 'Close this window and try this account again from the launcher.'); },
    failFilesystem() { showFailure('Saved game files could not be opened.', 'Close this window and reset this account’s game storage from the launcher.'); },
    failCrash(_crashCount, technicalDetail) {
      showFailure('Guild Wars stopped before it was ready.', 'Close this window and try this account again from the launcher.');
      if (technicalDetail !== undefined) crashText.textContent = technicalDetail;
      crashDetail.hidden = !crashText.textContent;
    },
    done() {
      if (root.classList.contains('gone')) return;
      root.classList.add('gone');
      setTimeout(() => { root.style.display = 'none'; }, 220);
      required('canvas').focus();
    },
    async waitForClient() { return true; },
  };
  return api;
})();
