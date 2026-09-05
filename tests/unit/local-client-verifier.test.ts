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
import { enhancementCapabilityProfile } from "../../src/shared/enhancement-contracts.js";

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
  chatFiltering: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
  playerEffectObservation: false,
    effectIconGeometry: false,
  playRegionObservation: false,
    preGameControls: false,
    characterSwitchAction: false,
    quickItemMove: false,
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
  chatFiltering: false,
  skillSlotGeometry: true,
  skillCooldownObservation: true,
  playerEffectObservation: false,
    effectIconGeometry: false,
  playRegionObservation: true,
  preGameControls: true,
  characterSwitchAction: true,
  quickItemMove: false,
});
const ALL_WITH_FILTER: EnhancementCapabilities = Object.freeze({
  ...ALL,
  chatFiltering: true,
});
const CURSOR: EnhancementCapabilities = Object.freeze({
  ...NONE,
  nativeCursor: true,
});
const REGION: EnhancementCapabilities = Object.freeze({
  ...NONE,
  playRegionObservation: true,
    preGameControls: false,
    characterSwitchAction: false,
    quickItemMove: false,
});
const TARGET: EnhancementCapabilities = Object.freeze({
  ...NONE,
  playRegionObservation: true,
    preGameControls: false,
    characterSwitchAction: false,
    quickItemMove: false,
  targetObservation: true,
});
const STORAGE: EnhancementCapabilities = Object.freeze({
  ...NONE,
  playRegionObservation: true,
    preGameControls: false,
    characterSwitchAction: false,
    quickItemMove: false,
  travelAction: true,
  xunlaiAction: true,
  chatAliases: true,
  chatFiltering: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
  playerEffectObservation: false,
    effectIconGeometry: false,
});
const PARTY_TEAM: EnhancementCapabilities = Object.freeze({
  ...NONE,
  playRegionObservation: true,
    preGameControls: false,
    characterSwitchAction: false,
    quickItemMove: false,
  partyObservation: true,
  teamApply: true,
});
const SKILL_SLOTS: EnhancementCapabilities = Object.freeze({
  ...NONE,
  playRegionObservation: true,
    preGameControls: false,
    characterSwitchAction: false,
    quickItemMove: false,
  skillSlotGeometry: true,
});
const COOLDOWN: EnhancementCapabilities = Object.freeze({
  ...NONE,
  playRegionObservation: true,
    preGameControls: false,
    characterSwitchAction: false,
    quickItemMove: false,
  skillCooldownObservation: true,
  playerEffectObservation: false,
    effectIconGeometry: false,
});
const PROVED_FILE = Object.freeze({
  status: "proved" as const,
  inputSha256: TEMPLATE.sha256,
  outputSha256: TEMPLATE.outputSha256,
  verifierAbi: SEMANTIC_VERIFIER_ABI,
});
const REFUSED_FILE = Object.freeze({
  status: "refused" as const,
  inputSha256: TEMPLATE.sha256,
  verifierAbi: SEMANTIC_VERIFIER_ABI,
  reason: "template-shape-changed" as const,
});
type ProvedVerification = Extract<LocalClientVerification, { status: "proved" }>;

