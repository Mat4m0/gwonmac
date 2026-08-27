import assert from "node:assert/strict";
import test from "node:test";
import { runtimeFeatureVerdicts } from "../../src/main/client-runtime-values.js";
import type { LocalFeatureVerdicts } from
  "../../src/main/certification/local-client-verification-contract.js";
import { ENHANCEMENT_CAPABILITY_FIELDS } from
  "../../src/shared/enhancement-contracts.js";

test("runtime verdicts retain only closed per-feature debugging facts", () => {
  const verdicts = Object.fromEntries(ENHANCEMENT_CAPABILITY_FIELDS.map(
    (feature) => [feature, { status: "not-requested" }],
  )) as unknown as LocalFeatureVerdicts;
  const input = {
    ...verdicts,
    nativeCursor: { status: "proved" },
    targetObservation: {
      status: "changed",
      invariant: "target.observation-selection-anchors",
    },
    partyObservation: {
      status: "ambiguous",
      invariant: "party.observation-anchors",
      candidates: 2,
    },
  } as unknown as LocalFeatureVerdicts;

  const retained = runtimeFeatureVerdicts(input);
  assert.equal(retained?.nativeCursor.status, "proved");
  assert.deepEqual(retained?.targetObservation, {
    status: "changed",
    invariant: "target.observation-selection-anchors",
    candidates: null,
  });
  assert.deepEqual(retained?.partyObservation, {
    status: "ambiguous",
    invariant: "party.observation-anchors",
    candidates: 2,
  });
  assert.deepEqual(retained?.travelAction, {
    status: "off",
    invariant: null,
    candidates: null,
  });
});
