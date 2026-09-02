/**
 * Owns Maps installation across live setting changes and an asynchronous load.
 * Serial installation keeps late completions from leaking disabled overlays.
 */
export function createCartographyLifecycle(
  install: () => Promise<() => void>,
  reportFailure: (error: unknown) => void,
) {
  let enabled = false;
  let loading = false;
  let closed = false;
  let cleanup: (() => void) | undefined;

  return {
    update(next: boolean): void {
      enabled = next && !closed;
      if (!enabled) {
        cleanup?.();
        cleanup = undefined;
        return;
      }
      if (loading || cleanup) return;
      loading = true;
      // A disabled or unloaded window must dispose even a late installation.
      void install().then((dispose) => {
        if (enabled) cleanup = dispose;
        else dispose();
      }).catch(reportFailure).finally(() => { loading = false; });
    },
    dispose(): void {
      closed = true;
      enabled = false;
      cleanup?.();
      cleanup = undefined;
    },
  };
}
