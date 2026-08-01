/**
 * Confirms a newly published client only after the renderer has shown a frame
 * and opened a game socket. The main-process operation is idempotent, but IPC
 * or filesystem failures can be transient, so this controller makes a small,
 * bounded number of attempts instead of latching the first rejection forever.
 */

import type { ClientHealthToken } from '../shared/contracts.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

type RetryTimer = ReturnType<typeof globalThis.setTimeout>;

export type ClientHealthConfirmation = {
  firstFramePresented: () => void;
  gameSocketOpened: () => void;
  dispose: () => void;
};

type ClientHealthOptions = {
  /** The exact generation this renderer captured before loading the game. */
  token: ClientHealthToken | null;
  confirm: (token: ClientHealthToken) => Promise<void>;
  onFailure: (error: unknown, attempt: number, willRetry: boolean) => void;
  schedule?: (task: () => void, delayMs: number) => RetryTimer;
  cancel?: (timer: RetryTimer) => void;
};

export function createClientHealthConfirmation({
  token,
  confirm,
  onFailure,
  schedule = (task, delayMs) => globalThis.setTimeout(task, delayMs),
  cancel = (timer) => globalThis.clearTimeout(timer),
}: ClientHealthOptions): ClientHealthConfirmation {
  let firstFramePresented = false;
  let gameSocketOpened = false;
  let attempts = 0;
  let running = false;
  let confirmed = false;
  let disposed = false;
  let retryTimer: RetryTimer | null = null;

  function tryConfirm() {
    if (
      token === null ||
      disposed ||
      confirmed ||
      running ||
      retryTimer !== null ||
      attempts >= MAX_ATTEMPTS ||
      !firstFramePresented ||
      !gameSocketOpened
    ) {
      return;
    }

    attempts += 1;
    running = true;
    void Promise.resolve()
      .then(() => confirm(token))
      .then(() => {
        if (!disposed) confirmed = true;
      })
      .catch((error) => {
        if (disposed) return;
        const willRetry = attempts < MAX_ATTEMPTS;
        onFailure(error, attempts, willRetry);
        if (willRetry) {
          retryTimer = schedule(() => {
            retryTimer = null;
            tryConfirm();
          }, RETRY_DELAY_MS);
        }
      })
      .finally(() => {
        running = false;
      });
  }

  return {
    firstFramePresented() {
      firstFramePresented = true;
      tryConfirm();
    },
    gameSocketOpened() {
      gameSocketOpened = true;
      tryConfirm();
    },
    dispose() {
      disposed = true;
      if (retryTimer !== null) cancel(retryTimer);
      retryTimer = null;
    },
  };
}
