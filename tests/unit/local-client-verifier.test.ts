import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENHANCEMENT_BUILDS,
  type KnownEnhancementBuild,
} from "../../src/main/certification/enhancement-builds.js";
import {
  isLocalClientVerification,
  localFeatureVerdictsForBuild,
  type LocalClientVerification,
} from "../../src/main/certification/local-client-verifier.js";
import { SEMANTIC_VERIFIER_ABI } from "../../src/main/certification/semantic-proof.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";
import type { EnhancementCapabilities } from "../../src/shared/enhancement-contracts.js";

const ENHANCEMENT = ENHANCEMENT_BUILDS[0]!;
const TEMPLATE = TEMPLATE_SAVE_BUILDS.find(
  (build) => build.outputSha256 === ENHANCEMENT.sha256,
)!;
const NONE: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
});
const ALL: EnhancementCapabilities = Object.freeze({
  ...NONE,
  nativeCursor: true,
  targetObservation: true,
  partyObservation: true,
  teamApply: true,
  travelAction: true,
  xunlaiAction: true,
  chatAliases: true,
});
const CURSOR: EnhancementCapabilities = Object.freeze({
  ...NONE,
  nativeCursor: true,
});
const TARGET: EnhancementCapabilities = Object.freeze({
  ...NONE,
  targetObservation: true,
});
const STORAGE: EnhancementCapabilities = Object.freeze({
  ...NONE,
  travelAction: true,
  xunlaiAction: true,
  chatAliases: true,
});
const PARTY_TEAM: EnhancementCapabilities = Object.freeze({
  ...NONE,
  partyObservation: true,
  teamApply: true,
});
type ProvedVerification = Extract<LocalClientVerification, { status: "proved" }>;

function verificationFor(
  enhancementBuild: KnownEnhancementBuild,
  requested: EnhancementCapabilities,
): ProvedVerification {
  return {
    status: "proved",
    officialSha256: TEMPLATE.sha256,
    verifierAbi: SEMANTIC_VERIFIER_ABI,
    templateSaveBuild: TEMPLATE,
    enhancementBuild,
    featureVerdicts: localFeatureVerdictsForBuild(
      TEMPLATE.outputSha256,
      requested,
      enhancementBuild,
    ),
    reasons: [],
  };
}

function valid(): ProvedVerification {
  return verificationFor({
    ...ENHANCEMENT,
    outputSha256: {
      "features-7f": ENHANCEMENT.outputSha256["features-7f"]!,
    },
  }, ALL);
}

function automaticCursor(): ProvedVerification {
  const cursor = ENHANCEMENT.cursorEvent!;
  return verificationFor(
    {
      sha256: ENHANCEMENT.sha256,
      outputSha256: { "features-01": "1".repeat(64) },
      programId: ENHANCEMENT.programId,
      buildId: ENHANCEMENT.buildId + 1,
      hookFunction: ENHANCEMENT.hookFunction + 1,
      hookParams: ENHANCEMENT.hookParams,
      hookResults: ENHANCEMENT.hookResults,
      hookBodySha256: "2".repeat(64),
      tableSlot: ENHANCEMENT.tableSlot,
      cursorEvent: {
        ...cursor,
        bodySha256: "5".repeat(64),
        functionIndex: cursor.functionIndex + 1,
        producerFunctions: [
          cursor.producerFunctions[0] + 1,
          cursor.producerFunctions[1] + 1,
        ],
        producerBodySha256: ["3".repeat(64), "4".repeat(64)],
        layout: {
          ...cursor.layout,
          cursorActiveArt: cursor.layout.cursorActiveArt - 112,
          cursorSoftwareModel: cursor.layout.cursorSoftwareModel - 112,
          cursorShowCount: cursor.layout.cursorShowCount - 112,
          cursorColorBuffer: cursor.layout.cursorColorBuffer - 112,
        },
      },
    },
    CURSOR,
  );
}

function automaticTarget(): ProvedVerification {
  const observation = ENHANCEMENT.observationBase!.layout;
  const target = ENHANCEMENT.targetObservation!.layout;
  const delta = -112;
  return verificationFor(
    {
      sha256: ENHANCEMENT.sha256,
      outputSha256: { "features-02": "5".repeat(64) },
      programId: ENHANCEMENT.programId,
      buildId: ENHANCEMENT.buildId + 1,
      hookFunction: ENHANCEMENT.hookFunction + 1,
      hookParams: ENHANCEMENT.hookParams,
      hookResults: ENHANCEMENT.hookResults,
      hookBodySha256: "6".repeat(64),
      tableSlot: ENHANCEMENT.tableSlot,
      observationBase: {
        layout: {
          ...observation,
          contextRoot: observation.contextRoot + delta,
          agentArray: observation.agentArray + delta,
          areaInfo: observation.areaInfo + delta,
        },
      },
      targetObservation: {
        layout: {
          manualTargetAgentId: target.manualTargetAgentId + delta,
          automaticTargetAgentId: target.automaticTargetAgentId + delta,
        },
      },
    },
    TARGET,
  );
}

