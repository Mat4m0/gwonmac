export const SIGN_IN_CLEANUP_DEADLINE_MS = 5_000;

interface CleanupTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMER: CleanupTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Wait for isolated sign-in storage cleanup, but never strand the login UI. */
export async function waitForSignInCleanup(
  cleanup: Promise<unknown>,
  timer: CleanupTimer = REAL_TIMER,
): Promise<void> {
  let deadline: unknown;
  await Promise.race([
    cleanup,
    new Promise<void>((resolve) => {
      deadline = timer.set(resolve, SIGN_IN_CLEANUP_DEADLINE_MS);
    }),
  ]).catch(() => undefined);
  if (deadline !== undefined) timer.clear(deadline);
}
