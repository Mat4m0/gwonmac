/**
 * Feature-local authority for the player skill recharge timestamp and the
 * precise Guild Wars clock used to interpret it. The proof starts from the
 * already-certified skill-bar row layout, then requires one exact reader whose
 * control flow performs the bounded timestamp-minus-clock calculation.
 */
import type { EnhancementPartyLayout } from "../../shared/enhancement-config.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import type { EnhancementProofContext } from "./enhancement-wasm-proof-context.js";
import {
  functionBody,
  uniqueExactFunction,
  unsignedOperand,
} from "./enhancement-wasm-proof-context.js";

const RECHARGE_READER = Object.freeze({
  bodySha256: "de894c4032f9c9cf7a50a8f36ad1174446ead7246bf9ae830f43d8e45eb0d697",
  params: Object.freeze(["i32", "i32", "i32"] as const),
  results: Object.freeze(["i32"] as const),
});

const PRECISE_SKILL_TIMER = Object.freeze({
  bodySha256: "f2b448b590efb575ca868617b0a41d544971b29ecec04a69247f3a2f7210e773",
  params: Object.freeze([] as const),
  results: Object.freeze(["i32"] as const),
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
  party: EnhancementPartyLayout | null | undefined,
): SkillCooldownObservationProof | null {
  if (!party) return null;
  const reader = uniqueExactFunction(
    context.module,
    RECHARGE_READER.bodySha256,
    RECHARGE_READER.params,
    RECHARGE_READER.results,
  );
  const timer = uniqueExactFunction(
    context.module,
    PRECISE_SKILL_TIMER.bodySha256,
    PRECISE_SKILL_TIMER.params,
    PRECISE_SKILL_TIMER.results,
  );
  if (reader === null || timer === null) return null;

  const body = functionBody(context.module, reader);
  const totalRechargeOffset = unsignedOperand(
    body,
    READER_OPERANDS.rechargeOffsets[0],
  );
  const rechargeOffset = totalRechargeOffset - party.skillbarSkills;
  if (
    READER_OPERANDS.rowStrides.some(
      (at) => unsignedOperand(body, at) !== party.skillbarStride,
    )
    || unsignedOperand(body, READER_OPERANDS.slotBound) !== 8
    || unsignedOperand(body, READER_OPERANDS.slotStride) !== party.skillSlotStride
    || READER_OPERANDS.rechargeOffsets.some(
      (at) => unsignedOperand(body, at) !== totalRechargeOffset,
    )
    || unsignedOperand(body, READER_OPERANDS.timerCall) !== timer
    || rechargeOffset < 0
    || rechargeOffset + 4 > party.skillSlotStride
  ) return null;

  return Object.freeze({
    reader: Object.freeze({
      functionIndex: reader,
      params: RECHARGE_READER.params,
      results: RECHARGE_READER.results,
      bodySha256: RECHARGE_READER.bodySha256,
      timerCallOperand: READER_OPERANDS.timerCall,
    }),
    timer: Object.freeze({
      functionIndex: timer,
      params: PRECISE_SKILL_TIMER.params,
      results: PRECISE_SKILL_TIMER.results,
      bodySha256: PRECISE_SKILL_TIMER.bodySha256,
    }),
    layout: Object.freeze({ skillSlotRecharge: rechargeOffset }),
  });
}
