export type DevTraceFields = Readonly<Record<string, unknown>>;

/**
 * Bounded development evidence for the Tools lifecycle.
 *
 * Callers pass summaries, never raw observations, library records, packet
 * payloads, names, or account facts. Packaged builds do not enter this path.
 */
export function devTrace(
  enabled: boolean,
  event: string,
  fields: DevTraceFields = {},
): void {
  if (!enabled) return;
  console.debug(`[tools:dev] ${event} ${JSON.stringify(fields)}`);
}