function automaticLocalActions(): ProvedVerification {
  const target = automaticTarget();
  const xunlai = ENHANCEMENT.xunlaiAction!;
  const readers = xunlai.accessProof!.readers;
  return verificationFor(
    {
      ...target.enhancementBuild!,
      outputSha256: { "features-70": "7".repeat(64) },
      uiDispatcher: {
        ...ENHANCEMENT.uiDispatcher!,
        bodySha256: "e".repeat(64),
      },
      gameThread: {
        drain: {
          ...ENHANCEMENT.gameThread!.drain,
          bodySha256: "8".repeat(64),
        },
      },
      travelAction: {
        ...ENHANCEMENT.travelAction!,
        producer: {
          ...ENHANCEMENT.travelAction!.producer,
          bodySha256: "f".repeat(64),
        },
        contextResolver: {
          ...ENHANCEMENT.travelAction!.contextResolver,
          bodySha256: "1".repeat(64),
        },
      },
      xunlaiAction: {
        ...xunlai,
        handler: { ...xunlai.handler, bodySha256: "2".repeat(64) },
        accessProof: {
          ...xunlai.accessProof!,
          readers: {
            "agent-id": { ...readers["agent-id"], bodySha256: "9".repeat(64) },
            "access-flags": { ...readers["access-flags"], bodySha256: "9".repeat(64) },
            "player-number": readers["player-number"],
          },
        },
      },
      chatAliases: {
        parser: {
          ...ENHANCEMENT.chatAliases!.parser,
          bodySha256: "a".repeat(64),
        },
      },
    },
    STORAGE,
  );
}

function automaticPartyTeam(): ProvedVerification {
  const localActions = automaticLocalActions();
  const party = ENHANCEMENT.partyObservation!;
  const team = ENHANCEMENT.teamApply!;
  return verificationFor(
    {
      ...localActions.enhancementBuild!,
      outputSha256: { "features-0c": "b".repeat(64) },
      partyObservation: {
        ...party,
        playerChatProducer: party.playerChatProducer + 1,
        nearbyPlayerMessageProducers: [
          party.nearbyPlayerMessageProducers[0] + 1,
          party.nearbyPlayerMessageProducers[1] + 1,
        ],
      },
      teamApply: {
        ...team,
        professionTrace: {
          ...team.professionTrace,
          sender: {
            ...team.professionTrace.sender,
            functionIndex: team.professionTrace.sender.functionIndex + 1,
            bodySha256: "c".repeat(64),
          },
        },
        entries: team.entries.map((entry) => ({
          ...entry,
          functionIndex: entry.functionIndex + 1,
          bodySha256: "d".repeat(64),
        })),
      },
    },
    PARTY_TEAM,
  );
}

