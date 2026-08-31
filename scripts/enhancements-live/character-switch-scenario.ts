import type { CharacterSwitchDiagnostics } from
  "../../src/renderer/character-switch-model.js";
import { operatorCheckpoint } from "./scenario-checkpoint.js";

type Context = Readonly<{
  readCharacterSwitchDiagnostics(): Promise<CharacterSwitchDiagnostics | null>;
  wait(milliseconds: number): Promise<void>;
}>;

type Evidence = Readonly<{
  before: CharacterSwitchDiagnostics | null;
  after: CharacterSwitchDiagnostics | null;
  final: CharacterSwitchDiagnostics | null;
  outcome: "complete" | "failed" | "action-timeout";
  trace: readonly Readonly<Record<string, unknown>>[];
}>;

export async function runCharacterSwitchScenario({
  readCharacterSwitchDiagnostics,
  wait,
}: Context): Promise<Evidence> {
  const trace: Readonly<Record<string, unknown>>[] = [];
  let traceStarted = 0;
  let lastTrace = "";
  let sampling = false;
  const sample = async () => {
    const value = await readCharacterSwitchDiagnostics();
    if (!value || value.version !== 7) return;
    const compact = Object.freeze({
      atBucketMs: Math.min(60_000, Math.floor((performance.now() - traceStarted) / 100) * 100),
      readerState: value.readerState,
      characterCount: value.characterCount,
      playability: value.playability,
      actionSequence: value.actionSequence,
      stage: value.stage,
      lastCode: value.lastCode,
      lastSelectorReadiness: value.lastSelectorReadiness,
      selectorReadinessRetries: value.selectorReadinessRetries,
      lastFrameProofMask: value.lastFrameProofMask,
      lastSelectorProofMask: value.lastSelectorProofMask,
      selectorClickProved: value.selectorClickProved,
      selectorConfirmationProved: value.selectorConfirmationProved,
      selectorParentResolverProved: value.selectorParentResolverProved,
      selectorParentIdentityProved: value.selectorParentIdentityProved,
      selectorParentProved: value.selectorParentProved,
      selectorContextRowsProved: value.selectorContextRowsProved,
      selectorContextProved: value.selectorContextProved,
      selectorContextIdentityProved: value.selectorContextIdentityProved,
      selectorCharacterArrayProved: value.selectorCharacterArrayProved,
      selectorTargetProved: value.selectorTargetProved,
      selectorTargetPointerProved: value.selectorTargetPointerProved,
      requestedListIndex: value.requestedListIndex,
      selectorObservedIndex: value.selectorObservedIndex,
      counters: value.counters,
    });
    const signature = JSON.stringify({ ...compact, atBucketMs: 0 });
    if (signature === lastTrace) return;
    lastTrace = signature;
    trace.push(compact);
    if (trace.length > 64) trace.shift();
  };
  await operatorCheckpoint(
    "Sign in with a safe character and enter an outpost. Open Command-R and verify "
      + "the character count, names, profession icons, and Current marker against the "
      + "native selector. Do not paste or report any names.",
  );
  const before = await readCharacterSwitchDiagnostics();
  const sampler = (async () => {
    traceStarted = performance.now();
    sampling = true;
    while (sampling) {
      await sample();
      await wait(100);
    }
    await sample();
  })();
  console.log(JSON.stringify({
    checkpoint: "operator-action",
    please: "In Command-R, choose another character exactly once with Return or 1-9/0. "
      + "Do not Retry. The runner will capture and stop automatically at success or failure.",
  }));
  const beforeSequence = before?.version === 7 ? before.actionSequence : 0;
  const actionDeadline = Date.now() + 5 * 60_000;
  let after: CharacterSwitchDiagnostics | null = null;
  while (Date.now() < actionDeadline) {
    const candidate = await readCharacterSwitchDiagnostics();
    if (
      candidate?.version === 7
      && candidate.actionSequence > beforeSequence
      && (candidate.stage === "complete" || candidate.stage === "failed")
    ) {
      after = candidate;
      break;
    }
    await wait(100);
  }
  sampling = false;
  await sampler;
  after ??= await readCharacterSwitchDiagnostics();
  if (after?.stage !== "complete") {
    return Object.freeze({
      before,
      trace: Object.freeze(trace),
      after,
      final: after,
      outcome: after?.stage === "failed" ? "failed" : "action-timeout",
    });
  }
  await operatorCheckpoint(
    "Open Command-R again. Confirm Current moved to the loaded character, then try the "
      + "disabled Current row and confirm no game action occurs.",
  );
  return Object.freeze({
    before,
    trace: Object.freeze(trace),
    after,
    final: await readCharacterSwitchDiagnostics(),
    outcome: "complete",
  });
}

export function validateCharacterSwitchScenario(result: {
  rendererErrorCount?: number;
  evidence?: Evidence;
}): void {
  const after = result.evidence?.after;
  const final = result.evidence?.final;
  if (
    !result.evidence?.before
    || after?.version !== 7
    || final?.version !== 7
    || after.stage !== "complete"
    || final.stage !== "complete"
    || final.counters.logout !== 1
    || final.counters.select < 1
    || final.counters.play !== 1
    || (result.rendererErrorCount ?? 0) !== 0
  ) {
    throw new Error("character switch did not reach its privacy-safe acceptance state");
  }
}
