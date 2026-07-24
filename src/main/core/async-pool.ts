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
