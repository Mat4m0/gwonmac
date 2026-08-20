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

const TRACE_WORDS = 32;
export const PROFESSION_COMMAND_TRACE_BYTES =
  TRACE_WORDS * Uint32Array.BYTES_PER_ELEMENT;

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
    schema: 1,
    entries: Object.freeze([]),
  }));

  return Object.freeze({
    poll(state: ToolboxObservation) {
      if (disposed) return;
      const written = read(pointer);
      if (written !== TRACE_WORDS) {
        throw new Error(`team command trace wrote ${written} words`);
      }
      const words = new Uint32Array(memory.buffer, pointer, TRACE_WORDS);
      const schema = words[0]!;
      const professionBuilderCount = words[1]!;
      const professionBuilderOrigin = words[2]!;
      const professionBuilderTarget = words[3]!;
      const builderProfession = words[4]!;
      const skillBuilderCount = words[5]!;
      const skillBuilderOrigin = words[6]!;
      const skillBuilderTarget = words[7]!;
      const skillBuilderSkillCount = words[8]!;
      const senderCount = words[9]!;
      const senderOrigin = words[10]!;
      const senderConnection = words[11]!;
      const senderState = words[12]!;
      const senderTransport = words[13]!;
      const senderCursorBefore = words[14]!;
      const senderCursorAfter = words[15]!;
      const senderFlagBefore = words[16]!;
      const senderFlagAfter = words[17]!;
      const senderSize = words[18]!;
      const senderPayload = [...words.slice(19, 30)].slice(
        0,
        Math.min(11, Math.floor(senderSize / 4)),
      );
      const drainCount = words[30]!;
      const drainOpcode = words[31]!;
      const professionChanged = professionBuilderCount !== lastProfessionBuilderCount;
      const skillChanged = skillBuilderCount !== lastSkillBuilderCount;
      const senderChanged = senderCount !== lastSenderCount;
      const drainChanged = drainCount !== lastDrainCount;
      if (
        schema !== 1
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
        schema: 1,
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
