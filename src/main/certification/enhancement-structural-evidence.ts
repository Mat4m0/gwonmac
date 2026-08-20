/**
 * The structural analysis behind a recertification: what a client module's own
 * shape says about where the Enhancement hooks belong.
 *
 * The broad comparison report is evidence with a status attached, never a
 * conclusion. The separate `locateAutomaticCursor` export is intentionally
 * narrower: it is launch authority only for cursor after all signed semantic
 * fingerprints, signatures, table relations and uniqueness checks match.
 * `candidate` means one location survived all the anchors; `ambiguous` means
 * several did and a human must choose; `unavailable` names the specific reason
 * the analysis could not run. A single best guess is deliberately not offered —
 * silently picking one of two candidates is how a wrong hook gets certified.
 *
 * The analysis is bounded: oversized inputs, unsupported module shapes and
 * exceeded work limits are reported as failures rather than pursued.
 */
import { createHash } from "node:crypto";
import {
  parseCode,
  parseIndexVector,
  parseTypes,
  splitSections,
  valueTypeName,
  type FunctionType,
  type Section,
} from "../core/wasm-binary.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import {
  relocationAwareFingerprint,
  verifyLayout,
  type RelocationSpan,
} from "./semantic-proof.js";
import type { EnhancementCursorLayout } from "../../shared/enhancement-config.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export type EnhancementEvidenceStatus =
  | "candidate"
  | "ambiguous"
  | "unavailable";

export type EnhancementEvidenceFailure =
  | "input-too-large"
  | "invalid-wasm"
  | "module-shape-unsupported"
  | "instruction-set-unsupported"
  | "analysis-limit-exceeded"
  | "active-table-unsupported";

export interface FunctionSignatureEvidence {
  readonly params: string[];
  readonly results: string[];
}

export interface TickEvidenceReport {
  readonly status: EnhancementEvidenceStatus;
  readonly exportCount: number;
  readonly considered: Array<{
    readonly functionIndex: number;
    readonly signature: FunctionSignatureEvidence | null;
  }>;
  readonly candidate: {
    readonly functionIndex: number;
    readonly signature: FunctionSignatureEvidence;
    readonly bodySha256: string;
  } | null;
}

export interface MessageProducerEvidence {
  readonly producerFunctionIndex: number;
  readonly messageSites: number;
  readonly directCallSites: number;
}

export interface PlayerChatUiConsideration {
  readonly dispatcherFunctionIndex: number;
  readonly signature: FunctionSignatureEvidence | null;
  readonly signatureMatches: boolean;
  readonly playerChat: MessageProducerEvidence[];
  readonly nearby7f: MessageProducerEvidence[];
  readonly nearby80: MessageProducerEvidence[];
}

export interface PlayerChatUiEvidenceReport {
  readonly status: EnhancementEvidenceStatus;
  readonly considered: PlayerChatUiConsideration[];
  readonly candidate: {
    readonly dispatcherFunctionIndex: number;
    readonly playerChatProducerFunctionIndex: number;
    readonly nearby7fProducerFunctionIndices: number[];
    readonly nearby80ProducerFunctionIndices: number[];
  } | null;
}

export interface PlayerChatMessageAnchors {
  readonly playerChatMessage: number;
  readonly nearbyPlayerMessages: readonly [number, number];
}

export interface CursorConsideration {
  readonly targetFunctionIndex: number;
  readonly directCallSites: number;
  readonly directProducers: Array<{
    readonly producerFunctionIndex: number;
    readonly directCallSites: number;
  }>;
  readonly activeTableSlots: number[];
}

export interface CursorEvidenceReport {
  readonly status: EnhancementEvidenceStatus;
  readonly considered: CursorConsideration[];
  readonly candidate: {
    readonly targetFunctionIndex: number;
    readonly producerFunctionIndices: [number, number];
    readonly activeTableSlot: number;
    readonly bodySha256: string;
    readonly producerBodySha256: [string, string];
  } | null;
}

/**
 * Review evidence only. A caller may render or persist this report, but it is
 * deliberately not a `KnownEnhancementBuild` and cannot authorize a launch.
 */
export interface EnhancementStructuralEvidenceReport {
  readonly sha256: string;
  readonly validWasm: boolean;
  readonly failures: EnhancementEvidenceFailure[];
  readonly tick: TickEvidenceReport;
  readonly playerChatUi: PlayerChatUiEvidenceReport;
  readonly cursor: CursorEvidenceReport;
}

export interface AutomaticCursorLocation {
  readonly baseline: KnownEnhancementBuild;
  readonly hookFunction: number;
  readonly hookBodySha256: string;
  readonly cursorFunction: number;
  readonly cursorTableSlot: number;
  readonly producerFunctions: readonly [number, number];
  readonly producerBodySha256: readonly [string, string];
  readonly layout: EnhancementCursorLayout;
}

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_TYPES = 100_000;
const MAX_FUNCTIONS = 100_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_INSTRUCTIONS = 25_000_000;
const MAX_CONSIDERED = 4_096;

const I32 = 0x7f;

interface Offset {
  value: number;
}

class EvidenceError extends Error {
  readonly code: EnhancementEvidenceFailure;

  constructor(code: EnhancementEvidenceFailure) {
    super(code);
    this.code = code;
  }
}

interface WasmExport {
  readonly name: string;
  readonly kind: number;
  readonly index: number;
}

interface ModuleShape {
  readonly types: FunctionType[];
  readonly functionTypeIndices: number[];
  readonly functionImportCount: number;
  readonly bodies: Uint8Array[];
  readonly exports: WasmExport[];
  readonly elementSection: Uint8Array | null;
}

interface DecodedFunction {
  readonly functionIndex: number;
  readonly calls: Map<number, number>;
  readonly messageSites: Readonly<Record<number, number>>;
}

function unavailableTick(): TickEvidenceReport {
  return { status: "unavailable", exportCount: 0, considered: [], candidate: null };
}

function unavailableUi(): PlayerChatUiEvidenceReport {
  return { status: "unavailable", considered: [], candidate: null };
}

