/**
 * One bounded, anchor-independent instruction pass for shared WASM evidence.
 * Feature-specific constants are projected without rescanning function bodies.
 */
import { readUleb } from "../core/wasm-binary.js";
import type {
  DecodedFunction,
  DirectCallSite,
  InstructionOperandSite,
  MemoryOperandSite,
  ModuleShape,
} from "./enhancement-evidence-types.js";
import { EvidenceError } from "./wasm-evidence-error.js";
import { readonlyMapView } from "./readonly-map-view.js";

const MAX_TYPES = 100_000;
const MAX_FUNCTIONS = 100_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_INSTRUCTIONS = 25_000_000;
const MAX_CALL_SITES = 250_000;
const MAX_OPERAND_SITES = 2_000_000;

type RawDecodedFunction = Readonly<{
  functionIndex: number;
  calls: ReadonlyMap<number, number>;
  callSites: ReadonlyMap<number, readonly DirectCallSite[]>;
  constants: Int32Array;
  constantSites: readonly InstructionOperandSite[];
  memorySites: readonly MemoryOperandSite[];
}>;

const decodedCache = new WeakMap<ModuleShape, readonly RawDecodedFunction[]>();

function unsigned(bytes: Uint8Array, cursor: { offset: number }): number {
  try {
    return readUleb(bytes, cursor);
  } catch {
    throw new EvidenceError("instruction-set-unsupported");
  }
}

function signed(bytes: Uint8Array, cursor: { offset: number }, maxBytes: number): number {
  let result = 0;
  let shift = 0;
  for (let count = 0; count < maxBytes; count += 1) {
    if (cursor.offset >= bytes.byteLength) {
      throw new EvidenceError("instruction-set-unsupported");
    }
    const byte = bytes[cursor.offset++]!;
    result += (byte & 0x7f) * (2 ** shift);
    shift += 7;
    if ((byte & 0x80) === 0) {
      if ((byte & 0x40) !== 0) result -= 2 ** shift;
      return result;
    }
  }
  throw new EvidenceError("instruction-set-unsupported");
}

