/**
 * Defines the development-only Team Apply trace ABI.
 * Keeps Wasm writers and renderer readers on one named layout.
 */
export const PROFESSION_TRACE_SCHEMA = 2;

export const PROFESSION_TRACE_WORD = Object.freeze({
  schema: 0,
  builderCount: 1,
  builderOrigin: 2,
  builderTarget: 3,
  builderProfession: 4,
  skillBuilderCount: 5,
  skillBuilderOrigin: 6,
  skillBuilderTarget: 7,
  skillBuilderSkillCount: 8,
  senderCount: 9,
  senderOrigin: 10,
  senderConnection: 11,
  senderState: 12,
  senderTransport: 13,
  senderCursorBefore: 14,
  senderCursorAfter: 15,
  senderFlagBefore: 16,
  senderFlagAfter: 17,
  senderSize: 18,
  senderPayload: 19,
  drainCount: 30,
  drainOpcode: 31,
} as const);

export const PROFESSION_TRACE_PAYLOAD_WORDS = 11;
export const PROFESSION_TRACE_WORDS = PROFESSION_TRACE_WORD.drainOpcode + 1;

export type ProfessionTraceScalar = Exclude<
  keyof typeof PROFESSION_TRACE_WORD,
  "schema" | "senderPayload"
>;
