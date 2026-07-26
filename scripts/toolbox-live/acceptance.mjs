/**
 * The part of a live-run readout every tier has to produce, and therefore the
 * only part common acceptance is allowed to judge. `scripts/toolbox-live.mjs`
 * assembles the full result and each scenario adds its own evidence on top;
 * naming the subset here keeps a scenario-specific field from quietly becoming
 * a precondition for every run.
 *
 * @typedef {object} CommonAcceptanceResult
 * @property {boolean} supported whether the Toolbox runtime installed at all.
 * @property {number | null} buildId the ArenaNet build the runtime observed.
 * @property {number} installation how many times the hook was installed.
 * @property {number} hookHertz measured hook cadence.
 * @property {unknown} map the stable map/player snapshot, or null for none.
 * @property {number} renderP95Us snapshot observer p95.
 * @property {number} rejectedSnapshots snapshots the observer refused.
 * @property {readonly string[]} rendererErrors console and page errors seen.
 */

/**
 * @param {CommonAcceptanceResult} result
 * @param {number} expectedBuildId the build the preflight said is installed.
 * @param {{ coreObservation?: boolean }} [options] `coreObservation` is false
 *   for a run whose scenario does not read game state, so the cadence, map,
 *   and snapshot checks below have nothing to judge.
 */
export function validateCommonAcceptance(
  result,
  expectedBuildId,
  { coreObservation = true } = {},
) {
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