function canonicalDecode(module: ModuleShape): readonly RawDecodedFunction[] {
  const cached = decodedCache.get(module);
  if (cached) return cached;
  let instructionCount = 0;
  let callSiteCount = 0;
  let operandSiteCount = 0;
  const decoded: RawDecodedFunction[] = [];
  for (let localIndex = 0; localIndex < module.bodies.length; localIndex += 1) {
    const body = module.bodies[localIndex]!;
    if (body.byteLength > MAX_BODY_BYTES) {
      throw new EvidenceError("analysis-limit-exceeded");
    }
    const cursor = { offset: 0 };
    const localGroups = unsigned(body, cursor);
    if (localGroups > MAX_FUNCTIONS) throw new EvidenceError("analysis-limit-exceeded");
    for (let group = 0; group < localGroups; group += 1) {
      unsigned(body, cursor);
      if (cursor.offset >= body.byteLength) {
        throw new EvidenceError("instruction-set-unsupported");
      }
      cursor.offset += 1;
    }
    const calls = new Map<number, number>();
    const mutableCallSites = new Map<number, DirectCallSite[]>();
    let constants = new Int32Array(64);
    let constantCount = 0;
    const constantSites: InstructionOperandSite[] = [];
    const memorySites: MemoryOperandSite[] = [];
    while (cursor.offset < body.byteLength) {
      if (++instructionCount > MAX_INSTRUCTIONS) {
        throw new EvidenceError("analysis-limit-exceeded");
      }
      const opcode = body[cursor.offset++]!;
      if (
        opcode === 0x00 || opcode === 0x01 || opcode === 0x05 || opcode === 0x0b
        || opcode === 0x0f || opcode === 0x1a || opcode === 0x1b || opcode === 0xd1
        || (opcode >= 0x45 && opcode <= 0xc4)
      ) continue;
      if (opcode >= 0x02 && opcode <= 0x04) {
        const next = body[cursor.offset];
        if (next === undefined) throw new EvidenceError("instruction-set-unsupported");
        if ([0x40, 0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f].includes(next)) {
          cursor.offset += 1;
        } else signed(body, cursor, 5);
        continue;
      }
      if (opcode === 0x0e) {
        const count = unsigned(body, cursor);
        if (count > MAX_FUNCTIONS) throw new EvidenceError("analysis-limit-exceeded");
        for (let index = 0; index <= count; index += 1) unsigned(body, cursor);
        continue;
      }
      if (opcode === 0x11) {
        unsigned(body, cursor);
        unsigned(body, cursor);
        continue;
      }
      if (opcode === 0x1c) {
        const count = unsigned(body, cursor);
        if (count > MAX_TYPES || cursor.offset + count > body.byteLength) {
          throw new EvidenceError(count > MAX_TYPES
            ? "analysis-limit-exceeded"
            : "instruction-set-unsupported");
        }
        cursor.offset += count;
        continue;
      }
      if (opcode === 0x41) {
        const offset = cursor.offset - 1;
        const operandStart = cursor.offset;
        const value = signed(body, cursor, 5);
        if (++operandSiteCount > MAX_OPERAND_SITES) {
          throw new EvidenceError("analysis-limit-exceeded");
        }
        constantSites.push(Object.freeze({
          opcode,
          offset,
          operandStart,
          operandEnd: cursor.offset,
          value,
        }));
        if (constantCount === constants.length) {
          const grown = new Int32Array(constants.length * 2);
          grown.set(constants);
          constants = grown;
        }
        constants[constantCount++] = value;
        continue;
      }
      if (opcode === 0x42) {
        signed(body, cursor, 10);
        continue;
      }
      if (opcode === 0x43 || opcode === 0x44) {
        const width = opcode === 0x43 ? 4 : 8;
        if (cursor.offset + width > body.byteLength) {
          throw new EvidenceError("instruction-set-unsupported");
        }
        cursor.offset += width;
        continue;
      }
      if (opcode >= 0x28 && opcode <= 0x3e) {
        const offset = cursor.offset - 1;
        const alignment = unsigned(body, cursor);
        const operandStart = cursor.offset;
        const value = unsigned(body, cursor);
        if (++operandSiteCount > MAX_OPERAND_SITES) {
          throw new EvidenceError("analysis-limit-exceeded");
        }
        memorySites.push(Object.freeze({
          opcode,
          offset,
          operandStart,
          operandEnd: cursor.offset,
          value,
          alignment,
        }));
        if ((alignment & 0x40) !== 0) unsigned(body, cursor);
        continue;
      }
      if (opcode === 0x10) {
        if (++callSiteCount > MAX_CALL_SITES) {
          throw new EvidenceError("analysis-limit-exceeded");
        }
        const offset = cursor.offset - 1;
        const target = unsigned(body, cursor);
        calls.set(target, (calls.get(target) ?? 0) + 1);
        const sites = mutableCallSites.get(target) ?? [];
        sites.push(Object.freeze({ offset, operandEnd: cursor.offset }));
        mutableCallSites.set(target, sites);
        continue;
      }
      if (
        opcode === 0x0c || opcode === 0x0d || (opcode >= 0x20 && opcode <= 0x26)
        || opcode === 0x3f || opcode === 0x40 || opcode === 0xd2
      ) {
        unsigned(body, cursor);
        continue;
      }
      if (opcode === 0xd0) {
        signed(body, cursor, 5);
        continue;
      }
      if (opcode === 0xfc) {
        const subopcode = unsigned(body, cursor);
        const immediates = subopcode <= 7 ? 0
          : [8, 10, 12, 14].includes(subopcode) ? 2
          : [9, 11, 13, 15, 16, 17].includes(subopcode) ? 1
          : -1;
        if (immediates < 0) throw new EvidenceError("instruction-set-unsupported");
        for (let index = 0; index < immediates; index += 1) unsigned(body, cursor);
        continue;
      }
      throw new EvidenceError("instruction-set-unsupported");
    }
    const callSites = new Map<number, readonly DirectCallSite[]>();
    for (const [target, sites] of mutableCallSites) {
      callSites.set(target, Object.freeze(sites));
    }
    decoded.push(Object.freeze({
      functionIndex: module.functionImportCount + localIndex,
      calls: readonlyMapView(calls),
      callSites: readonlyMapView(callSites),
      constants: constants.slice(0, constantCount),
      constantSites: Object.freeze(constantSites),
      memorySites: Object.freeze(memorySites),
    }));
  }
  const result = Object.freeze(decoded);
  decodedCache.set(module, result);
  return result;
}

export function decodeFunctions(
  module: ModuleShape,
  trackedConstants: readonly number[],
): DecodedFunction[] {
  const tracked = [...new Set(trackedConstants)];
  const trackedSet = new Set(tracked);
  return canonicalDecode(module).map((raw) => {
    const messageSites: Record<number, number> = {};
    for (const value of raw.constants) {
      if (trackedSet.has(value)) {
        messageSites[value] = (messageSites[value] ?? 0) + 1;
      }
    }
    return Object.freeze({
      functionIndex: raw.functionIndex,
      calls: raw.calls,
      callSites: raw.callSites,
      messageSites: Object.freeze(messageSites),
      constantSites: raw.constantSites,
      memorySites: raw.memorySites,
    });
  });
}
