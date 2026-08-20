/**
 * Development-only differential trace for hero profession and skill commands.
 *
 * The transformed client records only the scalar builder arguments, sender
 * connection and exact opcode-31/opcode-65/opcode-93 payloads. This renderer owner adds
 * the party fact visible at the same observer publication, keeps a bounded
 * local history, and makes it easy for a tester to paste one JSON value.
 * Nothing is persisted or diagnosed.
 */
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import {
  PROFESSION_TRACE_PAYLOAD_WORDS,
  PROFESSION_TRACE_SCHEMA,
  PROFESSION_TRACE_WORD,
  PROFESSION_TRACE_WORDS,
} from "../shared/profession-command-trace.js";

export const PROFESSION_COMMAND_TRACE_BYTES =
  PROFESSION_TRACE_WORDS * Uint32Array.BYTES_PER_ELEMENT;

export type ProfessionCommandTraceReader = (pointer: number) => number;

export function createProfessionCommandTrace(
  memory: WebAssembly.Memory,
  pointer: number,
  read: ProfessionCommandTraceReader,
) {
  const entries: unknown[] = [];
  let sequence = 0;
  let lastProfessionBuilderCount = 0;
  let lastSkillBuilderCount = 0;
  let lastSenderCount = 0;
  let lastDrainCount = 0;
  let disposed = false;

  Reflect.set(window, "gwProfessionCommandTrace", Object.freeze({
    schema: PROFESSION_TRACE_SCHEMA,
    entries: Object.freeze([]),
  }));

  return Object.freeze({
    poll(state: ToolboxObservation) {
      if (disposed) return;
      const written = read(pointer);
      if (written !== PROFESSION_TRACE_WORDS) {
        throw new Error(`team command trace wrote ${written} words`);
      }
      const words = new Uint32Array(memory.buffer, pointer, PROFESSION_TRACE_WORDS);
      const at = (name: keyof typeof PROFESSION_TRACE_WORD) =>
        words[PROFESSION_TRACE_WORD[name]]!;
      const schema = at("schema");
      const professionBuilderCount = at("builderCount");
      const professionBuilderOrigin = at("builderOrigin");
      const professionBuilderTarget = at("builderTarget");
      const builderProfession = at("builderProfession");
      const skillBuilderCount = at("skillBuilderCount");
      const skillBuilderOrigin = at("skillBuilderOrigin");
      const skillBuilderTarget = at("skillBuilderTarget");
      const skillBuilderSkillCount = at("skillBuilderSkillCount");
      const senderCount = at("senderCount");
      const senderOrigin = at("senderOrigin");
      const senderConnection = at("senderConnection");
      const senderState = at("senderState");
      const senderTransport = at("senderTransport");
      const senderCursorBefore = at("senderCursorBefore");
      const senderCursorAfter = at("senderCursorAfter");
      const senderFlagBefore = at("senderFlagBefore");
      const senderFlagAfter = at("senderFlagAfter");
      const senderSize = at("senderSize");
      const senderPayload = [...words.slice(
        PROFESSION_TRACE_WORD.senderPayload,
        PROFESSION_TRACE_WORD.senderPayload + PROFESSION_TRACE_PAYLOAD_WORDS,
      )].slice(
        0,
        Math.min(PROFESSION_TRACE_PAYLOAD_WORDS, Math.floor(senderSize / 4)),
      );
      const drainCount = at("drainCount");
      const drainOpcode = at("drainOpcode");
      const professionChanged = professionBuilderCount !== lastProfessionBuilderCount;
      const skillChanged = skillBuilderCount !== lastSkillBuilderCount;
      const senderChanged = senderCount !== lastSenderCount;
      const drainChanged = drainCount !== lastDrainCount;
      if (
        schema !== PROFESSION_TRACE_SCHEMA
        || (!professionChanged && !skillChanged && !senderChanged && !drainChanged)
      ) return;
      lastProfessionBuilderCount = professionBuilderCount;
      lastSkillBuilderCount = skillBuilderCount;
      lastSenderCount = senderCount;
      lastDrainCount = drainCount;
      const observedTarget = skillChanged
        ? skillBuilderTarget
        : professionChanged
          ? professionBuilderTarget
          : senderChanged
            ? (senderPayload[1] ?? 0)
            : null;
      const target = observedTarget === null ? undefined : state.party?.slots?.find(
        (slot) => slot.occupied && slot.agentId === observedTarget,
      );
      const entry = Object.freeze({
        sequence: ++sequence,
        changed: Object.freeze({
          professionBuilder: professionChanged,
          skillBuilder: skillChanged,
          sender: senderChanged,
          drain: drainChanged,
        }),
        drain: Object.freeze({ count: drainCount, opcode: drainOpcode }),
        professionBuilder: Object.freeze({
          count: professionBuilderCount,
          origin: professionBuilderOrigin === 1 ? "gwonmac" : "native",
          target: professionBuilderTarget,
          profession: builderProfession,
        }),
        skillBuilder: Object.freeze({
          count: skillBuilderCount,
          origin: skillBuilderOrigin === 1 ? "gwonmac" : "native",
          target: skillBuilderTarget,
          skillCount: skillBuilderSkillCount,
        }),
        sender: Object.freeze({
          count: senderCount,
          origin: senderOrigin === 1 ? "gwonmac" : "native",
          connection: senderConnection,
          state: senderState,
          transport: senderTransport,
          cursorBefore: senderCursorBefore,
          cursorAfter: senderCursorAfter,
          flagBefore: senderFlagBefore,
          flagAfter: senderFlagAfter,
          size: senderSize,
          payload: Object.freeze(senderPayload),
        }),
        observed: target
          ? Object.freeze({
              heroId: target.hero,
              agentId: target.agentId,
              professions: target.professions,
            })
          : null,
      });
      entries.push(entry);
      if (entries.length > 24) entries.shift();
      Reflect.set(window, "gwProfessionCommandTrace", Object.freeze({
        schema: PROFESSION_TRACE_SCHEMA,
        entries: Object.freeze([...entries]),
      }));
      console.info(`[tools:dev] team command trace ${JSON.stringify(entry)}`);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      Reflect.deleteProperty(window, "gwProfessionCommandTrace");
    },
  });
}
