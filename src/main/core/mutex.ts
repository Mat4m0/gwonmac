/**
 * Runs queued operations one at a time, in the order they were queued.
 *
 * Take one for work a concurrent caller could catch half done: a directory
 * moved aside, a read-modify-write, a rewritten Keychain slot. Work that
 * tolerates interleaving stays outside it and keeps its concurrency.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Queue `fn` behind whatever is already queued and settle with its result.
   *
   * `.then(fn, fn)` is the whole mechanism: the next task runs whether the
   * previous one fulfilled or rejected, so a failed operation cannot wedge the
   * queue. The caller receives the real promise, rejection included.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next;
    return next;
  }

  /**
   * Settles when everything queued at the time of the read has finished, and
   * only that; anything queued afterwards is not waited for. A failed operation
   * is the caller's business, not the drain's, so this never rejects.
   */
  get settled(): Promise<void> {
    return this.tail.then(
      () => undefined,
      () => undefined,
    );
  }
}
