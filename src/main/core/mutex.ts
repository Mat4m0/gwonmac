/**
 * Serialises the operations that move generation directories.
 *
 * `update`, candidate confirmation and crash rollback all rename
 * `artifacts`, `artifacts.previous` and `artifacts.failed`. Nothing in the
 * process stopped two of them from interleaving at an `await`, so one could
 * observe — or rename away — a tree the other had half moved.
 *
 * Take this only for operations that move a directory. Reads and the full
 * download must stay concurrent with everything else.
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
}
