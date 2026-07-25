export function validateCommonAcceptance(result, expectedBuildId) {
  if (!result.supported) throw new Error("Toolbox is unsupported");
  if (result.buildId !== expectedBuildId) {
    throw new Error(
      `runtime build ${result.buildId} does not match ${expectedBuildId}`,
    );
  }
  if (result.hookHertz < 1 || result.hookHertz > 240) {
    throw new Error(`invalid hook cadence ${result.hookHertz}`);
  }
  if (!result.map) throw new Error("no stable map/player snapshot");
  if (result.installation !== 1) {
    throw new Error(`expected one hook installation, got ${result.installation}`);
  }
  if (result.renderP95Us >= 250) {
    throw new Error(`snapshot observer p95 is ${result.renderP95Us}us`);
  }
  if (result.rejectedSnapshots !== 0) {
    throw new Error(`rejected ${result.rejectedSnapshots} snapshots`);
  }
  if (
    result.rendererErrors.some((line) =>
      /unknown socket|unhandled|wasm.*trap/i.test(line),
    )
  ) {
    throw new Error("renderer reported a fatal runtime error");
  }
}