describe("local client verification boundary", () => {
  it("accepts the verifier's complete baseline proof", () => {
    assert.equal(isLocalClientVerification(valid(), TEMPLATE.sha256), true);
  });

  it("rejects an exact authored row that did not cross semantic proof", () => {
    assert.equal(
      isLocalClientVerification(
        verificationFor(ENHANCEMENT, ALL),
        TEMPLATE.sha256,
      ),
      false,
    );
  });

  it("rejects a proof for any other official client", () => {
    assert.equal(
      isLocalClientVerification(valid(), "0".repeat(64)),
      false,
    );
  });

  it("rejects an unconstrained enhancement layout", () => {
    assert.equal(isLocalClientVerification({
      ...valid(),
      enhancementBuild: {
        ...ENHANCEMENT,
        observationBase: {
          layout: {
            ...ENHANCEMENT.observationBase!.layout,
            currentMapId: ENHANCEMENT.observationBase!.layout.currentMapId + 4,
          },
        },
      },
    }, TEMPLATE.sha256), false);
  });

  it("accepts a relocated hook but rejects an incompatible signature", () => {
    const relocated = verificationFor(
      {
        ...ENHANCEMENT,
        outputSha256: { "features-7f": ENHANCEMENT.outputSha256["features-7f"]! },
        hookFunction: ENHANCEMENT.hookFunction + 1,
      },
      ALL,
    );
    assert.equal(isLocalClientVerification(relocated, TEMPLATE.sha256), true);
    assert.equal(isLocalClientVerification({
      ...relocated,
      enhancementBuild: {
        ...relocated.enhancementBuild,
        hookParams: ["i64"],
      },
    }, TEMPLATE.sha256), false);
  });

  it("accepts a structurally derived cursor proof and rejects malformed layouts", () => {
    const derived = automaticCursor();
    assert.equal(isLocalClientVerification(derived, TEMPLATE.sha256, CURSOR), true);
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: {
        ...derived.enhancementBuild!,
        cursorEvent: {
          ...derived.enhancementBuild!.cursorEvent!,
          layout: {
            ...derived.enhancementBuild!.cursorEvent!.layout,
            cursorShowCount:
              derived.enhancementBuild!.cursorEvent!.layout.cursorShowCount + 4,
          },
        },
      },
    }, TEMPLATE.sha256, CURSOR), false);
  });

  it("accepts a field-complete Target proof and rejects one bad relocation", () => {
    const derived = automaticTarget();
    assert.equal(isLocalClientVerification(derived, TEMPLATE.sha256, TARGET), true);
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: {
        ...derived.enhancementBuild!,
        targetObservation: {
          layout: {
            ...derived.enhancementBuild!.targetObservation!.layout,
            manualTargetAgentId:
              derived.enhancementBuild!.targetObservation!.layout.manualTargetAgentId + 4,
          },
        },
      },
    }, TEMPLATE.sha256, TARGET), false);
  });

  it("accepts independent local-action proofs and rejects one bad Xunlai field", () => {
    const derived = automaticLocalActions();
    assert.equal(isLocalClientVerification(derived, TEMPLATE.sha256, STORAGE), true);
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: {
        ...derived.enhancementBuild!,
        xunlaiAction: {
          ...derived.enhancementBuild!.xunlaiAction!,
          accessProof: {
            ...derived.enhancementBuild!.xunlaiAction!.accessProof!,
            layout: {
              ...derived.enhancementBuild!.xunlaiAction!.accessProof!.layout,
              playerRecordAccessFlags: 0x38,
            },
          },
        },
      },
    }, TEMPLATE.sha256, STORAGE), false);
  });

  it("accepts complete Party and Team proofs and rejects each independently", () => {
    const derived = automaticPartyTeam();
    assert.equal(isLocalClientVerification(derived, TEMPLATE.sha256, PARTY_TEAM), true);
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: {
        ...derived.enhancementBuild!,
        partyObservation: {
          ...derived.enhancementBuild!.partyObservation!,
          layout: {
            ...derived.enhancementBuild!.partyObservation!.layout,
            heroInfoStride:
              derived.enhancementBuild!.partyObservation!.layout.heroInfoStride + 4,
          },
        },
      },
    }, TEMPLATE.sha256, PARTY_TEAM), false);
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: {
        ...derived.enhancementBuild!,
        teamApply: {
          ...derived.enhancementBuild!.teamApply!,
          entries: derived.enhancementBuild!.teamApply!.entries.map(
            (entry, index) => index === 0
              ? { ...entry, opcode: entry.opcode + 1 }
              : entry,
          ),
        },
      },
    }, TEMPLATE.sha256, PARTY_TEAM), false);
  });

  it("accepts a template-only proof and requires no enhancement behind failure", () => {
    const templateOnly: LocalClientVerification = {
      status: "enhancement-refused",
      officialSha256: TEMPLATE.sha256,
      verifierAbi: SEMANTIC_VERIFIER_ABI,
      templateSaveBuild: TEMPLATE,
      enhancementBuild: null,
      featureVerdicts: localFeatureVerdictsForBuild(
        TEMPLATE.outputSha256,
        ALL,
        null,
      ),
      reasons: ["enhancement-layout-changed"],
    };
    assert.equal(
      isLocalClientVerification(templateOnly, TEMPLATE.sha256),
      true,
    );
    assert.equal(isLocalClientVerification({
      ...templateOnly,
      templateSaveBuild: null,
      enhancementBuild: ENHANCEMENT,
    }, TEMPLATE.sha256), false);
  });

  it("represents an unrequested enhancement as a proved template, not a refusal", () => {
    const templateOnly: LocalClientVerification = {
      status: "template-proved",
      officialSha256: TEMPLATE.sha256,
      verifierAbi: SEMANTIC_VERIFIER_ABI,
      templateSaveBuild: TEMPLATE,
      enhancementBuild: null,
      featureVerdicts: localFeatureVerdictsForBuild(
        TEMPLATE.outputSha256,
        NONE,
        null,
      ),
      reasons: [],
    };
    assert.equal(
      isLocalClientVerification(templateOnly, TEMPLATE.sha256, NONE),
      true,
    );
    assert.equal(isLocalClientVerification(templateOnly, TEMPLATE.sha256), false);
  });

  it("rejects a stale verifier ABI at either boundary", () => {
    const proof = valid();
    assert.equal(isLocalClientVerification({
      ...proof,
      verifierAbi: SEMANTIC_VERIFIER_ABI + 1,
    }, TEMPLATE.sha256), false);
    assert.equal(isLocalClientVerification({
      ...proof,
      featureVerdicts: {
        ...proof.featureVerdicts,
        nativeCursor: {
          ...proof.featureVerdicts.nativeCursor,
          verifierAbi: SEMANTIC_VERIFIER_ABI + 1,
        },
      },
    }, TEMPLATE.sha256), false);
  });

  it("binds each verdict to the post-template hash and requested feature", () => {
    const cursor = automaticCursor();
    assert.equal(cursor.featureVerdicts.nativeCursor.status, "proved");
    assert.equal(cursor.featureVerdicts.targetObservation.status, "not-requested");
    assert.equal(cursor.featureVerdicts.travelAction.status, "not-requested");
    assert.equal(isLocalClientVerification({
      ...cursor,
      featureVerdicts: {
        ...cursor.featureVerdicts,
        targetObservation: {
          status: "changed",
          inputSha256: TEMPLATE.outputSha256,
          verifierAbi: SEMANTIC_VERIFIER_ABI,
          invariant: "targetObservation-structure-changed",
        },
      },
    }, TEMPLATE.sha256, CURSOR), false);
    assert.equal(isLocalClientVerification({
      ...cursor,
      featureVerdicts: {
        ...cursor.featureVerdicts,
        nativeCursor: {
          ...cursor.featureVerdicts.nativeCursor,
          inputSha256: "0".repeat(64),
        },
      },
    }, TEMPLATE.sha256, CURSOR), false);
  });

  it("carries anchor-specific changed and ambiguous evidence across IPC", () => {
    const featureVerdicts = localFeatureVerdictsForBuild(
      TEMPLATE.outputSha256,
      ALL,
      null,
      {
        nativeCursor: {
          status: "ambiguous",
          invariant: "cursor.event-owner",
          candidates: 2,
        },
        travelAction: {
          status: "changed",
          invariant: "local.game-thread-safe-point",
        },
      },
    );
    const refusal: LocalClientVerification = {
      status: "enhancement-refused",
      officialSha256: TEMPLATE.sha256,
      verifierAbi: SEMANTIC_VERIFIER_ABI,
      templateSaveBuild: TEMPLATE,
      enhancementBuild: null,
      featureVerdicts,
      reasons: ["enhancement-layout-changed"],
    };
    assert.deepEqual(featureVerdicts.nativeCursor, {
      status: "ambiguous",
      invariant: "cursor.event-owner",
      candidates: 2,
      inputSha256: TEMPLATE.outputSha256,
      verifierAbi: SEMANTIC_VERIFIER_ABI,
    });
    assert.deepEqual(featureVerdicts.travelAction, {
      status: "changed",
      invariant: "local.game-thread-safe-point",
      inputSha256: TEMPLATE.outputSha256,
      verifierAbi: SEMANTIC_VERIFIER_ABI,
    });
    const received: unknown = JSON.parse(JSON.stringify(refusal));
    assert.equal(isLocalClientVerification(received, TEMPLATE.sha256), true);

    const invalidCandidates = structuredClone(refusal) as unknown as {
      featureVerdicts: { nativeCursor: { candidates: number } };
    };
    invalidCandidates.featureVerdicts.nativeCursor.candidates = 1;
    assert.equal(
      isLocalClientVerification(invalidCandidates, TEMPLATE.sha256),
      false,
    );

    const invalidInvariant = structuredClone(refusal) as unknown as {
      featureVerdicts: { nativeCursor: { invariant: string } };
    };
    invalidInvariant.featureVerdicts.nativeCursor.invariant =
      "nativeCursor-structure-changed";
    assert.equal(
      isLocalClientVerification(invalidInvariant, TEMPLATE.sha256),
      false,
    );
  });
});
