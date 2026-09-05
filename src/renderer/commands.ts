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

  type TextEditEventDetail = import('./text-editing.js').TextEditEventDetail;

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
      case 'visual-problem':
        await diagnostics.visualProblem();
        break;
    }
  }

  window.gwNative.commands.handle(async (command) => {
    if (
      command.type === 'accounts.settings.open'
      || command.type === 'tools.toggle'
      || command.type === 'trade.toggle'
      || command.type === 'storage.open'
      || command.type === 'diagnostics.toggle'
    ) window.gwSurfaces?.dismissTransient();
    switch (command.type) {
      case 'input.reset':
        dispatch('gw:input-reset');
        break;
      case 'diagnostics.visual':
        await window.gwDiagnostics.visualProblem(command.token);
        break;
      case 'input.release':
        dispatch('gw:input-release', command.code);
        break;
      case 'text.edit': {
        const detail: TextEditEventDetail = { command: command.command };
        if (!dispatch('gw:text-edit', detail)) return 'unhandled';
        await detail.done;
        break;
      }
      case 'tools.toggle':
        // Nothing listens unless the Toolbox capability installed, and a player
        // who pressed the shortcut is owed the difference between "opened" and
        // "nothing happened". The overlay cancels the event to claim it; an
        // uncancelled one means no overlay is installed, which is the ordinary
        // case on a launch that did not ask for the capability.
        if (!dispatch('gw:tools-toggle')) {
          throw new Error(
            'Tools is not available right now.',
          );
        }
        break;
      case 'trade.toggle':
        if (!dispatch('gw:trade-toggle')) {
          throw new Error('Trade Chat is not available right now.');
        }
        break;
      case 'storage.open': {
        const result: { error?: unknown } = {};
        if (!dispatch('gw:storage-open', result)) {
          throw new Error(
            'Xunlai storage is not available in this launch.',
          );
        }
        if (result.error !== undefined) throw result.error;
        break;
      }
      case 'travel.toggle': {
        const result: { error?: unknown } = {};
        if (!dispatch('gw:travel-toggle', result)) {
          throw new Error('Travel is not available in this launch.');
        }
        if (result.error !== undefined) throw result.error;
        break;
      }
      case 'character.toggle': {
        const result: { error?: unknown } = {};
        if (!dispatch('gw:character-toggle', result)) {
          throw new Error('Character switching is not available in this launch.');
        }
        if (result.error !== undefined) throw result.error;
        break;
      }
      case 'game.resign':
        await (await import('./resign.js')).resignFromGame();
        break;
      case 'filesystem.sync':
        await new Promise<void>((resolve, reject) => {
          // ArenaNet's generated glue publishes FS on the global object.
          // Module.FS is a throwing compatibility getter unless the client was
          // built with FS in EXPORTED_RUNTIME_METHODS.
          const fs = window.FS;
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
                  await window.gwNative.profileTemplates.saveTemplates(exportEntries(templates));
                }
                resolve();
              }).catch(reject);
            }
          });
        });
        break;
      case 'input.trace':
        dispatch('gw:input-trace', command.enabled);
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
