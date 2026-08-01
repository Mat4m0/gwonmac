/**
 * Bounded concurrency over a fixed list, and nothing else: at most `jobs`
 * workers, each claiming the next index, `stopped()` consulted before every
 * item so a cancelled download stops claiming work instead of draining the
 * queue.
 *
 * There is no result collection, no ordering guarantee and no retry. A
 * rejection escapes through `Promise.all` while sibling workers are still
 * running, so callers that need those workers to stop pass `stopped`.
 */
export async function mapPool<T>(
  items: readonly T[],
  jobs: number,
  run: (item: T) => Promise<void>,
  stopped: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(jobs, items.length) },
    async () => {
      while (!stopped()) {
        const index = next++;
        if (index >= items.length) return;
        await run(items[index]!);
      }
    },
  );
  await Promise.all(workers);
}
