/**
 * WebAssembly bodies for the development-only team-command differential trace.
 *
 * The production transform owns when these bodies exist. This module owns only
 * their byte encoding: preserve the certified builders and sender exactly while
 * copying their bounded scalar evidence into caller-owned globals.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";
import {
  PROFESSION_TRACE_PAYLOAD_WORDS,
  PROFESSION_TRACE_SCHEMA,
  PROFESSION_TRACE_WORD,
  PROFESSION_TRACE_WORDS,
  type ProfessionTraceScalar,
} from "../../shared/profession-command-trace.js";

export { PROFESSION_TRACE_WORDS } from "../../shared/profession-command-trace.js";

export type ProfessionTraceGlobals = Readonly<{
  origin: number;
  builderCount: number;
  builderOrigin: number;
  builderTarget: number;
  builderProfession: number;
  skillBuilderCount: number;
  skillBuilderOrigin: number;
  skillBuilderTarget: number;
  skillBuilderSkillCount: number;
  senderCount: number;
  senderOrigin: number;
  senderConnection: number;
  senderState: number;
  senderTransport: number;
  senderCursorBefore: number;
  senderCursorAfter: number;
  senderFlagBefore: number;
  senderFlagAfter: number;
  senderSize: number;
  senderPayload: number;
  drainCount: number;
  drainOpcode: number;
}>;

/** Derives every trace global from the shared word layout and one allocated base. */
export function professionTraceGlobals(base: number): ProfessionTraceGlobals {
  return Object.freeze({
    origin: base + PROFESSION_TRACE_WORD.schema,
    builderCount: base + PROFESSION_TRACE_WORD.builderCount,
    builderOrigin: base + PROFESSION_TRACE_WORD.builderOrigin,
    builderTarget: base + PROFESSION_TRACE_WORD.builderTarget,
    builderProfession: base + PROFESSION_TRACE_WORD.builderProfession,
    skillBuilderCount: base + PROFESSION_TRACE_WORD.skillBuilderCount,
    skillBuilderOrigin: base + PROFESSION_TRACE_WORD.skillBuilderOrigin,
    skillBuilderTarget: base + PROFESSION_TRACE_WORD.skillBuilderTarget,
    skillBuilderSkillCount: base + PROFESSION_TRACE_WORD.skillBuilderSkillCount,
    senderCount: base + PROFESSION_TRACE_WORD.senderCount,
    senderOrigin: base + PROFESSION_TRACE_WORD.senderOrigin,
    senderConnection: base + PROFESSION_TRACE_WORD.senderConnection,
    senderState: base + PROFESSION_TRACE_WORD.senderState,
    senderTransport: base + PROFESSION_TRACE_WORD.senderTransport,
    senderCursorBefore: base + PROFESSION_TRACE_WORD.senderCursorBefore,
    senderCursorAfter: base + PROFESSION_TRACE_WORD.senderCursorAfter,
    senderFlagBefore: base + PROFESSION_TRACE_WORD.senderFlagBefore,
    senderFlagAfter: base + PROFESSION_TRACE_WORD.senderFlagAfter,
    senderSize: base + PROFESSION_TRACE_WORD.senderSize,
    senderPayload: base + PROFESSION_TRACE_WORD.senderPayload,
    drainCount: base + PROFESSION_TRACE_WORD.drainCount,
    drainOpcode: base + PROFESSION_TRACE_WORD.drainOpcode,
  });
}

/** Records both raw arguments before preserving the exact profession builder. */
export function tracedProfessionBuilder(
  originalIndex: number,
  globals: ProfessionTraceGlobals,
): Uint8Array {
  return concat(
    uleb(0),
    Uint8Array.of(0x23), uleb(globals.builderCount),
    Uint8Array.of(0x41), sleb(1),
    Uint8Array.of(0x6a, 0x24), uleb(globals.builderCount),
    Uint8Array.of(0x23), uleb(globals.origin),
    Uint8Array.of(0x24), uleb(globals.builderOrigin),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x24), uleb(globals.builderTarget),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x24), uleb(globals.builderProfession),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x10), uleb(originalIndex),
    Uint8Array.of(0x0b),
  );
}

/** Records the skill builder's scalar inputs, then preserves its exact body. */
export function tracedSkillBuilder(
  originalIndex: number,
  globals: ProfessionTraceGlobals,
): Uint8Array {
  return concat(
    uleb(0),
    Uint8Array.of(0x23), uleb(globals.skillBuilderCount),
    Uint8Array.of(0x41), sleb(1),
    Uint8Array.of(0x6a, 0x24), uleb(globals.skillBuilderCount),
    Uint8Array.of(0x23), uleb(globals.origin),
    Uint8Array.of(0x24), uleb(globals.skillBuilderOrigin),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x24), uleb(globals.skillBuilderTarget),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x24), uleb(globals.skillBuilderSkillCount),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x20), uleb(2),
    Uint8Array.of(0x10), uleb(originalIndex),
    Uint8Array.of(0x0b),
  );
}

