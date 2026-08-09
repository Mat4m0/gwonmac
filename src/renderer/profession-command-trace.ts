/**
 * Development-only differential trace for the hero profession command.
 *
 * The transformed client records only the fixed opcode-65 builder arguments
 * and sender payload. This renderer owner adds the party fact visible at the
 * same observer publication, keeps a bounded local history, and makes it easy
 * for a tester to paste one JSON value. Nothing is persisted or diagnosed.
 */
import type { ToolboxObservation } from "../shared/builds/live-party.js";

const TRACE_WORDS = 11;
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
  let lastBuilderCount = 0;
  let lastSenderCount = 0;
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
        throw new Error(`profession trace wrote ${written} words`);
      }
      const words = new Uint32Array(memory.buffer, pointer, TRACE_WORDS);
      const schema = words[0]!;
      const builderCount = words[1]!;
      const builderOrigin = words[2]!;
      const builderTarget = words[3]!;
      const builderProfession = words[4]!;
      const senderCount = words[5]!;
      const senderOrigin = words[6]!;
      const senderSize = words[7]!;
      const senderOpcode = words[8]!;
      const senderTarget = words[9]!;
      const senderProfession = words[10]!;
      if (
        schema !== 1
        || (builderCount === lastBuilderCount && senderCount === lastSenderCount)
      ) return;
      lastBuilderCount = builderCount;
      lastSenderCount = senderCount;
      const target = state.party?.slots?.find(
        (slot) => slot.occupied && slot.agentId === builderTarget,
      );
      const entry = Object.freeze({
        sequence: ++sequence,
        builder: Object.freeze({
          count: builderCount,
          origin: builderOrigin === 1 ? "gwonmac" : "native",
          target: builderTarget,
          profession: builderProfession,
        }),
        sender: Object.freeze({
          count: senderCount,
          origin: senderOrigin === 1 ? "gwonmac" : "native",
          size: senderSize,
          opcode: senderOpcode,
          target: senderTarget,
          profession: senderProfession,
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
      console.info(`[tools:dev] profession trace ${JSON.stringify(entry)}`);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      Reflect.deleteProperty(window, "gwProfessionCommandTrace");
    },
  });
}