function unavailableCursor(): CursorEvidenceReport {
  return { status: "unavailable", considered: [], candidate: null };
}

function baseReport(
  sha256: string,
  validWasm: boolean,
  failure: EnhancementEvidenceFailure,
): EnhancementStructuralEvidenceReport {
  return {
    sha256,
    validWasm,
    failures: [failure],
    tick: unavailableTick(),
    playerChatUi: unavailableUi(),
    cursor: unavailableCursor(),
  };
}

function readUnsigned(
  bytes: Uint8Array,
  cursor: Offset,
  maxBytes = 5,
): number {
  let result = 0;
  let shift = 0;
  for (let count = 0; count < maxBytes; count += 1) {
    if (cursor.value >= bytes.byteLength) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const byte = bytes[cursor.value++]!;
    result += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(result) || result > 0xffff_ffff) {
        throw new EvidenceError("module-shape-unsupported");
      }
      return result;
    }
    shift += 7;
  }
  throw new EvidenceError("module-shape-unsupported");
}

function readSigned(
  bytes: Uint8Array,
  cursor: Offset,
  maxBytes: number,
): number {
  let result = 0;
  let shift = 0;
  for (let count = 0; count < maxBytes; count += 1) {
    if (cursor.value >= bytes.byteLength) {
      throw new EvidenceError("instruction-set-unsupported");
    }
    const byte = bytes[cursor.value++]!;
    result += (byte & 0x7f) * (2 ** shift);
    shift += 7;
    if ((byte & 0x80) === 0) {
      if ((byte & 0x40) !== 0) result -= 2 ** shift;
      return result;
    }
  }
  throw new EvidenceError("instruction-set-unsupported");
}

function skipBytes(bytes: Uint8Array, cursor: Offset, count: number): void {
  if (
    !Number.isSafeInteger(count)
    || count < 0
    || cursor.value + count > bytes.byteLength
  ) {
    throw new EvidenceError("module-shape-unsupported");
  }
  cursor.value += count;
}

function skipName(bytes: Uint8Array, cursor: Offset): string {
  const length = readUnsigned(bytes, cursor);
  const start = cursor.value;
  skipBytes(bytes, cursor, length);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(start, cursor.value),
    );
  } catch {
    throw new EvidenceError("module-shape-unsupported");
  }
}

function skipLimits(bytes: Uint8Array, cursor: Offset): void {
  const flags = readUnsigned(bytes, cursor);
  readUnsigned(bytes, cursor);
  if ((flags & 1) !== 0) readUnsigned(bytes, cursor);
}

function parseFunctionImports(bytes: Uint8Array | null): number[] {
  if (!bytes) return [];
  const cursor = { value: 0 };
  const count = readUnsigned(bytes, cursor);
  if (count > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const typeIndices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    skipName(bytes, cursor);
    skipName(bytes, cursor);
    if (cursor.value >= bytes.byteLength) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const kind = bytes[cursor.value++]!;
    if (kind === 0) {
      typeIndices.push(readUnsigned(bytes, cursor));
    } else if (kind === 1) {
      skipBytes(bytes, cursor, 1);
      skipLimits(bytes, cursor);
    } else if (kind === 2) {
      skipLimits(bytes, cursor);
    } else if (kind === 3) {
      skipBytes(bytes, cursor, 2);
    } else {
      throw new EvidenceError("module-shape-unsupported");
    }
  }
  if (cursor.value !== bytes.byteLength) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return typeIndices;
}

