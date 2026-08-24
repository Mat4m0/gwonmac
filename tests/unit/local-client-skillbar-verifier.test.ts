import assert from "node:assert/strict";
import test from "node:test";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.js";
import {
  diagnoseLocalSkillbarFailures,
  localSkillbarBuildFragment,
  type LocalSkillbarProofs,
} from "../../src/main/certification/local-client-skillbar-verifier.js";

const build = ENHANCEMENT_BUILDS[0]!;

function proofs(
  overrides: Partial<LocalSkillbarProofs> = {},
): LocalSkillbarProofs {
  return Object.freeze({
    requestedGeometry: true,
    requestedCooldown: true,
    playerSkillbar: build.playerSkillbarObservation!,
    cooldownObservationLayout: build.observationBase!.layout,
    geometry: build.skillSlotGeometry!,
    cooldown: build.skillCooldownObservation!,
    includeGeometry: true,
    includeCooldown: true,
    needsStructuralEvidence: false,
    ...overrides,
  });
}

const noSharedFailures = Object.freeze({
  skillSlotGeometry: null,
  skillCooldownObservation: null,
});

test("skillbar diagnostics preserve feature-local failure precedence", () => {
  const missingObservation = diagnoseLocalSkillbarFailures(proofs({
    cooldownObservationLayout: null,
    playerSkillbar: null,
    cooldown: null,
    includeCooldown: false,
    needsStructuralEvidence: true,
  }), noSharedFailures);
  assert.deepEqual(missingObservation.skillCooldownObservation, {
    status: "changed",
    invariant: "skill-cooldown.observation-base",
  });

  const ambiguousPlayerBar = diagnoseLocalSkillbarFailures(proofs({
    playerSkillbar: null,
    cooldown: null,
    includeCooldown: false,
    needsStructuralEvidence: true,
    ambiguousPlayerSkillbarCandidates: 2,
  }), noSharedFailures);
  assert.deepEqual(ambiguousPlayerBar.skillCooldownObservation, {
    status: "ambiguous",
    invariant: "skill-cooldown.player-skillbar",
    candidates: 2,
  });

  const missingReader = diagnoseLocalSkillbarFailures(proofs({
    cooldown: null,
    includeCooldown: false,
    needsStructuralEvidence: true,
  }), noSharedFailures);
  assert.deepEqual(missingReader.skillCooldownObservation, {
    status: "changed",
    invariant: "skill-cooldown.recharge-reader",
  });
});

test("shared module failures override skillbar-specific diagnostics", () => {
  const failures = diagnoseLocalSkillbarFailures(proofs({
    geometry: null,
    cooldown: null,
    includeGeometry: false,
    includeCooldown: false,
    needsStructuralEvidence: true,
  }), {
    skillSlotGeometry: {
      status: "changed",
      invariant: "module.analysis-budget",
    },
    skillCooldownObservation: {
      status: "changed",
      invariant: "module.wasm-validation",
    },
  });
  assert.deepEqual(failures, {
    skillSlotGeometry: {
      status: "changed",
      invariant: "module.analysis-budget",
    },
    skillCooldownObservation: {
      status: "changed",
      invariant: "module.wasm-validation",
    },
  });
});

test("the build fragment keeps cooldown independent from Party UI authority", () => {
  const fragment = localSkillbarBuildFragment(proofs(), false);
  assert.ok(fragment);
  assert.equal(
    fragment.beforeTeam.playerSkillbarObservation,
    build.playerSkillbarObservation,
  );
  assert.equal(fragment.afterTeam.skillSlotGeometry, build.skillSlotGeometry);
  assert.equal(
    fragment.afterTeam.skillCooldownObservation,
    build.skillCooldownObservation,
  );
  assert.deepEqual(Object.keys({
    partyObservation: build.partyObservation,
    ...fragment.beforeTeam,
    teamApply: build.teamApply,
    ...fragment.afterTeam,
  }), [
    "partyObservation",
    "playerSkillbarObservation",
    "teamApply",
    "skillSlotGeometry",
    "skillCooldownObservation",
  ]);

  const partyOnly = localSkillbarBuildFragment(proofs({
    requestedGeometry: false,
    requestedCooldown: false,
    geometry: null,
    cooldownObservationLayout: null,
    cooldown: null,
    includeGeometry: false,
    includeCooldown: false,
  }), true);
  assert.deepEqual(partyOnly, {
    beforeTeam: {
      playerSkillbarObservation: build.playerSkillbarObservation,
    },
    afterTeam: {},
  });
});

test("the build fragment refuses inconsistent include flags", () => {
  assert.equal(localSkillbarBuildFragment(proofs({
    playerSkillbar: null,
  }), false), null);
  assert.equal(localSkillbarBuildFragment(proofs({
    geometry: null,
  }), false), null);
  assert.equal(localSkillbarBuildFragment(proofs({
    cooldown: null,
  }), false), null);
  assert.equal(localSkillbarBuildFragment(proofs({
    requestedGeometry: false,
    requestedCooldown: false,
    playerSkillbar: null,
    cooldownObservationLayout: null,
    geometry: null,
    cooldown: null,
    includeGeometry: false,
    includeCooldown: false,
  }), true), null);
});
