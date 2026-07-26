// The renderer's single subscriber to main→renderer commands. The main process
// used to reach in with `executeJavaScript` and a string of source it had built
// by interpolation; it now sends typed events, and this is the one place that
// turns them into renderer actions.
(() => {
  'use strict';

  /** @param {string} name */
  const dispatch = (name) => {
    window.dispatchEvent(new window.CustomEvent(name));
  };

  /**
   * @param {Extract<
   *   import('../shared/contracts.js').RendererCommand,
   *   { type: 'diagnostics.capture' }
   * >} command
   */
  async function capture(command) {
    const diagnostics = window.gwDiagnostics;
    if (!diagnostics) return;
    switch (command.action) {
      case 'reset':
        await diagnostics.resetForCapture();
        break;
      case 'started':
        diagnostics.captureStarted(command.level);
        break;
      case 'stopped':
        diagnostics.captureStopped();
        break;
      case 'flush':
        await diagnostics.flush();
        break;
      case 'problem-marked':
        diagnostics.problemMarked();
        break;
    }
  }

  window.gwNative.commands.handle(async (command) => {
    switch (command.type) {
      case 'input.reset':
        dispatch('gw:input-reset');
        break;
      case 'settings.open':
        dispatch('gw:settings');
        break;
      case 'diagnostics.toggle':
        dispatch('gw:diagnostics-toggle');
        break;
      case 'diagnostics.capture':
        await capture(command);
        break;
    }
  });
})();