function parseExports(bytes: Uint8Array | null): WasmExport[] {
  if (!bytes) return [];
  const cursor = { value: 0 };
  const count = readUnsigned(bytes, cursor);
  if (count > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const result: WasmExport[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = skipName(bytes, cursor);
    if (cursor.value >= bytes.byteLength) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const kind = bytes[cursor.value++]!;
    result.push({ name, kind, index: readUnsigned(bytes, cursor) });
  }
  if (cursor.value !== bytes.byteLength) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return result;
}

function optionalSection(
  sections: readonly Section[],
  id: number,
): Uint8Array | null {
  const matches = sections.filter((section) => section.id === id);
  if (matches.length > 1) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return matches[0]?.body ?? null;
}

function requiredSection(
  sections: readonly Section[],
  id: number,
): Uint8Array {
  return optionalSection(sections, id)
    ?? (() => {
      throw new EvidenceError("module-shape-unsupported");
    })();
}

function parseModule(input: Uint8Array): ModuleShape {
  let sections: Section[];
  try {
    sections = splitSections(input);
  } catch {
    throw new EvidenceError("module-shape-unsupported");
  }
  let types: FunctionType[];
  let definedTypeIndices: number[];
  let bodies: Uint8Array[];
  try {
    types = parseTypes(requiredSection(sections, 1));
    definedTypeIndices = parseIndexVector(requiredSection(sections, 3));
    bodies = parseCode(requiredSection(sections, 10));
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    throw new EvidenceError("module-shape-unsupported");
  }
  if (types.length > MAX_TYPES || bodies.length > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  if (definedTypeIndices.length !== bodies.length) {
    throw new EvidenceError("module-shape-unsupported");
  }
  const importedTypeIndices = parseFunctionImports(optionalSection(sections, 2));
  const functionTypeIndices = [...importedTypeIndices, ...definedTypeIndices];
  if (functionTypeIndices.length > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  for (const typeIndex of functionTypeIndices) {
    if (types[typeIndex] === undefined) {
      throw new EvidenceError("module-shape-unsupported");
    }
  }
  return {
    types,
    functionTypeIndices,
    functionImportCount: importedTypeIndices.length,
    bodies,
    exports: parseExports(optionalSection(sections, 7)),
    elementSection: optionalSection(sections, 9),
  };
}

function exactSignature(
  type: FunctionType | undefined,
  parameterCount: number,
): boolean {
  return Boolean(
    type
    && type.params.length === parameterCount
    && type.params.every((value) => value === I32)
    && type.results.length === 0,
  );
}

function signatureEvidence(
  module: ModuleShape,
  functionIndex: number,
): FunctionSignatureEvidence | null {
  const typeIndex = module.functionTypeIndices[functionIndex];
  const type = typeIndex === undefined ? undefined : module.types[typeIndex];
  return type
    ? {
      params: type.params.map(valueTypeName),
      results: type.results.map(valueTypeName),
    }
    : null;
}

function functionHasSignature(
  module: ModuleShape,
  functionIndex: number,
  parameterCount: number,
): boolean {
  const typeIndex = module.functionTypeIndices[functionIndex];
  return exactSignature(
    typeIndex === undefined ? undefined : module.types[typeIndex],
    parameterCount,
  );
}

function functionBodySha256(module: ModuleShape, functionIndex: number): string {
  const body = module.bodies[functionIndex - module.functionImportCount];
  if (!body) throw new EvidenceError("module-shape-unsupported");
  return createHash("sha256").update(body).digest("hex");
}

function tickEvidence(module: ModuleShape): TickEvidenceReport {
  const exports = module.exports.filter(
    (entry) => entry.name === "EmscriptenExeThreadMainLoop",
  );
  const considered = exports.map((entry) => ({
    functionIndex: entry.index,
    signature: entry.kind === 0
      ? signatureEvidence(module, entry.index)
      : null,
  }));
  const exact = exports.filter(
    (entry) => entry.kind === 0 && functionHasSignature(module, entry.index, 1),
  );
  if (exports.length === 1 && exact.length === 1) {
    const functionIndex = exact[0]!.index;
    return {
      status: "candidate",
      exportCount: 1,
      considered,
      candidate: {
        functionIndex,
        signature: signatureEvidence(module, functionIndex)!,
        bodySha256: functionBodySha256(module, functionIndex),
      },
    };
  }
  return {
    status: exact.length > 1 ? "ambiguous" : "unavailable",
    exportCount: exports.length,
    considered,
    candidate: null,
  };
}

function readInstructionUnsigned(bytes: Uint8Array, cursor: Offset): number {
  try {
    return readUnsigned(bytes, cursor);
  } catch (error) {
    if (
      error instanceof EvidenceError
      && error.code === "module-shape-unsupported"
    ) {
      throw new EvidenceError("instruction-set-unsupported");
    }
    throw error;
  }
}

function decodeFunctions(
  module: ModuleShape,
  messageAnchors: PlayerChatMessageAnchors,
): DecodedFunction[] {
  const trackedMessages = new Set<number>([
    messageAnchors.playerChatMessage,
    ...messageAnchors.nearbyPlayerMessages,
  ]);
  let instructionCount = 0;
  const decoded: DecodedFunction[] = [];
  for (let localIndex = 0; localIndex < module.bodies.length; localIndex += 1) {
    const body = module.bodies[localIndex]!;
    if (body.byteLength > MAX_BODY_BYTES) {
      throw new EvidenceError("analysis-limit-exceeded");
    }
    const cursor = { value: 0 };
    const localGroups = readInstructionUnsigned(body, cursor);
    if (localGroups > MAX_FUNCTIONS) {
      throw new EvidenceError("analysis-limit-exceeded");
    }
    for (let group = 0; group < localGroups; group += 1) {
      readInstructionUnsigned(body, cursor);
      if (cursor.value >= body.byteLength) {
        throw new EvidenceError("instruction-set-unsupported");
      }
      cursor.value += 1;
    }
    const calls = new Map<number, number>();
    const messageSites: Record<number, number> = {};
    for (const message of trackedMessages) messageSites[message] = 0;
    while (cursor.value < body.byteLength) {
      instructionCount += 1;
      if (instructionCount > MAX_INSTRUCTIONS) {
        throw new EvidenceError("analysis-limit-exceeded");
      }
      const opcode = body[cursor.value++]!;
      if (
        opcode === 0x00
        || opcode === 0x01
        || opcode === 0x05
        || opcode === 0x0b
        || opcode === 0x0f
        || opcode === 0x1a
        || opcode === 0x1b
        || opcode === 0xd1
        || (opcode >= 0x45 && opcode <= 0xc4)
      ) {
        continue;
      }
      if (opcode >= 0x02 && opcode <= 0x04) {
        if (cursor.value >= body.byteLength) {
          throw new EvidenceError("instruction-set-unsupported");
        }
        const next = body[cursor.value]!;
        if (
          next === 0x40
          || next === 0x7f
          || next === 0x7e
          || next === 0x7d
          || next === 0x7c
          || next === 0x7b
          || next === 0x70
          || next === 0x6f
        ) {
          cursor.value += 1;
        } else {
          readSigned(body, cursor, 5);
        }
        continue;
      }
      if (opcode === 0x0e) {
        const targetCount = readInstructionUnsigned(body, cursor);
        if (targetCount > MAX_FUNCTIONS) {
          throw new EvidenceError("analysis-limit-exceeded");
        }
        for (let index = 0; index <= targetCount; index += 1) {
          readInstructionUnsigned(body, cursor);
        }
        continue;
      }
      if (opcode === 0x11) {
        readInstructionUnsigned(body, cursor);
        readInstructionUnsigned(body, cursor);
        continue;
      }
      if (opcode === 0x1c) {
        const count = readInstructionUnsigned(body, cursor);
        if (count > MAX_TYPES) {
          throw new EvidenceError("analysis-limit-exceeded");
        }
        if (cursor.value + count > body.byteLength) {
          throw new EvidenceError("instruction-set-unsupported");
        }
        cursor.value += count;
        continue;
      }
      if (opcode === 0x41) {
        const value = readSigned(body, cursor, 5);
        if (trackedMessages.has(value)) {
          messageSites[value] = (messageSites[value] ?? 0) + 1;
        }
        continue;
      }
      if (opcode === 0x42) {
        readSigned(body, cursor, 10);
        continue;
      }
      if (opcode === 0x43 || opcode === 0x44) {
        const width = opcode === 0x43 ? 4 : 8;
        if (cursor.value + width > body.byteLength) {
          throw new EvidenceError("instruction-set-unsupported");
        }
        cursor.value += width;
        continue;
      }
      if (opcode >= 0x28 && opcode <= 0x3e) {
        const alignment = readInstructionUnsigned(body, cursor);
        readInstructionUnsigned(body, cursor);
        if ((alignment & 0x40) !== 0) readInstructionUnsigned(body, cursor);
        continue;
      }
      if (opcode === 0x10) {
        const target = readInstructionUnsigned(body, cursor);
        calls.set(target, (calls.get(target) ?? 0) + 1);
        continue;
      }
      if (
        opcode === 0x0c
        || opcode === 0x0d
        || (opcode >= 0x20 && opcode <= 0x26)
        || opcode === 0x3f
        || opcode === 0x40
        || opcode === 0xd2
      ) {
        readInstructionUnsigned(body, cursor);
        continue;
      }
      if (opcode === 0xd0) {
        readSigned(body, cursor, 5);
        continue;
      }
      if (opcode === 0xfc) {
        const subopcode = readInstructionUnsigned(body, cursor);
        let immediateCount: number;
        if (subopcode <= 7) immediateCount = 0;
        else if (subopcode === 8 || subopcode === 10 || subopcode === 12 || subopcode === 14) {
          immediateCount = 2;
        } else if (
          subopcode === 9
          || subopcode === 11
          || subopcode === 13
          || subopcode === 15
          || subopcode === 16
          || subopcode === 17
        ) {
          immediateCount = 1;
        } else {
          throw new EvidenceError("instruction-set-unsupported");
        }
        for (let index = 0; index < immediateCount; index += 1) {
          readInstructionUnsigned(body, cursor);
        }
        continue;
      }
      throw new EvidenceError("instruction-set-unsupported");
    }
    decoded.push({
      functionIndex: module.functionImportCount + localIndex,
      calls,
      messageSites,
    });
  }
  return decoded;
}

function messageRelations(
  decoded: readonly DecodedFunction[],
  target: number,
  message: number,
): MessageProducerEvidence[] {
  return decoded
    .filter(
      (producer) =>
        (producer.messageSites[message] ?? 0) > 0
        && (producer.calls.get(target) ?? 0) > 0,
    )
    .map((producer) => ({
      producerFunctionIndex: producer.functionIndex,
      messageSites: producer.messageSites[message] ?? 0,
      directCallSites: producer.calls.get(target) ?? 0,
    }));
}

function exactPlayerChatProducer(
  relations: readonly MessageProducerEvidence[],
): MessageProducerEvidence[] {
  return relations.filter(
    (relation) =>
      relation.messageSites === 3
      && relation.directCallSites === 3,
  );
}

function playerChatUiEvidence(
  module: ModuleShape,
  decoded: readonly DecodedFunction[],
  messageAnchors: PlayerChatMessageAnchors,
): PlayerChatUiEvidenceReport {
  const playerChatMessage = messageAnchors.playerChatMessage;
  const [nearby7fMessage, nearby80Message] =
    messageAnchors.nearbyPlayerMessages;
  const relevantTargets = new Set<number>();
  for (const producer of decoded) {
    if (
      (producer.messageSites[playerChatMessage] ?? 0) === 0
      && (producer.messageSites[nearby7fMessage] ?? 0) === 0
      && (producer.messageSites[nearby80Message] ?? 0) === 0
    ) {
      continue;
    }
    for (const target of producer.calls.keys()) relevantTargets.add(target);
  }
  if (relevantTargets.size > MAX_CONSIDERED) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const considered = [...relevantTargets]
    .sort((left, right) => left - right)
    .map((dispatcherFunctionIndex): PlayerChatUiConsideration => ({
      dispatcherFunctionIndex,
      signature: signatureEvidence(module, dispatcherFunctionIndex),
      signatureMatches: functionHasSignature(module, dispatcherFunctionIndex, 3),
      playerChat: messageRelations(
        decoded,
        dispatcherFunctionIndex,
        playerChatMessage,
      ),
      nearby7f: messageRelations(
        decoded,
        dispatcherFunctionIndex,
        nearby7fMessage,
      ),
      nearby80: messageRelations(
        decoded,
        dispatcherFunctionIndex,
        nearby80Message,
      ),
    }))
    .filter(
      (candidate) =>
        candidate.signatureMatches
        || candidate.playerChat.some(
          (relation) =>
            relation.messageSites >= 3
            || relation.directCallSites >= 3,
        ),
    );
  const candidates = considered.filter(
    (candidate) =>
      candidate.signatureMatches
      && exactPlayerChatProducer(candidate.playerChat).length === 1
      && candidate.nearby7f.length > 0
      && candidate.nearby80.length > 0,
  );
  if (candidates.length === 1) {
    const candidate = candidates[0]!;
    return {
      status: "candidate",
      considered,
      candidate: {
        dispatcherFunctionIndex: candidate.dispatcherFunctionIndex,
        playerChatProducerFunctionIndex:
          exactPlayerChatProducer(candidate.playerChat)[0]!
            .producerFunctionIndex,
        nearby7fProducerFunctionIndices: candidate.nearby7f.map(
          (relation) => relation.producerFunctionIndex,
        ),
        nearby80ProducerFunctionIndices: candidate.nearby80.map(
          (relation) => relation.producerFunctionIndex,
        ),
      },
    };
  }
  return {
    status: candidates.length > 1 ? "ambiguous" : "unavailable",
    considered,
    candidate: null,
  };
}

function parseActiveTableRelations(
  bytes: Uint8Array | null,
): Map<number, number[]> {
  if (!bytes) return new Map();
  const cursor = { value: 0 };
  let segments: number;
  try {
    segments = readUnsigned(bytes, cursor);
  } catch {
    throw new EvidenceError("active-table-unsupported");
  }
  if (segments > MAX_FUNCTIONS) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const slots = new Map<number, number>();
  try {
    for (let segment = 0; segment < segments; segment += 1) {
      const flags = readUnsigned(bytes, cursor);
      let activeBase: number | null = null;
      if (flags === 0 || flags === 2) {
        if (flags === 2 && readUnsigned(bytes, cursor) !== 0) {
          throw new EvidenceError("active-table-unsupported");
        }
        if (bytes[cursor.value++] !== 0x41) {
          throw new EvidenceError("active-table-unsupported");
        }
        activeBase = readSigned(bytes, cursor, 5);
        if (activeBase < 0 || bytes[cursor.value++] !== 0x0b) {
          throw new EvidenceError("active-table-unsupported");
        }
        if (flags === 2 && bytes[cursor.value++] !== 0) {
          throw new EvidenceError("active-table-unsupported");
        }
      } else if (flags === 1 || flags === 3) {
        if (bytes[cursor.value++] !== 0) {
          throw new EvidenceError("active-table-unsupported");
        }
      } else {
        throw new EvidenceError("active-table-unsupported");
      }
      const entries = readUnsigned(bytes, cursor);
      if (entries > MAX_FUNCTIONS) {
        throw new EvidenceError("analysis-limit-exceeded");
      }
      for (let entry = 0; entry < entries; entry += 1) {
        const functionIndex = readUnsigned(bytes, cursor);
        if (activeBase !== null) {
          const slot = activeBase + entry;
          if (!Number.isSafeInteger(slot) || slot > 0xffff_ffff) {
            throw new EvidenceError("active-table-unsupported");
          }
          // Later active segments overwrite earlier ones during instantiation.
          slots.set(slot, functionIndex);
        }
      }
    }
  } catch (error) {
    if (error instanceof EvidenceError) {
      if (error.code === "analysis-limit-exceeded") throw error;
      throw new EvidenceError("active-table-unsupported");
    }
    throw new EvidenceError("active-table-unsupported");
  }
  if (cursor.value !== bytes.byteLength) {
    throw new EvidenceError("active-table-unsupported");
  }
  const byFunction = new Map<number, number[]>();
  for (const [slot, functionIndex] of [...slots].sort(
    ([left], [right]) => left - right,
  )) {
    const values = byFunction.get(functionIndex) ?? [];
    values.push(slot);
    byFunction.set(functionIndex, values);
  }
  return byFunction;
}

function cursorEvidence(
  module: ModuleShape,
  decoded: readonly DecodedFunction[],
  tableRelations: ReadonlyMap<number, readonly number[]>,
): CursorEvidenceReport {
  const callers = new Map<number, Map<number, number>>();
  for (const producer of decoded) {
    for (const [target, sites] of producer.calls) {
      const targetCallers = callers.get(target) ?? new Map<number, number>();
      targetCallers.set(producer.functionIndex, sites);
      callers.set(target, targetCallers);
    }
  }
  const considered: CursorConsideration[] = [];
  for (
    let targetFunctionIndex = 0;
    targetFunctionIndex < module.functionTypeIndices.length;
    targetFunctionIndex += 1
  ) {
    if (!functionHasSignature(module, targetFunctionIndex, 5)) continue;
    const targetCallers = callers.get(targetFunctionIndex) ?? new Map();
    const activeTableSlots = [...(tableRelations.get(targetFunctionIndex) ?? [])];
    if (targetCallers.size === 0 && activeTableSlots.length === 0) continue;
    const directProducers = [...targetCallers]
      .sort(([left], [right]) => left - right)
      .map(([producerFunctionIndex, directCallSites]) => ({
        producerFunctionIndex,
        directCallSites,
      }));
    if (directProducers.length !== 2 && activeTableSlots.length === 0) continue;
    considered.push({
      targetFunctionIndex,
      directCallSites: directProducers.reduce(
        (sum, producer) => sum + producer.directCallSites,
        0,
      ),
      directProducers,
      activeTableSlots,
    });
  }
  if (considered.length > MAX_CONSIDERED) {
    throw new EvidenceError("analysis-limit-exceeded");
  }
  const producerShape = considered.filter(
    (candidate) =>
      candidate.directProducers.length === 2
      && candidate.directCallSites === 2,
  );
  const candidates = producerShape.filter(
    (candidate) => candidate.activeTableSlots.length === 1,
  );
  if (candidates.length === 1) {
    const candidate = candidates[0]!;
    return {
      status: "candidate",
      considered,
      candidate: {
        targetFunctionIndex: candidate.targetFunctionIndex,
        producerFunctionIndices: [
          candidate.directProducers[0]!.producerFunctionIndex,
          candidate.directProducers[1]!.producerFunctionIndex,
        ],
        activeTableSlot: candidate.activeTableSlots[0]!,
        bodySha256: functionBodySha256(module, candidate.targetFunctionIndex),
        producerBodySha256: [
          functionBodySha256(module, candidate.directProducers[0]!.producerFunctionIndex),
          functionBodySha256(module, candidate.directProducers[1]!.producerFunctionIndex),
        ],
      },
    };
  }
  const relationIsAmbiguous = producerShape.some(
    (candidate) => candidate.activeTableSlots.length > 1,
  );
  return {
    status: candidates.length > 1 || relationIsAmbiguous
      ? "ambiguous"
      : "unavailable",
    considered,
    candidate: null,
  };
}

/**
 * Recovers only the three independently reviewable hook boundaries. It never
 * infers source anchors, memory layouts, message names, or a launch policy.
 */
export function inspectEnhancementStructuralEvidence(
  input: Uint8Array,
  messageAnchors: PlayerChatMessageAnchors,
): EnhancementStructuralEvidenceReport {
  const sha256 = createHash("sha256").update(input).digest("hex");
  if (input.byteLength > MAX_INPUT_BYTES) {
    return baseReport(sha256, false, "input-too-large");
  }
  let validWasm: boolean;
  try {
    validWasm = WebAssembly.validate(input);
  } catch {
    validWasm = false;
  }
  if (!validWasm) return baseReport(sha256, false, "invalid-wasm");

  let module: ModuleShape;
  try {
    module = parseModule(input);
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error.code
      : "module-shape-unsupported";
    return baseReport(sha256, true, failure);
  }
  const tick = tickEvidence(module);
  let decoded: DecodedFunction[];
  try {
    decoded = decodeFunctions(module, messageAnchors);
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error.code
      : "instruction-set-unsupported";
    return {
      sha256,
      validWasm: true,
      failures: [failure],
      tick,
      playerChatUi: unavailableUi(),
      cursor: unavailableCursor(),
    };
  }

  let playerChatUi: PlayerChatUiEvidenceReport;
  try {
    playerChatUi = playerChatUiEvidence(module, decoded, messageAnchors);
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error.code
      : "analysis-limit-exceeded";
    return {
      sha256,
      validWasm: true,
      failures: [failure],
      tick,
      playerChatUi: unavailableUi(),
      cursor: unavailableCursor(),
    };
  }

  try {
    const tableRelations = parseActiveTableRelations(module.elementSection);
    return {
      sha256,
      validWasm: true,
      failures: [],
      tick,
      playerChatUi,
      cursor: cursorEvidence(module, decoded, tableRelations),
    };
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error.code
      : "active-table-unsupported";
    return {
      sha256,
      validWasm: true,
      failures: [failure],
      tick,
      playerChatUi,
      cursor: unavailableCursor(),
    };
  }
}

type CursorRole = Readonly<{
  bodyLength: number;
  fingerprint: string;
  spans: readonly RelocationSpan[];
  params: readonly string[];
  results: readonly string[];
}>;

const mutableSpans = (
  entries: readonly (readonly [number, number, string])[],
): readonly RelocationSpan[] => Object.freeze(entries.map(([start, end, role]) =>
  Object.freeze({ start, end, role, addressClass: "mutable-static" as const })));

const CURSOR_TICK_ROLE: CursorRole = Object.freeze({
  bodyLength: 218,
  fingerprint: "55a9bca40e9e16713b0473d83afbe7264cd9578f0077d99075afafb076d5fa66",
  spans: mutableSpans([
    [27, 32, "tick.work-count"],
    [60, 65, "tick.work-list"],
    [146, 151, "tick.quit-flag"],
    [185, 190, "tick.tail-callback"],
  ]),
  params: Object.freeze(["i32"]),
  results: Object.freeze([]),
});

const CURSOR_PRODUCER_ROLES: readonly [CursorRole, CursorRole] = Object.freeze([
  Object.freeze({
    bodyLength: 1_099,
    fingerprint: "a9d848f87b08aba9b6eb08cbca0bb89208004df8fbdb83b8f8505001e6c4b91b",
    spans: mutableSpans([
      [68, 73, "producer.busy"], [104, 109, "producer.busy"],
      [688, 693, "producer.scratch"], [712, 717, "cursor.color-buffer"],
      [742, 747, "producer.scratch"], [761, 766, "cursor.color-buffer"],
      [772, 777, "producer.scratch-plus-one"],
      [798, 803, "cursor.color-buffer"], [829, 834, "cursor.color-buffer"],
      [835, 840, "producer.scratch"], [1075, 1080, "producer.busy"],
    ]),
    params: Object.freeze(["i32", "i32"]),
    results: Object.freeze(["i32"]),
  }),
  Object.freeze({
    bodyLength: 254,
    fingerprint: "7f1603650a1e2428354420bdc3ca9d4b4c9e678a2736234277cdf46755090311",
    spans: mutableSpans([
      [78, 83, "producer.scratch"], [102, 107, "cursor.color-buffer"],
      [132, 137, "producer.scratch"], [151, 156, "cursor.color-buffer"],
      [162, 167, "producer.scratch-plus-one"],
      [188, 193, "cursor.color-buffer"], [219, 224, "cursor.color-buffer"],
      [225, 230, "producer.scratch"],
    ]),
    params: Object.freeze(["i32", "i32"]),
    results: Object.freeze(["i32"]),
  }),
]);

const CURSOR_ART_RENDERER_ROLE: CursorRole = Object.freeze({
  bodyLength: 277,
  fingerprint: "a4a80470eeec29fe6a691a8da454ec80b478046343b5f8422ef3382d9e9780e6",
  spans: mutableSpans([
    [84, 89, "cursor.art-cache-a"],
    [90, 95, "cursor.art-cache-b"],
    [148, 153, "cursor.scale"],
  ]),
  params: Object.freeze(["i32", "i32"]),
  results: Object.freeze([]),
});

const CURSOR_STATE_READER_ROLE: CursorRole = Object.freeze({
  bodyLength: 102,
  fingerprint: "39a2f1f0bdb8526c7de7616c6fb4da03c746c5debd78c29cc81006b2f65a4804",
  spans: mutableSpans([
    [9, 14, "cursor.software-model"],
    [20, 25, "cursor.show-count"],
    [36, 41, "cursor.active-art"],
  ]),
  params: Object.freeze([]),
  results: Object.freeze([]),
});

const CURSOR_TABLE_AFTER_ROLE: CursorRole = Object.freeze({
  bodyLength: 155,
  fingerprint: "27ad597ce36f810602ece7a1f39259e3ecc9381332ad4cdf7fc461b4a6bd9cef",
  spans: mutableSpans([[116, 121, "cursor.table-after-vtable"]]),
  params: Object.freeze(["i32"]),
  results: Object.freeze(["i32"]),
});

const CURSOR_HANDLE_READER_SHA256 =
  "140a325a163f8eaec410ad40908b993e4a5d3532f51c675be0019e166253b173";
const CURSOR_TEXTURE_WRITER_SHA256 =
  "f1d4d25243aeb652707797683ed6118569f606e9e3a69040eaa3789f737dcc7a";

function functionBody(module: ModuleShape, functionIndex: number): Uint8Array {
  const body = module.bodies[functionIndex - module.functionImportCount];
  if (!body) throw new EvidenceError("module-shape-unsupported");
  return body;
}

function signatureMatches(
  module: ModuleShape,
  functionIndex: number,
  params: readonly string[],
  results: readonly string[],
): boolean {
  const signature = signatureEvidence(module, functionIndex);
  return signature !== null
    && signature.params.join() === params.join()
    && signature.results.join() === results.join();
}

function bodyMatchesRole(body: Uint8Array, role: CursorRole): boolean {
  return body.byteLength === role.bodyLength
    && relocationAwareFingerprint(body, role.spans) === role.fingerprint;
}

function uniqueRoleFunction(module: ModuleShape, role: CursorRole): number | null {
  const matches: number[] = [];
  for (
    let functionIndex = module.functionImportCount;
    functionIndex < module.functionTypeIndices.length;
    functionIndex += 1
  ) {
    if (
      signatureMatches(module, functionIndex, role.params, role.results)
      && bodyMatchesRole(functionBody(module, functionIndex), role)
    ) matches.push(functionIndex);
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0]! : null;
}

function uniqueExactFunction(
  module: ModuleShape,
  bodySha256: string,
  params: readonly string[],
  results: readonly string[],
): number | null {
  const matches: number[] = [];
  for (
    let functionIndex = module.functionImportCount;
    functionIndex < module.functionTypeIndices.length;
    functionIndex += 1
  ) {
    if (
      signatureMatches(module, functionIndex, params, results)
      && functionBodySha256(module, functionIndex) === bodySha256
    ) matches.push(functionIndex);
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0]! : null;
}

function paddedU32(body: Uint8Array, start: number): number {
  const cursor = { value: start };
  const value = readUnsigned(body, cursor);
  if (cursor.value !== start + 5) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return value;
}

function valuesForRole(body: Uint8Array, role: CursorRole): Map<string, number[]> {
  const values = new Map<string, number[]>();
  for (const span of role.spans) {
    const group = values.get(span.role) ?? [];
    group.push(paddedU32(body, span.start));
    values.set(span.role, group);
  }
  return values;
}

function soleValue(values: Map<string, number[]>, role: string): number {
  const found = values.get(role) ?? [];
  if (found.length === 0 || found.some((value) => value !== found[0])) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return found[0]!;
}

function commonRelocationDelta(
  entries: readonly (readonly [number, number])[],
): number | null {
  const deltas = entries.map(([candidate, baseline]) => candidate - baseline);
  return deltas.every((delta) => delta === deltas[0]) ? deltas[0]! : null;
}

function deriveCursorLayout(
  module: ModuleShape,
  tickFunction: number,
  producerFunctions: readonly [number, number],
): EnhancementCursorLayout | null {
  const rendererFunction = uniqueRoleFunction(module, CURSOR_ART_RENDERER_ROLE);
  const stateReaderFunction = uniqueRoleFunction(module, CURSOR_STATE_READER_ROLE);
  const handleReaderFunction = uniqueExactFunction(
    module, CURSOR_HANDLE_READER_SHA256, ["i32"], ["i32"],
  );
  const textureWriterFunction = uniqueExactFunction(
    module, CURSOR_TEXTURE_WRITER_SHA256, ["i32", "i32", "i32"], [],
  );
  if (
    rendererFunction === null || stateReaderFunction === null
    || handleReaderFunction === null || textureWriterFunction === null
  ) return null;

  const producerOne = valuesForRole(
    functionBody(module, producerFunctions[0]), CURSOR_PRODUCER_ROLES[0],
  );
  const producerTwo = valuesForRole(
    functionBody(module, producerFunctions[1]), CURSOR_PRODUCER_ROLES[1],
  );
  const state = valuesForRole(
    functionBody(module, stateReaderFunction), CURSOR_STATE_READER_ROLE,
  );
  const renderer = valuesForRole(
    functionBody(module, rendererFunction), CURSOR_ART_RENDERER_ROLE,
  );
  const tick = valuesForRole(
    functionBody(module, tickFunction), CURSOR_TICK_ROLE,
  );
  const colorBuffer = soleValue(producerOne, "cursor.color-buffer");
  if (
    colorBuffer !== soleValue(producerTwo, "cursor.color-buffer")
    || soleValue(producerOne, "producer.scratch") + 1
      !== soleValue(producerOne, "producer.scratch-plus-one")
    || soleValue(producerTwo, "producer.scratch") + 1
      !== soleValue(producerTwo, "producer.scratch-plus-one")
  ) return null;

  const cursorActiveArt = soleValue(state, "cursor.active-art");
  const cursorSoftwareModel = soleValue(state, "cursor.software-model");
  const cursorShowCount = soleValue(state, "cursor.show-count");
  if (
    cursorSoftwareModel !== cursorActiveArt + 4
    || cursorShowCount !== cursorActiveArt + 8
    || soleValue(renderer, "cursor.art-cache-b")
      !== soleValue(renderer, "cursor.art-cache-a") + 4
  ) return null;

  const delta = commonRelocationDelta([
    [colorBuffer, 0x298e50],
    [soleValue(producerOne, "producer.scratch"), 0x298a50],
    [soleValue(producerTwo, "producer.scratch"), 0x298a50],
    [soleValue(producerOne, "producer.busy"), 0x298a40],
    [cursorActiveArt, 0x5a16e0],
    [cursorSoftwareModel, 0x5a16e4],
    [cursorShowCount, 0x5a16e8],
    [soleValue(renderer, "cursor.art-cache-a"), 0x15a5dc],
    [soleValue(renderer, "cursor.art-cache-b"), 0x15a5e0],
    [soleValue(renderer, "cursor.scale"), 0x5a13a4],
    [soleValue(tick, "tick.work-count"), 0x28cde4],
    [soleValue(tick, "tick.work-list"), 0x28cddc],
    [soleValue(tick, "tick.quit-flag"), 0x28cdec],
    [soleValue(tick, "tick.tail-callback"), 0x28cdf0],
  ]);
  if (delta === null) return null;

  const layout: EnhancementCursorLayout = {
    cursorActiveArt,
    cursorSoftwareModel,
    cursorShowCount,
    cursorColorBuffer: colorBuffer,
    cursorArtHotspot: 0,
    cursorArtTexture: 12,
    cursorHandleKey: 8,
    cursorHandleObject: 0,
    cursorViewTexture: 8,
    cursorTextureType: 12,
    cursorTextureWidth: 20,
    cursorTextureHeight: 24,
  };
  return verifyLayout(layout, {
    cursorActiveArt: { sourceRole: "cursor-state-reader", expression: "i32.load static", occurrences: [36] },
    cursorSoftwareModel: { sourceRole: "cursor-state-reader", expression: "i32.load static", occurrences: [9] },
    cursorShowCount: { sourceRole: "cursor-state-reader", expression: "i32.load static", occurrences: [20] },
    cursorColorBuffer: { sourceRole: "cursor-pixel-producers", expression: "i32.const/static store", occurrences: [712, 761, 798, 829, 102, 151, 188, 219] },
    cursorArtHotspot: { sourceRole: "cursor-art-renderer", expression: "direct art loads at +0/+4", occurrences: [139, 132] },
    cursorArtTexture: { sourceRole: "cursor-state-reader+renderer", expression: "art texture load +12", occurrences: [43, 26, 68] },
    cursorHandleKey: { sourceRole: "cursor-art-renderer", expression: "cached handle load/store +8", occurrences: [57, 114] },
    cursorHandleObject: { sourceRole: "cursor-handle-reader", expression: "handle base dereference +0", occurrences: [3] },
    cursorViewTexture: { sourceRole: "cursor-handle-reader", expression: "two linked loads +8", occurrences: [5, 8] },
    cursorTextureType: { sourceRole: "cursor-texture-writer", expression: "texture type store +12", occurrences: [12] },
    cursorTextureWidth: { sourceRole: "cursor-texture-descriptor", expression: "certified descriptor width +20", occurrences: [20] },
    cursorTextureHeight: { sourceRole: "cursor-texture-descriptor", expression: "certified descriptor height +24", occurrences: [24] },
  }).layout;
}

/**
 * Strict launch authority for cursor-only recovery on an unknown build.
 * Locations come from the candidate module; only semantic body fingerprints
 * and the active table relation come from the signed baselines.
 */
export function locateAutomaticCursor(
  input: Uint8Array,
  baselines: readonly KnownEnhancementBuild[],
): AutomaticCursorLocation | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const inputSha256 = createHash("sha256").update(input).digest("hex");
    const module = parseModule(input);
    const tick = tickEvidence(module).candidate;
    if (!tick) return null;
    const relations = parseActiveTableRelations(module.elementSection);
    const matches: AutomaticCursorLocation[] = [];
    for (const baseline of baselines) {
      const cursor = baseline.cursorEvent;
      if (!cursor) continue;
      const tickBody = functionBody(module, tick.functionIndex);
      const exactFamily = tick.bodySha256 === baseline.hookBodySha256;
      const exactCertifiedInput = exactFamily && inputSha256 === baseline.sha256;
      const semanticFamily = bodyMatchesRole(tickBody, CURSOR_TICK_ROLE);
      if (!exactFamily && !semanticFamily) continue;
      const cursorFunctions = module.functionTypeIndices.flatMap((_, index) => {
        const slots = relations.get(index) ?? [];
        if (
          index < module.functionImportCount
          || !functionHasSignature(module, index, 5)
          || functionBodySha256(module, index) !== cursor.bodySha256
          || slots.length !== 1
        ) return [];
        const slot = slots[0]!;
        const functionAt = (targetSlot: number): number | null => {
          for (const [functionIndex, mapped] of relations) {
            if (mapped.includes(targetSlot)) return functionIndex;
          }
          return null;
        };
        const before = functionAt(slot - 1);
        const after = functionAt(slot + 1);
        return before !== null && after !== null
          && functionBodySha256(module, before) === cursor.tableNeighbourBodySha256[0]
          && (
            functionBodySha256(module, after) === cursor.tableNeighbourBodySha256[1]
            || bodyMatchesRole(functionBody(module, after), CURSOR_TABLE_AFTER_ROLE)
          )
          ? [index]
          : [];
      });
      const producers = exactFamily
        ? cursor.producerBodySha256.map((fingerprint) =>
            module.functionTypeIndices.flatMap((_, index) =>
              index >= module.functionImportCount
              && functionBodySha256(module, index) === fingerprint
                ? [index]
                : []))
        : CURSOR_PRODUCER_ROLES.map((role) => {
            const found = uniqueRoleFunction(module, role);
            return found === null ? [] : [found];
          });
      const producerSignaturesMatch = producers.every((matches, index) => {
        const functionIndex = matches[0];
        const signature = functionIndex === undefined
          ? null
          : signatureEvidence(module, functionIndex);
        return signature !== null
          && signature.params.join() === cursor.producerParams[index]!.join()
          && signature.results.join() === cursor.producerResults[index]!.join();
      });
      if (
        cursorFunctions.length !== 1
        || producers[0]?.length !== 1
        || producers[1]?.length !== 1
        || producers[0][0] === producers[1][0]
        || !producerSignaturesMatch
      ) continue;
      const cursorFunction = cursorFunctions[0]!;
      const producerFunctions = [producers[0][0]!, producers[1][0]!] as const;
      const layout = exactCertifiedInput
        ? cursor.layout
        : deriveCursorLayout(module, tick.functionIndex, producerFunctions);
      if (!layout) continue;
      matches.push({
        baseline,
        hookFunction: tick.functionIndex,
        hookBodySha256: tick.bodySha256,
        cursorFunction,
        cursorTableSlot: relations.get(cursorFunction)![0]!,
        producerFunctions,
        producerBodySha256: [
          functionBodySha256(module, producerFunctions[0]),
          functionBodySha256(module, producerFunctions[1]),
        ],
        layout,
      });
    }
    if (matches.length === 0) return null;
    const identity = (value: AutomaticCursorLocation) => JSON.stringify({
      hookFunction: value.hookFunction,
      cursorFunction: value.cursorFunction,
      cursorTableSlot: value.cursorTableSlot,
      producerFunctions: value.producerFunctions,
      cursorLayout: value.layout,
    });
    return matches.every((match) => identity(match) === identity(matches[0]!))
      ? matches[0]!
      : null;
  } catch {
    return null;
  }
}
