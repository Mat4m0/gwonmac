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

  /**
   * Fires a renderer event and reports whether anything claimed it.
   *
   * Every event here is cancelable, and cancelling one is how a listener says
   * "handled". That is the only honest answer available: dispatching to an
   * empty room succeeds exactly like dispatching to a listener that worked, so
   * a command whose completion the main process reports back to a player needs
   * the listener to say so. Callers that cannot fail ignore the result.
   */
  const dispatch = (name: string, detail?: unknown): boolean =>
    !window.dispatchEvent(
      new window.CustomEvent(name, { cancelable: true, detail }),
    );

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
        // Nothing listens unless the Toolbox capability installed, and a player
        // who pressed the shortcut is owed the difference between "opened" and
        // "nothing happened". The overlay cancels the event to claim it; an
        // uncancelled one means no overlay is installed, which is the ordinary
        // case on a launch that did not ask for the capability.
        if (!dispatch('gw:tools-toggle')) {
          throw new Error(
            'Tools is not available in this launch: the Toolbox capability is not installed.',
          );
        }
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
            else {
              void import('./template-store.js').then(async ({ exportEntries, templateFilesystem }) => {
                const templates = templateFilesystem();
                if (templates) {
                  await window.gwNative.accounts.saveTemplates(exportEntries(templates));
                }
                resolve();
              }).catch(reject);
            }
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
