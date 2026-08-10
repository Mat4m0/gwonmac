/**
 * WebAssembly bodies for the development-only team-command differential trace.
 *
 * The production transform owns when these bodies exist. This module owns only
 * their byte encoding: preserve the certified builders and sender exactly while
 * copying their bounded scalar evidence into caller-owned globals.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";

export const PROFESSION_TRACE_WORDS = 30;

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
}>;

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
    ...Array.from({ length: 11 }, (_, index) => concat(
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
  const fields = [
    null,
    globals.builderCount,
    globals.builderOrigin,
    globals.builderTarget,
    globals.builderProfession,
    globals.skillBuilderCount,
    globals.skillBuilderOrigin,
    globals.skillBuilderTarget,
    globals.skillBuilderSkillCount,
    globals.senderCount,
    globals.senderOrigin,
    globals.senderConnection,
    globals.senderState,
    globals.senderTransport,
    globals.senderCursorBefore,
    globals.senderCursorAfter,
    globals.senderFlagBefore,
    globals.senderFlagAfter,
    globals.senderSize,
    ...Array.from({ length: 11 }, (_, index) => globals.senderPayload + index),
  ] as const;
  return concat(
    uleb(0),
    ...fields.map((globalIndex, index) => concat(
      Uint8Array.of(0x20), uleb(0),
      globalIndex === null
        ? concat(Uint8Array.of(0x41), sleb(1))
        : concat(Uint8Array.of(0x23), uleb(globalIndex)),
      Uint8Array.of(0x36), uleb(2), uleb(index * 4),
    )),
    Uint8Array.of(0x41), sleb(PROFESSION_TRACE_WORDS),
    Uint8Array.of(0x0b),
  );
}
