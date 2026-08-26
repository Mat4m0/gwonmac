/**
 * Feature-local authority for the player skill recharge timestamp and the
 * precise Guild Wars clock used to interpret it. The proof starts from the
 * already-certified skill-bar row layout, then requires one exact reader whose
 * control flow performs the bounded timestamp-minus-clock calculation.
 */
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import type { EnhancementProofContext } from "./wasm-evidence.js";
import {
  functionBody,
  functionBodySha256,
  semanticRole,
  soleValue,
  staticCStringHash,
  uniqueRoleFunction,
  unsignedOperand,
  valuesForRole,
} from "./wasm-evidence.js";

const RECHARGE_READER = semanticRole(
  231,
  "0d1d3dc72e383468c5c49fc0ea14529ad523d7bf24f34cb21a32784b4d9430bb",
  Object.freeze([
    { start: 142, end: 147, role: "cooldown.assertion", addressClass: "immutable-data" },
    { start: 148, end: 153, role: "cooldown.assertion-file", addressClass: "immutable-data" },
  ]),
  ["i32", "i32", "i32"],
  ["i32"],
);

const PRECISE_SKILL_TIMER = semanticRole(
  80,
  "a49cb6544ffdc9bf626bf6f4f1dad626852dede0cd087c3ff1226a5d866de71a",
  Object.freeze([
    { start: 9, end: 14, role: "timer.context", addressClass: "mutable-static" },
    { start: 45, end: 50, role: "timer.assertion", addressClass: "immutable-data" },
    { start: 51, end: 56, role: "timer.assertion-file", addressClass: "immutable-data" },
  ]),
  [],
  ["i32"],
);

const IMMUTABLE = Object.freeze({
  cooldownAssertion: "43b0c3cc7619a25aaf50ca476b64916d081827bc316ca96d27c7db5cf285f4ea",
  cooldownFile: "1d36d5bd2d905fd9a1baef7c625097a144e3ba04829a3a2697c5afcc9e4f4d2b",
  timerAssertion: "c2bc7e2637a66b51bea94f999684e1b46e761392be29e043d8bd22443ef63d9f",
  timerFile: "833c5f12881e6f85795a8fd965b7a9310708f1a5b3a7882071aef739e15071c0",
});

const READER_OPERANDS = Object.freeze({
  rowStrides: Object.freeze([18, 51, 109] as const),
  slotBound: 137,
  slotStride: 172,
  rechargeOffsets: Object.freeze([179, 211] as const),
  timerCall: 200,
});

export type SkillCooldownObservationProof = NonNullable<
  KnownEnhancementBuild["skillCooldownObservation"]
>;

export function deriveSkillCooldownObservation(
  context: EnhancementProofContext,
  playerSkillbar: KnownEnhancementBuild["playerSkillbarObservation"] | null | undefined,
): SkillCooldownObservationProof | null {
  if (!playerSkillbar) return null;
  const module = context.moduleView();
  const skillbar = playerSkillbar.coreLayout;
  const reader = uniqueRoleFunction(module, RECHARGE_READER);
  const timer = uniqueRoleFunction(module, PRECISE_SKILL_TIMER);
  if (reader === null || timer === null) return null;

  const body = functionBody(module, reader);
  const readerValues = valuesForRole(body, RECHARGE_READER);
  const timerValues = valuesForRole(functionBody(module, timer), PRECISE_SKILL_TIMER);
  const totalRechargeOffset = unsignedOperand(
    body,
    READER_OPERANDS.rechargeOffsets[0],
  );
  const rechargeOffset = totalRechargeOffset - skillbar.skillbarSkills;
  if (
    READER_OPERANDS.rowStrides.some(
      (at) => unsignedOperand(body, at) !== skillbar.skillbarStride,
    )
    || unsignedOperand(body, READER_OPERANDS.slotBound) !== 8
    || unsignedOperand(body, READER_OPERANDS.slotStride) !== skillbar.skillSlotStride
    || READER_OPERANDS.rechargeOffsets.some(
      (at) => unsignedOperand(body, at) !== totalRechargeOffset,
    )
    || unsignedOperand(body, READER_OPERANDS.timerCall) !== timer
    || rechargeOffset < 0
    || rechargeOffset + 4 > skillbar.skillSlotStride
    || staticCStringHash(module, soleValue(readerValues, "cooldown.assertion"))
      !== IMMUTABLE.cooldownAssertion
    || staticCStringHash(module, soleValue(readerValues, "cooldown.assertion-file"))
      !== IMMUTABLE.cooldownFile
    || staticCStringHash(module, soleValue(timerValues, "timer.assertion"))
      !== IMMUTABLE.timerAssertion
    || staticCStringHash(module, soleValue(timerValues, "timer.assertion-file"))
      !== IMMUTABLE.timerFile
  ) return null;

  return Object.freeze({
    reader: Object.freeze({
      functionIndex: reader,
      params: Object.freeze(["i32", "i32", "i32"] as const),
      results: Object.freeze(["i32"] as const),
      bodySha256: functionBodySha256(module, reader),
      timerCallOperand: READER_OPERANDS.timerCall,
    }),
    timer: Object.freeze({
      functionIndex: timer,
      params: Object.freeze([] as const),
      results: Object.freeze(["i32"] as const),
      bodySha256: functionBodySha256(module, timer),
    }),
    layout: Object.freeze({ skillSlotRecharge: rechargeOffset }),
  });
}
