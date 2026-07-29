// The renderer's single subscriber to main→renderer commands. The main process
// used to reach in with `executeJavaScript` and a string of source it had built
// by interpolation; it now sends typed events, and this is the one place that
// turns them into renderer actions.
//
// index.html loads this as a classic script, so the file carries no top-level
// import or export and names the contracts through type-only `import(…)`.
(() => {
  'use strict';

  type CaptureCommand = Extract<
    import('../shared/contracts.js').RendererCommand,
    { type: 'diagnostics.capture' }
  >;

  const dispatch = (name: string) => {
    window.dispatchEvent(new window.CustomEvent(name));
  };

  async function flushFilesystem() {
    const runtime = globalThis as typeof globalThis & {
      FS?: {
        syncfs(
          populate: boolean,
          callback: (error?: unknown) => void,
        ): void;
      };
    };
    // A close can arrive while the launcher is still in front of the game.
    // Before Emscripten publishes FS there is no mounted IDBFS and therefore
    // nothing profile-owned to flush.
    if (!runtime.FS) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('game filesystem flush timed out')),
        30_000,
      );
      runtime.FS!.syncfs(false, (error) => {
        window.clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      });
    });
  }

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
      case 'filesystem.flush':
        await flushFilesystem();
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