function verificationFor(
  enhancementBuild: KnownEnhancementBuild,
  requested: EnhancementCapabilities,
): ProvedVerification {
  return {
    status: "proved",
    fileVerdict: PROVED_FILE,
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
      "features-fff": ENHANCEMENT.outputSha256["features-fff"]!,
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
  const playRegion = ENHANCEMENT.playRegionObservation!.layout;
  const target = ENHANCEMENT.targetObservation!.layout;
  const delta = -112;
  return verificationFor(
    {
      sha256: ENHANCEMENT.sha256,
      outputSha256: { "features-202": "5".repeat(64) },
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
      playRegionObservation: {
        layout: {
          ...playRegion,
          contextRoot: playRegion.contextRoot + delta,
          areaInfo: playRegion.areaInfo + delta,
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
      outputSha256: { "features-270": "7".repeat(64) },
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
      outputSha256: { "features-20c": "b".repeat(64) },
      playerSkillbarObservation: ENHANCEMENT.playerSkillbarObservation!,
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

function automaticSkillSlots(): ProvedVerification {
  const party = automaticPartyTeam();
  const profile = enhancementCapabilityProfile(SKILL_SLOTS)!;
  const partyBuild = { ...party.enhancementBuild! };
  delete partyBuild.teamApply;
  return verificationFor({
    ...partyBuild,
    outputSha256: { [profile]: "7".repeat(64) },
    skillSlotGeometry: {
      initializer: {
        functionIndex: 4_201,
        params: ["i32", "i32"],
        results: [],
        bodySha256:
          "e4b1af23a4efcbb7fd1c484c4168553c91df5df7e1e40a65ff31bb4ca10790e1",
        constructorCallOperand: 1_337,
      },
      constructor: {
        functionIndex: 4_202,
        params: ["i32", "i32", "i32", "i32", "i32", "i32"],
        results: ["i32"],
        bodySha256:
          "a29fca1d30e5fa7dea1ca30f6453acbb8a099e4423c1f05ee43b01cfc3045c41",
      },
      labelAddress: 5_700_000,
      layout: {
        frameArray: 5_906_396,
        frameCount: 5_906_404,
        frameBytes: 0x1c8,
        frameChildOffsetId: 0xb8,
        frameId: 0xbc,
        framePositionFlags: 0xd8,
        frameViewportWidth: 0x104,
        frameViewportHeight: 0x108,
        frameScreenLeft: 0x10c,
        frameScreenBottom: 0x110,
        frameScreenRight: 0x114,
        frameScreenTop: 0x118,
        frameRelation: 0x128,
        frameState: 0x18c,
      },
    },
  }, SKILL_SLOTS);
}

function automaticCooldown(): ProvedVerification {
  return verificationFor({
    sha256: ENHANCEMENT.sha256,
    outputSha256: { "features-300": "8".repeat(64) },
    programId: ENHANCEMENT.programId,
    buildId: ENHANCEMENT.buildId,
    hookFunction: ENHANCEMENT.hookFunction,
    hookParams: ENHANCEMENT.hookParams,
    hookResults: ENHANCEMENT.hookResults,
    hookBodySha256: ENHANCEMENT.hookBodySha256,
    tableSlot: ENHANCEMENT.tableSlot,
    playRegionObservation: ENHANCEMENT.playRegionObservation!,
    observationBase: ENHANCEMENT.observationBase!,
    playerSkillbarObservation: ENHANCEMENT.playerSkillbarObservation!,
    skillCooldownObservation: ENHANCEMENT.skillCooldownObservation!,
  }, COOLDOWN);
}

describe("local client verification boundary", () => {
  it("certifies play region directly from the exact observation base", () => {
    const verdicts = localFeatureVerdictsForBuild(
      TEMPLATE.outputSha256,
      REGION,
      ENHANCEMENT,
    );
    assert.equal(verdicts.playRegionObservation.status, "proved");
    if (verdicts.playRegionObservation.status !== "proved") return;
    assert.equal(
      verdicts.playRegionObservation.value.playRegionObservation,
      ENHANCEMENT.playRegionObservation,
    );
    assert.equal(verdicts.targetObservation.status, "not-requested");
    assert.equal(verdicts.partyObservation.status, "not-requested");
  });

  it("closes proved feature verdicts through the capability registry", () => {
    const withoutPlayRegion = {
      ...ENHANCEMENT,
      outputSha256: { "features-01": "7".repeat(64) },
    };
    delete withoutPlayRegion.playRegionObservation;
    const verification = verificationFor(withoutPlayRegion, ALL);

    assert.equal(verification.featureVerdicts.nativeCursor.status, "proved");
    for (const feature of [
      "targetObservation",
      "partyObservation",
      "teamApply",
      "travelAction",
      "xunlaiAction",
      "chatAliases",
      "skillSlotGeometry",
      "skillCooldownObservation",
      "preGameControls",
    ] as const) {
      assert.equal(verification.featureVerdicts[feature].status, "changed", feature);
    }
    assert.equal(
      isLocalClientVerification(verification, TEMPLATE.sha256, ALL),
      true,
    );
  });
  it("accepts the verifier's complete baseline proof", () => {
    assert.equal(isLocalClientVerification(valid(), TEMPLATE.sha256, ALL), true);
  });

  it("accepts the chat filter certificate and rejects changed template facts", () => {
    const verification = verificationFor({
      ...ENHANCEMENT,
      outputSha256: { "features-1fff": "9".repeat(64) },
    }, ALL_WITH_FILTER);
    assert.equal(
      isLocalClientVerification(verification, TEMPLATE.sha256, ALL_WITH_FILTER),
      true,
    );
    assert.equal(isLocalClientVerification({
      ...verification,
      enhancementBuild: {
        ...verification.enhancementBuild,
        chatFiltering: {
          ...verification.enhancementBuild.chatFiltering!,
          hallOfHeroesTemplate:
            verification.enhancementBuild.chatFiltering!.hallOfHeroesTemplate + 1,
        },
      },
    }, TEMPLATE.sha256, ALL_WITH_FILTER), false);
  });

  it("rejects an exact authored row that did not cross semantic proof", () => {
    assert.equal(
      isLocalClientVerification(
        verificationFor({
          ...ENHANCEMENT,
          outputSha256: {
            ...ENHANCEMENT.outputSha256,
            "features-01": "f".repeat(64),
          },
        }, ALL),
        TEMPLATE.sha256,
      ),
      false,
    );
  });

  it("rejects a proof for any other official client", () => {
    assert.equal(
      isLocalClientVerification(valid(), "0".repeat(64), ALL),
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
    }, TEMPLATE.sha256, ALL), false);
  });

  it("accepts a relocated hook but rejects an incompatible signature", () => {
    const relocated = verificationFor(
      {
        ...ENHANCEMENT,
        outputSha256: { "features-fff": ENHANCEMENT.outputSha256["features-fff"]! },
        hookFunction: ENHANCEMENT.hookFunction + 1,
      },
      ALL,
    );
    assert.equal(isLocalClientVerification(relocated, TEMPLATE.sha256, ALL), true);
    assert.equal(isLocalClientVerification({
      ...relocated,
      enhancementBuild: {
        ...relocated.enhancementBuild,
        hookParams: ["i64"],
      },
    }, TEMPLATE.sha256, ALL), false);
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
    const travelVerdict = derived.featureVerdicts.travelAction;
    assert.equal(travelVerdict.status, "proved");
    if (travelVerdict.status === "proved") {
      assert.equal(
        travelVerdict.value.playRegionObservation,
        derived.enhancementBuild!.playRegionObservation,
      );
    }
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

  it("validates the complete skill-slot geometry proof at the process boundary", () => {
    const derived = automaticSkillSlots();
    assert.equal(
      isLocalClientVerification(derived, TEMPLATE.sha256, SKILL_SLOTS),
      true,
    );
    const geometryVerdict = derived.featureVerdicts.skillSlotGeometry;
    assert.equal(geometryVerdict.status, "proved");
    if (geometryVerdict.status === "proved") {
      assert.equal(
        geometryVerdict.value.playRegionObservation,
        derived.enhancementBuild!.playRegionObservation,
      );
    }

    type MutableSkillSlotProof = Record<string, unknown> & {
      initializer: Record<string, unknown>;
      constructor: Record<string, unknown>;
      labelAddress: number;
      layout: Record<string, number>;
    };
    const mutations: readonly ((proof: MutableSkillSlotProof) => void)[] = [
      (proof) => { proof.unexpected = 1; },
      (proof) => { proof.initializer.functionIndex = -1; },
      (proof) => { proof.initializer.constructorCallOperand = -1; },
      (proof) => { proof.initializer.params = ["i64", "i32"]; },
      (proof) => { proof.initializer.results = ["i32"]; },
      (proof) => { proof.initializer.bodySha256 = "not-a-digest"; },
      (proof) => { proof.constructor.functionIndex = -1; },
      (proof) => { proof.constructor.params = ["i32"]; },
      (proof) => { proof.constructor.results = []; },
      (proof) => { proof.constructor.bodySha256 = "not-a-digest"; },
      (proof) => { proof.labelAddress = 0; },
      (proof) => { proof.layout.frameArray = Number(proof.layout.frameArray) + 4; },
      (proof) => { proof.layout.frameCount = Number(proof.layout.frameCount) + 4; },
      (proof) => { proof.layout.frameBytes = Number(proof.layout.frameBytes) + 4; },
      (proof) => { proof.layout.frameChildOffsetId = Number(proof.layout.frameChildOffsetId) + 4; },
      (proof) => { proof.layout.frameId = Number(proof.layout.frameId) + 4; },
      (proof) => { proof.layout.framePositionFlags = Number(proof.layout.framePositionFlags) + 4; },
      (proof) => { proof.layout.frameViewportWidth = Number(proof.layout.frameViewportWidth) + 4; },
      (proof) => { proof.layout.frameViewportHeight = Number(proof.layout.frameViewportHeight) + 4; },
      (proof) => { proof.layout.frameScreenLeft = Number(proof.layout.frameScreenLeft) + 4; },
      (proof) => { proof.layout.frameScreenBottom = Number(proof.layout.frameScreenBottom) + 4; },
      (proof) => { proof.layout.frameScreenRight = Number(proof.layout.frameScreenRight) + 4; },
      (proof) => { proof.layout.frameScreenTop = Number(proof.layout.frameScreenTop) + 4; },
      (proof) => { proof.layout.frameState = Number(proof.layout.frameState) + 4; },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(derived);
      mutate(
        invalid.enhancementBuild!.skillSlotGeometry as unknown as MutableSkillSlotProof,
      );
      assert.equal(
        isLocalClientVerification(invalid, TEMPLATE.sha256, SKILL_SLOTS),
        false,
      );
    }
  });

  it("certifies cooldown from the player skillbar without Party or UI authority", () => {
    const derived = automaticCooldown();
    assert.equal(
      isLocalClientVerification(derived, TEMPLATE.sha256, COOLDOWN),
      true,
    );
    const build = derived.enhancementBuild!;
    assert.equal(build.partyObservation, undefined);
    assert.equal(build.uiDispatcher, undefined);
    assert.equal(build.gameThread, undefined);
    assert.equal(derived.featureVerdicts.partyObservation.status, "not-requested");
    assert.equal(
      derived.featureVerdicts.skillCooldownObservation.status,
      "proved",
    );

    const withoutSkillbar = { ...build };
    delete withoutSkillbar.playerSkillbarObservation;
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: withoutSkillbar,
      featureVerdicts: localFeatureVerdictsForBuild(
        TEMPLATE.outputSha256,
        COOLDOWN,
        withoutSkillbar,
      ),
    }, TEMPLATE.sha256, COOLDOWN), false);

    const orphanSkillbar = { ...build };
    delete orphanSkillbar.playRegionObservation;
    delete orphanSkillbar.observationBase;
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: orphanSkillbar,
      featureVerdicts: localFeatureVerdictsForBuild(
        TEMPLATE.outputSha256,
        COOLDOWN,
        orphanSkillbar,
      ),
    }, TEMPLATE.sha256, COOLDOWN), false);
  });

  it("accepts a template-only proof and requires no enhancement behind failure", () => {
    const templateOnly: LocalClientVerification = {
      status: "enhancement-refused",
      fileVerdict: PROVED_FILE,
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
      isLocalClientVerification(templateOnly, TEMPLATE.sha256, ALL),
      true,
    );
    assert.equal(isLocalClientVerification({
      ...templateOnly,
      templateSaveBuild: null,
      enhancementBuild: ENHANCEMENT,
    }, TEMPLATE.sha256, ALL), false);
  });

  it("accepts independent feature proof directly against official bytes", () => {
    const officialBuild: KnownEnhancementBuild = {
      ...valid().enhancementBuild,
      sha256: TEMPLATE.sha256,
    };
    const independent: LocalClientVerification = {
      status: "proved",
      fileVerdict: REFUSED_FILE,
      officialSha256: TEMPLATE.sha256,
      verifierAbi: SEMANTIC_VERIFIER_ABI,
      templateSaveBuild: null,
      enhancementBuild: officialBuild,
      featureVerdicts: localFeatureVerdictsForBuild(
        TEMPLATE.sha256,
        ALL,
        officialBuild,
      ),
      reasons: [],
    };
    assert.equal(
      isLocalClientVerification(independent, TEMPLATE.sha256, ALL),
      true,
    );
  });

  it("represents an unrequested enhancement as a proved template, not a refusal", () => {
    const templateOnly: LocalClientVerification = {
      status: "template-proved",
      fileVerdict: PROVED_FILE,
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
      fileVerdict: {
        ...proof.fileVerdict,
        inputSha256: ENHANCEMENT.sha256,
      },
    }, TEMPLATE.sha256), false);
    assert.equal(isLocalClientVerification({
      ...proof,
      fileVerdict: null,
    }, TEMPLATE.sha256), false);
    assert.equal(isLocalClientVerification({
      ...proof,
      templateSaveBuild: null,
      fileVerdict: PROVED_FILE,
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
      fileVerdict: PROVED_FILE,
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
    assert.equal(isLocalClientVerification(received, TEMPLATE.sha256, ALL), true);

    const invalidCandidates = structuredClone(refusal) as unknown as {
      featureVerdicts: { nativeCursor: { candidates: number } };
    };
    invalidCandidates.featureVerdicts.nativeCursor.candidates = 1;
    assert.equal(
      isLocalClientVerification(invalidCandidates, TEMPLATE.sha256, ALL),
      false,
    );

    const invalidInvariant = structuredClone(refusal) as unknown as {
      featureVerdicts: { nativeCursor: { invariant: string } };
    };
    invalidInvariant.featureVerdicts.nativeCursor.invariant =
      "nativeCursor-structure-changed";
    assert.equal(
      isLocalClientVerification(invalidInvariant, TEMPLATE.sha256, ALL),
      false,
    );
  });
});
