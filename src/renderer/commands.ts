/**
 * The renderer's single subscriber to main→renderer commands. The main process
 * used to reach in with `executeJavaScript` and a string of source it had built
 * by interpolation; it now sends typed events, and this is the one place that
 * turns them into renderer actions.
 *
 * index.html loads this as a classic script, so the file carries no top-level
 * import or export and names the contracts through type-only `import(…)`.
 */
(() => {
  'use strict';

  type CaptureCommand = Extract<
    import('../shared/contracts.js').RendererCommand,
    { type: 'diagnostics.capture' }
  >;

  const dispatch = (name: string, detail?: unknown) => {
    window.dispatchEvent(new window.CustomEvent(name, { detail }));
  };

  async function capture(command: CaptureCommand) {
    const diagnostics = window.gwDiagnostics;
    if (!diagnostics) throw new Error('renderer diagnostics are unavailable');
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
      case 'tools.toggle':
        dispatch('gw:tools-toggle');
        break;
      case 'settings.open':
        dispatch('gw:settings', {
          pane: command.pane,
          checkForUpdates: command.checkForUpdates,
        });
        break;
      case 'filesystem.sync':
        await new Promise<void>((resolve, reject) => {
          const fs = window.Module?.FS;
          if (!fs) {
            resolve();
            return;
          }
          fs.syncfs(false, (error?: unknown) => {
            if (error) reject(error);
            else resolve();
          });
        });
        break;
      case 'input.trace':
        dispatch('gw:input-trace');
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
