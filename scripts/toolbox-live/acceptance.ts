/**
 * The part of a live-run readout every tier has to produce, and therefore the
 * only part common acceptance is allowed to judge. `scripts/toolbox-live.ts`
 * assembles the full result and each scenario adds its own evidence on top;
 * naming the subset here keeps a scenario-specific field from quietly becoming
 * a precondition for every run.
 */
export type CommonAcceptanceResult = {
  /** whether the Toolbox runtime installed at all. */
  supported: boolean;
  /** the ArenaNet build the runtime observed. */
  buildId: number | null;
  /** how many times the hook was installed. */
  installation: number;
  /** measured hook cadence. */
  hookHertz: number;
  /** the stable map/player snapshot, or null for none. */
  map: unknown;
  /** snapshot observer p95. */
  renderP95Us: number;
  /** snapshots the observer refused. */
  rejectedSnapshots: number;
  /** console and page errors seen. */
  rendererErrors: readonly string[];
};

/**
 * @param expectedBuildId the build the preflight said is installed.
 * @param options `coreObservation` is false for a run whose scenario does not
 *   read game state, so the cadence, map, and snapshot checks below have
 *   nothing to judge.
 */
export function validateCommonAcceptance(
  result: CommonAcceptanceResult,
  expectedBuildId: number,
  { coreObservation = true }: { coreObservation?: boolean } = {},
): void {
  if (!result.supported) throw new Error("Toolbox is unsupported");
  if (result.buildId !== expectedBuildId) {
    throw new Error(
      `runtime build ${result.buildId} does not match ${expectedBuildId}`,
    );
  }
  if (result.installation !== 1) {
    throw new Error(`expected one hook installation, got ${result.installation}`);
  }
  if (coreObservation) {
    if (result.hookHertz < 1 || result.hookHertz > 240) {
      throw new Error(`invalid hook cadence ${result.hookHertz}`);
    }
    if (!result.map) throw new Error("no stable map/player snapshot");
    if (result.renderP95Us >= 250) {
      throw new Error(`snapshot observer p95 is ${result.renderP95Us}us`);
    }
    if (result.rejectedSnapshots !== 0) {
      throw new Error(`rejected ${result.rejectedSnapshots} snapshots`);
    }
  }
  if (
    result.rendererErrors.some((line) =>
      /unknown socket|unhandled|wasm.*trap/i.test(line),
    )
  ) {
    throw new Error("renderer reported a fatal runtime error");
  }
}