/** Records the sender context and reviewed packet payloads, then preserves it. */
export function tracedPacketSender(
  originalIndex: number,
  globals: ProfessionTraceGlobals,
): Uint8Array {
  const load = (offset: number) => concat(
    Uint8Array.of(0x20), uleb(2),
    Uint8Array.of(0x28), uleb(2), uleb(offset),
  );
  const record = (words: number) => concat(
    Uint8Array.of(0x23), uleb(globals.senderCount),
    Uint8Array.of(0x41), sleb(1),
    Uint8Array.of(0x6a, 0x24), uleb(globals.senderCount),
    Uint8Array.of(0x23), uleb(globals.origin),
    Uint8Array.of(0x24), uleb(globals.senderOrigin),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x24), uleb(globals.senderConnection),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x28), uleb(2), uleb(96),
    Uint8Array.of(0x24), uleb(globals.senderState),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x28), uleb(2), uleb(56),
    Uint8Array.of(0x24), uleb(globals.senderTransport),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x28), uleb(2), uleb(64),
    Uint8Array.of(0x24), uleb(globals.senderCursorBefore),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x28), uleb(2), uleb(84),
    Uint8Array.of(0x24), uleb(globals.senderFlagBefore),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x24), uleb(globals.senderSize),
    ...Array.from({ length: PROFESSION_TRACE_PAYLOAD_WORDS }, (_, index) => concat(
      index < words ? load(index * 4) : concat(Uint8Array.of(0x41), sleb(0)),
      Uint8Array.of(0x24), uleb(globals.senderPayload + index),
    )),
    Uint8Array.of(0x41), sleb(1),
    Uint8Array.of(0x21), uleb(3),
  );
  return concat(
    uleb(1), uleb(1), Uint8Array.of(0x7f),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x41), sleb(8),
    Uint8Array.of(0x4f, 0x04, 0x40),
    load(0),
    Uint8Array.of(0x41), sleb(31),
    Uint8Array.of(0x46, 0x04, 0x40),
    record(2),
    Uint8Array.of(0x0b, 0x0b),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x41), sleb(12),
    Uint8Array.of(0x4f, 0x04, 0x40),
    load(0),
    Uint8Array.of(0x41), sleb(65),
    Uint8Array.of(0x46, 0x04, 0x40),
    record(3),
    Uint8Array.of(0x0b, 0x0b),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x41), sleb(44),
    Uint8Array.of(0x4f, 0x04, 0x40),
    load(0),
    Uint8Array.of(0x41), sleb(93),
    Uint8Array.of(0x46, 0x04, 0x40),
    record(11),
    Uint8Array.of(0x0b, 0x0b),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x20), uleb(2),
    Uint8Array.of(0x10), uleb(originalIndex),
    Uint8Array.of(0x20), uleb(3),
    Uint8Array.of(0x04, 0x40),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x28), uleb(2), uleb(64),
    Uint8Array.of(0x24), uleb(globals.senderCursorAfter),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x28), uleb(2), uleb(84),
    Uint8Array.of(0x24), uleb(globals.senderFlagAfter),
    Uint8Array.of(0x0b),
    Uint8Array.of(0x0b),
  );
}

/** Writes one consistent trace snapshot into caller-owned scratch memory. */
export function professionTraceReader(globals: ProfessionTraceGlobals): Uint8Array {
  const fields = Array<number | null>(PROFESSION_TRACE_WORDS).fill(null);
  for (const [name, offset] of Object.entries(PROFESSION_TRACE_WORD)) {
    if (name === "schema" || name === "senderPayload") continue;
    fields[offset] = globals[name as ProfessionTraceScalar];
  }
  for (let index = 0; index < PROFESSION_TRACE_PAYLOAD_WORDS; index += 1) {
    fields[PROFESSION_TRACE_WORD.senderPayload + index] = globals.senderPayload + index;
  }
  if (fields.some((globalIndex, index) =>
    index !== PROFESSION_TRACE_WORD.schema && globalIndex === null
  )) {
    throw new Error("profession trace layout is incomplete");
  }
  return concat(
    uleb(0),
    ...fields.map((globalIndex, index) => concat(
      Uint8Array.of(0x20), uleb(0),
      index === PROFESSION_TRACE_WORD.schema
        ? concat(Uint8Array.of(0x41), sleb(PROFESSION_TRACE_SCHEMA))
        : concat(Uint8Array.of(0x23), uleb(globalIndex!)),
      Uint8Array.of(0x36), uleb(2), uleb(index * 4),
    )),
    Uint8Array.of(0x41), sleb(PROFESSION_TRACE_WORDS),
    Uint8Array.of(0x0b),
  );
}
