/**
 * The structural analysis behind a recertification: what a client module's own
 * shape says about where the Enhancement hooks belong.
 *
 * The broad comparison report is evidence with a status attached, never a
 * conclusion. The separate feature locators are intentionally narrower: each
 * is launch authority only after all of its signed semantic fingerprints,
 * signatures, relationships and uniqueness checks match.
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
  readSleb,
  readUleb,
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
import type {
  EnhancementCursorLayout,
  EnhancementObservationBaseLayout,
  EnhancementPartyLayout,
  EnhancementTargetLayout,
} from "../../shared/enhancement-config.js";

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

export interface AutomaticTargetLocation {
  readonly baseline: KnownEnhancementBuild;
  readonly hookFunction: number;
  readonly hookBodySha256: string;
  readonly observationLayout: EnhancementObservationBaseLayout;
  readonly targetLayout: EnhancementTargetLayout;
}

export interface AutomaticLocalActionsLocation {
  readonly baseline: KnownEnhancementBuild;
  readonly hookFunction: number;
  readonly hookBodySha256: string;
  readonly observationLayout: EnhancementObservationBaseLayout | null;
  readonly uiDispatcher: KnownEnhancementBuild["uiDispatcher"] | null;
  readonly gameThread: KnownEnhancementBuild["gameThread"] | null;
  readonly travelAction: KnownEnhancementBuild["travelAction"] | null;
  readonly xunlaiAction: KnownEnhancementBuild["xunlaiAction"] | null;
  readonly chatAliases: KnownEnhancementBuild["chatAliases"] | null;
  readonly partyObservation: KnownEnhancementBuild["partyObservation"] | null;
  readonly teamApply: KnownEnhancementBuild["teamApply"] | null;
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
  readonly bodySha256: (string | undefined)[];
  readonly exports: WasmExport[];
  readonly elementSection: Uint8Array | null;
  readonly dataSegments: readonly Readonly<{
    base: number;
    bytes: Uint8Array;
  }>[];
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
    bodySha256: new Array<string | undefined>(bodies.length),
    exports: parseExports(optionalSection(sections, 7)),
    elementSection: optionalSection(sections, 9),
    dataSegments: parseStaticData(optionalSection(sections, 11)),
  };
}

function parseStaticData(
  bytes: Uint8Array | null,
): readonly Readonly<{ base: number; bytes: Uint8Array }>[] {
  if (!bytes) return [];
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  if (count > MAX_FUNCTIONS) throw new EvidenceError("analysis-limit-exceeded");
  const segments: Readonly<{ base: number; bytes: Uint8Array }>[] = [];
  for (let index = 0; index < count; index += 1) {
    if (readUleb(bytes, cursor) !== 0 || bytes[cursor.offset++] !== 0x41) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const base = readSleb(bytes, cursor);
    if (base < 0 || bytes[cursor.offset++] !== 0x0b) {
      throw new EvidenceError("module-shape-unsupported");
    }
    const size = readUleb(bytes, cursor);
    const end = cursor.offset + size;
    if (end > bytes.byteLength) {
      throw new EvidenceError("module-shape-unsupported");
    }
    segments.push(Object.freeze({
      base,
      bytes: bytes.slice(cursor.offset, end),
    }));
    cursor.offset = end;
  }
  if (cursor.offset !== bytes.byteLength) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return Object.freeze(segments);
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
  const localIndex = functionIndex - module.functionImportCount;
  const body = module.bodies[localIndex];
  if (!body) throw new EvidenceError("module-shape-unsupported");
  const cached = module.bodySha256[localIndex];
  if (cached) return cached;
  const digest = createHash("sha256").update(body).digest("hex");
  module.bodySha256[localIndex] = digest;
  return digest;
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
  messageAnchors: PlayerChatMessageAnchors | readonly number[],
): DecodedFunction[] {
  const trackedMessages = new Set<number>("playerChatMessage" in messageAnchors
    ? [messageAnchors.playerChatMessage, ...messageAnchors.nearbyPlayerMessages]
    : messageAnchors);
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

const semanticRole = (
  bodyLength: number,
  fingerprint: string,
  spans: readonly RelocationSpan[],
  params: readonly string[],
  results: readonly string[],
): CursorRole => Object.freeze({ bodyLength, fingerprint, spans, params, results });

const TARGET_CONTEXT_ROOT_ROLE = semanticRole(
  33,
  "3ec691dd53ed9441774e334e1cf646e9c5f62ca715c6069c2cc1080713852d36",
  mutableSpans([[11, 16, "context.root"]]),
  [],
  [],
);

const TARGET_SELECTOR_ROLE = semanticRole(
  726,
  "b288186a735fa6f304715f330643f3cd71d0520579ee2dbfd559313c9dba148b",
  Object.freeze([
    { start: 38, end: 43, role: "target.assert-manual", addressClass: "immutable-data" },
    { start: 77, end: 82, role: "target.assert-automatic", addressClass: "immutable-data" },
    ...mutableSpans([
      [111, 116, "target.related-0"],
      [132, 137, "target.manual"], [147, 152, "target.automatic"],
      [312, 317, "target.manual"], [332, 337, "target.automatic"],
      [381, 386, "target.related-1"], [451, 456, "target.related-1"],
      [501, 506, "target.related-2"],
      [636, 641, "target.manual"], [647, 652, "target.automatic"],
    ]),
  ]),
  ["i32", "i32"],
  [],
);

const TARGET_RESET_ROLE = semanticRole(
  136,
  "d3cae3aed2485fa4b3a309b096a5f6c3d542bb09c46e2d03c92790a05e53112f",
  Object.freeze([
    ...mutableSpans([
      [7, 12, "target.manual"], [18, 23, "target.automatic"],
      [29, 34, "target.related-0"], [40, 45, "target.related-3"],
      [51, 56, "target.related-4"], [62, 67, "target.related-5"],
      [73, 78, "target.related-6"], [84, 89, "target.related-7"],
      [107, 112, "target.related-8"], [130, 135, "target.related-9"],
    ]),
    { start: 92, end: 97, role: "target.reset-name-a", addressClass: "immutable-data" },
    { start: 115, end: 120, role: "target.reset-name-b", addressClass: "immutable-data" },
  ]),
  [],
  [],
);

const TARGET_CALLER_ROLE = semanticRole(
  214,
  "7d1f1ffe2fe47663ddf06a6ad4940dd26fcb64958578b9f7027c20facfefd25e",
  mutableSpans([
    [9, 14, "target.automatic"], [23, 28, "target.manual"],
    [40, 45, "target.manual"], [60, 65, "target.manual"],
    [76, 81, "target.automatic"], [93, 98, "target.automatic"],
    [111, 116, "target.related-3"], [136, 141, "target.related-3"],
    [198, 203, "target.related-3"],
  ]),
  ["i32"],
  [],
);

const AGENT_ARRAY_LIFECYCLE_ROLE = semanticRole(
  51,
  "90bf935b288798d9383a84eefe73856cbe2048635aa7702bac56b1e0d5498436",
  mutableSpans([
    [9, 14, "agent-array.base"], [34, 39, "agent-array.base"],
    [45, 50, "agent-array.size"],
  ]),
  ["i32"],
  [],
);

const AGENT_ARRAY_ACCESSOR_ROLE = semanticRole(
  47,
  "e2d3a0903dd7eb7595e118466ce74d0e90f9f38c81068c8cd2fd1f8ab0570338",
  mutableSpans([
    [15, 20, "agent-array.size"], [27, 32, "agent-array.base"],
  ]),
  ["i32"],
  ["i32"],
);

const AREA_LOOKUP_ROLE = semanticRole(
  47,
  "40dbe1dc1bc07cc9115aa44d89cd64673246c6f6c04a46e646fa1939e49dcf6f",
  Object.freeze([
    { start: 12, end: 17, role: "area.assert-name", addressClass: "immutable-data" },
    { start: 40, end: 45, role: "area.table", addressClass: "immutable-data" },
  ]),
  ["i32"],
  ["i32"],
);

type ExactTargetRole = Readonly<{
  bodySha256: string;
  params: readonly string[];
  results: readonly string[];
}>;

const EXACT_TARGET_ROLES = Object.freeze({
  gameCharacter: { bodySha256: "f234e09fc78c540418d7ee1e02bb339caf4e95b91dad5803dd87f1b1f229eede", params: ["i32"], results: ["i32"] },
  mapId: { bodySha256: "6698663ffed7669e3fa3922260e1e773179b41a5147fd961af44acc157839914", params: ["i32"], results: ["i32"] },
  mapState: { bodySha256: "35cea95a660e3e1964f2fab0342b60c9a96ebc563638feceb328231fb97b27cd", params: ["i32", "i32"], results: [] },
  currentMap: { bodySha256: "c6e2e54332d133eb208974890b255570fb2fcc9a802ea52957b4a64116f7e72c", params: [], results: ["i32"] },
  instanceType: { bodySha256: "b9898076fd712f74e586f60df2a7e551c68db82b3726025815f46b78f32b8413", params: ["i32"], results: ["i32"] },
  playerNumber: { bodySha256: "3656f5655d9704c608247be52aaf1654141bce2db8f085c6cef4c967c7068acf", params: [], results: ["i32"] },
  worldContext: { bodySha256: "35541e26cd5badf9bbf37b1e7a57489cb762e5ecffcb0f90e4069d4c63bd4c09", params: ["i32"], results: ["i32"] },
  agentFields: { bodySha256: "b9d3e9ffd560b43d918aa004088193c11e51da699d754682f651b02b5cdb8ab4", params: ["i32"], results: [] },
  agentModel: { bodySha256: "cf152611218510e0d086fb2808834d0381f64c237c9b4ee185eabcd58a850a6b", params: ["i32", "i32", "i32"], results: ["i32"] },
  areaCount: { bodySha256: "dc05263b317b11744dc07fdd0ee520bf3d9811e9869580c570ff81959ef2fd9b", params: ["i32", "i32", "i32"], results: ["i32"] },
  areaFlags: { bodySha256: "1cc6aeaa4c4f9228ee4984a26506f2f72d2b6ad4aeec4e50b1dd019504516382", params: [], results: ["i32"] },
} as const satisfies Readonly<Record<string, ExactTargetRole>>);

const TARGET_IMMUTABLE_HASHES = Object.freeze({
  manualAssertion: "d78c3ee557d2b4d2c335ea85a1c6e7088d894236e0225360d92942da98c54b7d",
  automaticAssertion: "ee8a8e207854674610e42099c03590270b556c9cd482de0bfca76959939d74c6",
  resetNameA: "b940a3cd95df2f76fb27d3e23ef929c3c97753dde164ca08802c0b2554833642",
  resetNameB: "9ffea7f8a640d2d966ff61fb7479893422ac8aae7b39f74205e41095926d7f7c",
  areaAssertion: "bbba85bc88debef8198061f3c1c86cf0c7051c7cb0752f8ca670bcace10d03fe",
  areaTable: "3a4564fe4b92b8e2a4e048000ccd924d1f1ee68d15e24a63dd6e05a9683a88bc",
});

const GAME_THREAD_DRAIN_ROLE = semanticRole(
  764,
  "aa1694915623017676dffcba6b54ef5570b4029e9c9258f8b8e00480e5d37c99",
  Object.freeze([
    ...mutableSpans([
      [29, 34, "frame.clock"], [80, 85, "frame.clock"],
      [108, 113, "frame.previous"], [136, 141, "frame.previous"],
      [153, 158, "frame.ready"], [166, 171, "frame.clock"],
      [175, 180, "frame.elapsed"], [183, 188, "frame.elapsed"],
      [199, 204, "frame.elapsed"], [220, 225, "frame.elapsed"],
      [232, 237, "frame.clock"], [365, 370, "frame.flag"],
      [396, 401, "frame.guard"], [432, 437, "frame.guard"],
      [442, 447, "frame.flag"], [469, 474, "frame.state"],
      [483, 488, "frame.counter"], [495, 500, "frame.counter"],
      [516, 521, "frame.buffer.end"], [536, 541, "frame.buffer.payload"],
      [560, 565, "frame.buffer.start"], [569, 574, "frame.state"],
      [589, 594, "frame.pending"], [623, 628, "frame.pending"],
      [641, 646, "frame.state"], [651, 656, "frame.buffer.start"],
      [675, 680, "frame.pending"], [685, 690, "frame.buffer.start"],
      [706, 711, "frame.flag"],
    ]),
    { start: 253, end: 258, role: "frame.assertion", addressClass: "immutable-data" },
  ]),
  ["i32", "i32"],
  [],
);

const CHAT_ALIASES_ROLE = semanticRole(
  380,
  "c35aa3256d466c5fd5d704d5b069b0faed1d7884c62158b38b3ba0aecf307545",
  mutableSpans([
    [50, 55, "aliases.flag"], [63, 68, "aliases.state"],
    [74, 79, "aliases.cursor"], [85, 90, "aliases.end"],
    [96, 101, "aliases.enabled"], [102, 107, "aliases.state"],
    [110, 115, "aliases.buffer"], [148, 153, "aliases.flag"],
    [195, 200, "aliases.compare"], [248, 253, "aliases.state"],
  ]),
  ["i32", "i32"],
  ["i32"],
);

const XUNLAI_AGENT_READER_ROLE = semanticRole(
  418,
  "fde5f7f940fb4ab5b55f85290897f47f341056b983514a6b0e03bb6f149aff8d",
  Object.freeze([
    { start: 17, end: 22, role: "xunlai.assertion", addressClass: "immutable-data" },
    { start: 29, end: 31, role: "xunlai.source-line", addressClass: "immutable-data" },
  ]),
  ["i32"],
  ["i32"],
);

const XUNLAI_ACCESS_READER_ROLE = semanticRole(
  85,
  "ea782429f5a29731780e4c962909963b7a00b01f59b5122ec0c9ae292905ba09",
  Object.freeze([
    { start: 17, end: 22, role: "xunlai.assertion", addressClass: "immutable-data" },
    { start: 29, end: 31, role: "xunlai.source-line", addressClass: "immutable-data" },
  ]),
  ["i32"],
  ["i32"],
);

const LOCAL_ACTION_HASHES = Object.freeze({
  uiDispatcher: "ba41a2237bc91373cdee67ad8cfff700b80a2e351b7e980f37d68690307de4c0",
  travelProducer: "47c2f33dc98226fbb1596d60b2dfe76a9a19f645e94330a0582a6dc50d5be595",
  xunlaiHandler: "0a46adca4dd597f9430c23457f6ce6ff7ccdfbdaf4a77b449a8158e2c595189a",
  xunlaiPlayerReader: "b98af3eb50f4c2aa1bc09f0a88712e32a2a14fe0d013126e1e4c0e842008e01f",
  areaTypeReader: "9786e68238b6a2559646f8e0594b3d4ee808003f11ec775a475e337e7dd9aa90",
  frameAssertion: "1db4beca1a3d246ce3f4df09cfdd2a3e60c5cef5564d0361474f7f9cb3c95026",
  xunlaiAssertion: "df83cbe4386b6f8641568f5d2b6444c941f6d448a7efffd9f4737e343b0972d2",
});

const PARTY_WORLD_LIFECYCLE_ROLE = semanticRole(
  3_279,
  "878f00dc4ea68f51e5a79f507e37b0a5df3c32b561ca6d35c966a888d0cd022b",
  Object.freeze([
    { start: 1_342, end: 1_347, role: "world.assert-a", addressClass: "immutable-data" },
    { start: 1_395, end: 1_400, role: "world.assert-b", addressClass: "immutable-data" },
  ]),
  ["i32"],
  ["i32"],
);

const PARTY_PLAYER_PARTY_ROLE = semanticRole(
  338,
  "bb32ba98f1f72dc96a720d9b81c2513b6ff6ab59e7d14c63a125274a6f0b2ce4",
  Object.freeze([
    { start: 241, end: 246, role: "party.membership-assertion", addressClass: "immutable-data" },
  ]),
  ["i32", "i32", "i32", "i32"],
  [],
);

const PARTY_SKILLBAR_UPDATE_ROLE = semanticRole(
  468,
  "c5076fb582377edf6be0a51464ecae499039e7523bc4473b035ba8054381053e",
  Object.freeze([
    { start: 45, end: 50, role: "skillbar.assertion", addressClass: "immutable-data" },
  ]),
  [],
  [],
);

const TEAM_SENDER_ROLE = semanticRole(
  4_425,
  "1dbcd6d20afed3f8edc323c4ddaa323e24809c439041a069f1eace6d127cc73f",
  Object.freeze([
    { start: 115, end: 120, role: "sender.assert-bytes", addressClass: "immutable-data" },
    { start: 3_526, end: 3_531, role: "sender.assert-string-length", addressClass: "immutable-data" },
    { start: 4_198, end: 4_203, role: "sender.assert-struct-count", addressClass: "immutable-data" },
    { start: 4_390, end: 4_395, role: "sender.assert-switch", addressClass: "immutable-data" },
  ]),
  ["i32", "i32", "i32"],
  [],
);

const PARTY_EXACT_ROLES = Object.freeze({
  partyInfoLifecycle: { bodySha256: "02c381bb2f7b2a7edea00c8de3d72838189ba696f9ce2b0177d7425d45267cb2", params: ["i32"], results: ["i32"] },
  partyFlagWriter: { bodySha256: "00c8389a18427716101fe4df4176a5b87f3752776e93fe06105610e0d45a363e", params: ["i32", "i32"], results: [] },
  accountUnlockWriter: { bodySha256: "1f8e8bf7fe1ca37a0f266812bc3e1bff28c14104aeb38d009a340851e8f5c582", params: ["i32"], results: [] },
  heroFlagWriter: { bodySha256: "070a5db14e06aeec2fa812e6c82d5f17964585ea277381485f2b1707d54ceef1", params: ["i32", "i32", "i32"], results: [] },
  attributesWriter: { bodySha256: "2db063ee4b22d5eb7a5376313fdacc32377153dc3981b5dfe852729a17369c23", params: ["i32", "i32", "i32"], results: [] },
  professionAgent: { bodySha256: "ff540acea56ffbc5947288f9d461495e1970006fba7799ffd9d2b1dae1d06b93", params: ["i32", "i32"], results: ["i32"] },
  professionPrimary: { bodySha256: "5b3490ae4c66dad083b8cbea456d2e47d41ff794e9c03aa15acdf2b6523915ec", params: ["i32", "i32"], results: ["i32"] },
  professionSecondary: { bodySha256: "92fe2aa71777d546d797a4f7850cb59b1693f3b2937021dd5cebc85933403e07", params: ["i32", "i32"], results: ["i32"] },
  professionUnlocked: { bodySha256: "7a1b17e51097a6599a036629fdcc630afa0850bacb0f2998d0ad8107d39ec9b5", params: ["i32", "i32"], results: ["i32"] },
  skillbarReader: { bodySha256: "7b8b5c65a126fae2edfa517a4706244a0d2352c628fde208d049ecf82dfa4e72", params: ["i32", "i32", "i32"], results: ["i32"] },
  skillSlotReader: { bodySha256: "ee41be1f4dcaf8e5822fc024e41cbbad74cf293cdafb2b89a8691aeb680e68b5", params: ["i32", "i32", "i32"], results: ["i32"] },
  characterUnlockReader: { bodySha256: "0b6f7cf85a4b4f8c34b1cfadc63857a043a1b7fd710ba94c8db3a409d6bd092b", params: ["i32", "i32"], results: [] },
} as const);

const PARTY_DIRTY_ROLES = Object.freeze([
  semanticRole(622, "07d8d87f5575c572d3f53fcff464cd07fba710f1a01e451d94a414f28b55ba26", Object.freeze([
    { start: 580, end: 585, role: "party.ui", addressClass: "function-index" },
  ]), ["i32", "i32", "i32", "i32", "i32"], []),
  semanticRole(683, "4276027f9ac9dada4d236934c4a7170f22004934fdba19376e620e0aa14f6654", Object.freeze([
    { start: 665, end: 670, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 15 }, () => "i32"), []),
  semanticRole(127, "509bab21ca8be2a1f6287793e50f88825bb1d9f4432d3b29e3a394b117a72d3a", Object.freeze([
    { start: 88, end: 93, role: "map.lifecycle-static", addressClass: "mutable-static" },
    { start: 119, end: 124, role: "party.ui", addressClass: "function-index" },
  ]), ["i32", "i32"], ["i32"]),
  semanticRole(262, "157e15c62319c9bdff7b46e8b0ce504c52af0b6eee0faddd1b1d94eb90f2df7b", Object.freeze([
    { start: 120, end: 125, role: "party.ui", addressClass: "function-index" },
  ]), ["i32", "i32", "i32", "f32", "i32", "i32"], []),
  semanticRole(186, "6f06eff3b66948891fe3e291a62709706f41b2a47dfb20c00054655f917ed187", Object.freeze([
    { start: 169, end: 174, role: "party.ui", addressClass: "function-index" },
  ]), ["i32", "i32"], []),
  semanticRole(288, "3891f1163ce484f0244b5e16308b3a8d08eb95dbebf143fe2681af6112099468", Object.freeze([
    { start: 109, end: 114, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 9 }, () => "i32"), []),
  semanticRole(305, "4b39d0c5b6cd8be2bdbf8d6289b06f0206074ef0fa24e772cb4d34f2b774bb7f", Object.freeze([
    { start: 279, end: 284, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 8 }, () => "i32"), []),
  semanticRole(459, "a24e6314fed15093fce5c54faefe9ed8936e243b2a06e96c2401214b254b9125", Object.freeze([
    { start: 408, end: 413, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 4 }, () => "i32"), []),
  semanticRole(279, "ff174e8924bfb8ccdec3614b64ec884f499348d0430c137019295d451860b35e", Object.freeze([
    { start: 238, end: 243, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 3 }, () => "i32"), []),
  semanticRole(256, "c6c049152fba5d01560c74f2bc4ffac8a9133671f7d9ee8fc1e5d0c09b4e2b8b", Object.freeze([
    { start: 238, end: 243, role: "party.ui", addressClass: "function-index" },
  ]), Array.from({ length: 3 }, () => "i32"), []),
] as const);

const PARTY_IMMUTABLE_HASHES = Object.freeze({
  playerPartyAssertion: "11e293befd3a98a58c54d320146aab4746f2456cfe5fefd40eca2c48d28366bb",
  skillbarAssertion: "f450663f1e90de4ae2e581b6dc777b81f6c9e019bff3e5d2e60665099862e3f0",
  worldAssertionA: "435ae0e5b5663ba229fe0a312a2f3d83b4896302f9517b56d88f996ba7ea896d",
  worldAssertionB: "f7d0c7a8263c7a799862d8a513123d901e4f1cc30bc1d86da870bf5f2ec5aad6",
});

const TEAM_SENDER_IMMUTABLE_HASHES = Object.freeze([
  "1627a8bdcb297de40efb0cab4028bd069275d993bfe52cf1ea517e738427af4f",
  "52cfe327ad6c66540cb88272f04b99f45fcc9c0d3a2f6d2cc1d43d0d6d57ba75",
  "3be8fd491431691c04b545a9c691266e90592a747c964587f21f408067fda424",
  "3a27ab5c8418fcef888b2aff7a1dfd56fc9de2aa53789b29f4f0c4debe2c3dc4",
] as const);

const TEAM_BUILDER_ROLES = Object.freeze([
  { opcode: 31, length: 65, fingerprint: "008cb3c8aa865ef17bf262bde0eeb10d29cd4f19a89a9ed22132a811835a39c6", opcodeAt: 30, constructorAt: 35, senderAt: 48 },
  { opcode: 30, length: 65, fingerprint: "f7f2072bfcde3b833ff1c388e9e1190936fde208e69e8363b732ea3944ce4f7b", opcodeAt: 30, constructorAt: 35, senderAt: 48 },
  { opcode: 21, length: 72, fingerprint: "91693fa5820bda13bf3b39eede0b8b9fb36d7f82a8a5c23e086505f0510a3cb2", opcodeAt: 37, constructorAt: 42, senderAt: 55 },
  { opcode: 93, length: 218, fingerprint: "b5406c64785a6e2559a238e271085d119d34fc45c36a2a4dd404ec2f09a67625", opcodeAt: 30, constructorAt: 188, senderAt: 201 },
  { opcode: 65, length: 73, fingerprint: "66d6960cf4f889c97977b4f8ae79461e0f7034b22c24af50bc19ac9ea4803226", opcodeAt: 37, constructorAt: 43, senderAt: 56 },
  { opcode: 16, length: 289, fingerprint: "711990b1affb366ad198616fd59fa6802e0ff1644070b2fa46d844556d5be8f7", opcodeAt: 31, constructorAt: 260, senderAt: 271 },
  { opcode: 155, length: 66, fingerprint: "b2ec78d3eaa13c6a4ec8265dd5bfbbc7611d17a61e8361b37849522f43dc38d2", opcodeAt: 30, constructorAt: 36, senderAt: 49 },
] as const);

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
  const matches = roleFunctions(module, role);
  return matches.length === 1 ? matches[0]! : null;
}

function roleFunctions(module: ModuleShape, role: CursorRole): number[] {
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
  }
  return matches;
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

function encodedU32(body: Uint8Array, start: number, end: number): number {
  const cursor = { value: start };
  const value = readUnsigned(body, cursor);
  if (cursor.value !== end) {
    throw new EvidenceError("module-shape-unsupported");
  }
  return value;
}

function unsignedOperand(body: Uint8Array, start: number): number {
  const cursor = { value: start };
  return readUnsigned(body, cursor);
}

function signedOperand(body: Uint8Array, start: number): number {
  const cursor = { value: start };
  return readSigned(body, cursor, 5);
}

function paddedOperand(value: number): Uint8Array {
  const bytes = new Uint8Array(5);
  let remaining = value >>> 0;
  for (let index = 0; index < 4; index += 1) {
    bytes[index] = (remaining & 0x7f) | 0x80;
    remaining >>>= 7;
  }
  bytes[4] = remaining & 0x0f;
  return bytes;
}

function codeOperandOccurrences(module: ModuleShape, value: number): number {
  const needle = paddedOperand(value);
  let count = 0;
  for (const body of module.bodies) {
    for (let offset = 0; offset <= body.byteLength - needle.byteLength; offset += 1) {
      if (needle.every((byte, index) => body[offset + index] === byte)) count += 1;
    }
  }
  return count;
}

function staticBytes(
  module: ModuleShape,
  address: number,
  length: number,
): Uint8Array | null {
  if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length) || length < 0) {
    return null;
  }
  for (const segment of module.dataSegments) {
    const offset = address - segment.base;
    if (offset >= 0 && offset + length <= segment.bytes.byteLength) {
      return segment.bytes.subarray(offset, offset + length);
    }
  }
  return null;
}

function staticCStringHash(module: ModuleShape, address: number): string | null {
  for (const segment of module.dataSegments) {
    const offset = address - segment.base;
    if (offset < 0 || offset >= segment.bytes.byteLength) continue;
    const end = segment.bytes.indexOf(0, offset);
    if (end < 0 || end - offset > 4_096) return null;
    return createHash("sha256")
      .update(segment.bytes.subarray(offset, end + 1))
      .digest("hex");
  }
  return null;
}

function staticBytesHash(
  module: ModuleShape,
  address: number,
  length: number,
): string | null {
  const bytes = staticBytes(module, address, length);
  return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
}

function valuesForRole(body: Uint8Array, role: CursorRole): Map<string, number[]> {
  const values = new Map<string, number[]>();
  for (const span of role.spans) {
    const group = values.get(span.role) ?? [];
    group.push(encodedU32(body, span.start, span.end));
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

function exactTargetFunction(
  module: ModuleShape,
  role: ExactTargetRole,
): number | null {
  return uniqueExactFunction(module, role.bodySha256, role.params, role.results);
}

function deriveObservationLayout(
  module: ModuleShape,
): EnhancementObservationBaseLayout | null {
  const contextFunction = uniqueRoleFunction(module, TARGET_CONTEXT_ROOT_ROLE);
  const agentAccessorFunction = uniqueRoleFunction(module, AGENT_ARRAY_ACCESSOR_ROLE);
  const areaLookupFunction = uniqueRoleFunction(module, AREA_LOOKUP_ROLE);
  const exact = Object.fromEntries(Object.entries(EXACT_TARGET_ROLES).map(
    ([name, role]) => [name, exactTargetFunction(module, role)],
  )) as Record<keyof typeof EXACT_TARGET_ROLES, number | null>;
  if (
    contextFunction === null || agentAccessorFunction === null
    || areaLookupFunction === null
    || Object.values(exact).some((value) => value === null)
  ) return null;

  const context = valuesForRole(functionBody(module, contextFunction), TARGET_CONTEXT_ROOT_ROLE);
  const accessor = valuesForRole(functionBody(module, agentAccessorFunction), AGENT_ARRAY_ACCESSOR_ROLE);
  const area = valuesForRole(functionBody(module, areaLookupFunction), AREA_LOOKUP_ROLE);
  const contextRoot = soleValue(context, "context.root");
  const agentArray = soleValue(accessor, "agent-array.base");
  const agentArraySize = soleValue(accessor, "agent-array.size");
  const lifecycleMatches = roleFunctions(module, AGENT_ARRAY_LIFECYCLE_ROLE).filter(
    (functionIndex) => {
      const values = valuesForRole(
        functionBody(module, functionIndex), AGENT_ARRAY_LIFECYCLE_ROLE,
      );
      return soleValue(values, "agent-array.base") === agentArray
        && soleValue(values, "agent-array.size") === agentArraySize;
    },
  );
  if (lifecycleMatches.length !== 1) return null;
  const areaInfo = soleValue(area, "area.table");
  if (
    agentArraySize !== agentArray + 8
    || codeOperandOccurrences(module, contextRoot) !== 6
    || codeOperandOccurrences(module, agentArray) !== 41
    || codeOperandOccurrences(module, agentArraySize) !== 41
    || codeOperandOccurrences(module, areaInfo) !== 1
    || commonRelocationDelta([
      [contextRoot, 0x5a0ee0], [agentArray, 0x5a4e58],
      [agentArraySize, 0x5a4e60], [areaInfo, 0x1cc630],
    ]) === null
  ) return null;

  if (
    staticCStringHash(module, soleValue(area, "area.assert-name"))
      !== TARGET_IMMUTABLE_HASHES.areaAssertion
  ) return null;

  const body = (name: keyof typeof EXACT_TARGET_ROLES) =>
    functionBody(module, exact[name]!);
  const contextBody = functionBody(module, contextFunction);
  const areaBody = functionBody(module, areaLookupFunction);
  const observation: EnhancementObservationBaseLayout = {
    contextRoot,
    agentArray,
    gameContextSlot: unsignedOperand(contextBody, 17),
    characterContext: unsignedOperand(body("gameCharacter"), 5),
    mapId: unsignedOperand(body("mapId"), 39),
    isExplorable: unsignedOperand(body("mapState"), 37),
    currentMapId: unsignedOperand(body("currentMap"), 11),
    currentInstanceType: unsignedOperand(body("instanceType"), 5),
    playerNumber: unsignedOperand(body("playerNumber"), 11),
    agentId: unsignedOperand(body("agentFields"), 899),
    agentX: unsignedOperand(body("agentFields"), 395),
    agentY: unsignedOperand(body("agentFields"), 367),
    agentType: unsignedOperand(body("agentFields"), 99),
    agentPlayerNumber: unsignedOperand(body("agentFields"), 927),
    agentModelType: unsignedOperand(body("agentModel"), 393),
    worldContext: unsignedOperand(body("worldContext"), 81),
    areaInfo,
    areaInfoCount: unsignedOperand(body("areaCount"), 36),
    areaInfoStride: unsignedOperand(areaBody, 36),
    areaInfoFlags: unsignedOperand(body("areaFlags"), 21),
  };
  if (
    unsignedOperand(body("agentModel"), 365) !== observation.agentPlayerNumber
    || unsignedOperand(areaBody, 6) < observation.areaInfoCount
  ) return null;
  const table = staticBytes(
    module,
    observation.areaInfo,
    unsignedOperand(areaBody, 6) * observation.areaInfoStride,
  );
  if (
    !table
    || createHash("sha256").update(table).digest("hex")
      !== TARGET_IMMUTABLE_HASHES.areaTable
  ) return null;

  return verifyLayout(observation, {
    contextRoot: { sourceRole: "context-root-writer", expression: "relocated static store", occurrences: [11] },
    agentArray: { sourceRole: "agent-array lifecycle+accessor", expression: "base static", occurrences: [9, 34, 27] },
    gameContextSlot: { sourceRole: "context-root-writer", expression: "context registration slot", occurrences: [17] },
    characterContext: { sourceRole: "game-context character reader", expression: "i32.load offset", occurrences: [5] },
    mapId: { sourceRole: "map-id reader", expression: "i32.load offset", occurrences: [39] },
    isExplorable: { sourceRole: "map-state reader", expression: "map availability field", occurrences: [37] },
    currentMapId: { sourceRole: "character-context map reader", expression: "i32.load offset", occurrences: [11] },
    currentInstanceType: { sourceRole: "character-context instance reader", expression: "i32.load offset", occurrences: [5] },
    playerNumber: { sourceRole: "character-context player reader", expression: "i32.load offset", occurrences: [11] },
    agentId: { sourceRole: "agent snapshot copier", expression: "i32.load offset", occurrences: [899] },
    agentX: { sourceRole: "agent snapshot copier", expression: "f32.load offset", occurrences: [395] },
    agentY: { sourceRole: "agent snapshot copier", expression: "f32.load offset", occurrences: [367] },
    agentType: { sourceRole: "agent snapshot copier", expression: "i32.load offset", occurrences: [99] },
    agentPlayerNumber: { sourceRole: "agent snapshot+model readers", expression: "u16 offset", occurrences: [927, 365] },
    agentModelType: { sourceRole: "agent model reader", expression: "u16 offset", occurrences: [393] },
    worldContext: { sourceRole: "world-context slot reader", expression: "slot 19 field load", occurrences: [81] },
    areaInfo: { sourceRole: "area lookup+static content", expression: "unique immutable table", occurrences: [40] },
    areaInfoCount: { sourceRole: "published-area bound", expression: "finite exact bound", occurrences: [36] },
    areaInfoStride: { sourceRole: "area lookup", expression: "index multiplier", occurrences: [36] },
    areaInfoFlags: { sourceRole: "area flags reader", expression: "post-lookup load", occurrences: [21] },
  }).layout;
}

function deriveTargetLayout(
  module: ModuleShape,
  observation: EnhancementObservationBaseLayout,
): EnhancementTargetLayout | null {
  const selectorFunction = uniqueRoleFunction(module, TARGET_SELECTOR_ROLE);
  const resetFunction = uniqueRoleFunction(module, TARGET_RESET_ROLE);
  const callerFunction = uniqueRoleFunction(module, TARGET_CALLER_ROLE);
  if (
    selectorFunction === null || resetFunction === null || callerFunction === null
  ) return null;
  const selector = valuesForRole(functionBody(module, selectorFunction), TARGET_SELECTOR_ROLE);
  const reset = valuesForRole(functionBody(module, resetFunction), TARGET_RESET_ROLE);
  const caller = valuesForRole(functionBody(module, callerFunction), TARGET_CALLER_ROLE);
  const manualTargetAgentId = soleValue(selector, "target.manual");
  const automaticTargetAgentId = soleValue(selector, "target.automatic");
  if (
    manualTargetAgentId !== soleValue(reset, "target.manual")
    || manualTargetAgentId !== soleValue(caller, "target.manual")
    || automaticTargetAgentId !== soleValue(reset, "target.automatic")
    || automaticTargetAgentId !== soleValue(caller, "target.automatic")
    || manualTargetAgentId !== automaticTargetAgentId + 4
    || codeOperandOccurrences(module, manualTargetAgentId) !== 16
    || codeOperandOccurrences(module, automaticTargetAgentId) !== 18
    || commonRelocationDelta([
      [observation.contextRoot, 0x5a0ee0],
      [manualTargetAgentId, 0x5a394c],
      [automaticTargetAgentId, 0x5a3948],
    ]) === null
  ) return null;
  const selectorImmutable = valuesForRole(
    functionBody(module, selectorFunction), TARGET_SELECTOR_ROLE,
  );
  const resetImmutable = valuesForRole(
    functionBody(module, resetFunction), TARGET_RESET_ROLE,
  );
  if (
    staticCStringHash(module, soleValue(selectorImmutable, "target.assert-manual"))
      !== TARGET_IMMUTABLE_HASHES.manualAssertion
    || staticCStringHash(module, soleValue(selectorImmutable, "target.assert-automatic"))
      !== TARGET_IMMUTABLE_HASHES.automaticAssertion
    || staticCStringHash(module, soleValue(resetImmutable, "target.reset-name-a"))
      !== TARGET_IMMUTABLE_HASHES.resetNameA
    || staticCStringHash(module, soleValue(resetImmutable, "target.reset-name-b"))
      !== TARGET_IMMUTABLE_HASHES.resetNameB
  ) return null;
  const target = verifyLayout({ manualTargetAgentId, automaticTargetAgentId }, {
    manualTargetAgentId: { sourceRole: "target selector+reset+caller", expression: "manual target static", occurrences: [132, 312, 636, 7, 23, 40, 60] },
    automaticTargetAgentId: { sourceRole: "target selector+reset+caller", expression: "automatic target static", occurrences: [147, 332, 647, 18, 9, 76, 93] },
  }).layout;
  return target;
}

function callsAt(
  body: Uint8Array,
  operands: readonly number[],
  target: number,
): boolean {
  return operands.every((offset) => unsignedOperand(body, offset) === target);
}

function isolatedProof<Value>(proof: () => Value | null): Value | null {
  try {
    return proof();
  } catch {
    return null;
  }
}

function deriveGameThread(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
): KnownEnhancementBuild["gameThread"] | null {
  const functionIndex = uniqueRoleFunction(module, GAME_THREAD_DRAIN_ROLE);
  const expected = baseline.gameThread?.drain;
  if (functionIndex === null || !expected) return null;
  const body = functionBody(module, functionIndex);
  const values = valuesForRole(body, GAME_THREAD_DRAIN_ROLE);
  const delta = commonRelocationDelta([
    [soleValue(values, "frame.clock"), 0x5a2248],
    [soleValue(values, "frame.previous"), 0x5a2244],
    [soleValue(values, "frame.ready"), 0x5a21ec],
    [soleValue(values, "frame.elapsed"), 0x5a2250],
    [soleValue(values, "frame.flag"), 0x5a21f0],
    [soleValue(values, "frame.guard"), 0x5a2254],
    [soleValue(values, "frame.state"), 0x5a223c],
    [soleValue(values, "frame.counter"), 0x5a2258],
    [soleValue(values, "frame.buffer.end"), 0x15ac30],
    [soleValue(values, "frame.buffer.payload"), 0x15ac20],
    [soleValue(values, "frame.buffer.start"), 0x15ac10],
    [soleValue(values, "frame.pending"), 0x5a2240],
  ]);
  const slots = parseActiveTableRelations(module.elementSection).get(functionIndex) ?? [];
  if (
    delta === null
    || staticCStringHash(module, soleValue(values, "frame.assertion"))
      !== LOCAL_ACTION_HASHES.frameAssertion
    || slots.length !== 1
  ) return null;
  return Object.freeze({
    drain: Object.freeze({
      functionIndex,
      params: expected.params,
      results: expected.results,
      tableSlot: slots[0]!,
      bodySha256: functionBodySha256(module, functionIndex),
    }),
  });
}

function deriveXunlaiAccess(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
  observation: EnhancementObservationBaseLayout,
  handlerFunction: number,
): KnownEnhancementBuild["xunlaiAction"] | null {
  const expected = baseline.xunlaiAction;
  if (!expected) return null;
  const agentFunction = uniqueRoleFunction(module, XUNLAI_AGENT_READER_ROLE);
  const accessFunction = uniqueRoleFunction(module, XUNLAI_ACCESS_READER_ROLE);
  const playerFunction = uniqueExactFunction(
    module, LOCAL_ACTION_HASHES.xunlaiPlayerReader, ["i32"], ["i32"],
  );
  const areaTypeFunction = uniqueExactFunction(
    module, LOCAL_ACTION_HASHES.areaTypeReader, ["i32"], ["i32"],
  );
  if (
    agentFunction === null || accessFunction === null
    || playerFunction === null || areaTypeFunction === null
  ) return null;
  const agentBody = functionBody(module, agentFunction);
  const accessBody = functionBody(module, accessFunction);
  const playerBody = functionBody(module, playerFunction);
  const agentValues = valuesForRole(agentBody, XUNLAI_AGENT_READER_ROLE);
  const accessValues = valuesForRole(accessBody, XUNLAI_ACCESS_READER_ROLE);
  const agentLine = soleValue(agentValues, "xunlai.source-line");
  const accessLine = soleValue(accessValues, "xunlai.source-line");
  if (
    staticCStringHash(module, soleValue(agentValues, "xunlai.assertion"))
      !== LOCAL_ACTION_HASHES.xunlaiAssertion
    || staticCStringHash(module, soleValue(accessValues, "xunlai.assertion"))
      !== LOCAL_ACTION_HASHES.xunlaiAssertion
    || agentLine - 4_822 !== accessLine - 4_850
  ) return null;
  const worldPlayers = unsignedOperand(agentBody, 49);
  const playerRecordStride = unsignedOperand(agentBody, 146);
  const layout = verifyLayout({
    worldPlayers,
    playerRecordStride,
    playerRecordAgentId: unsignedOperand(agentBody, 416),
    playerRecordAccessFlags: unsignedOperand(accessBody, 78),
    playerRecordNumber: unsignedOperand(playerBody, 123),
    areaInfoType: unsignedOperand(functionBody(module, areaTypeFunction), 54),
  }, {
    worldPlayers: { sourceRole: "three player-record readers", expression: "WorldContext array field", occurrences: [49, 67, 108] },
    playerRecordStride: { sourceRole: "three player-record readers", expression: "record index multiplier", occurrences: [146, 72, 69, 118] },
    playerRecordAgentId: { sourceRole: "agent-id reader", expression: "record field load", occurrences: [416] },
    playerRecordAccessFlags: { sourceRole: "access-flags reader", expression: "record field load", occurrences: [78] },
    playerRecordNumber: { sourceRole: "player-number reader", expression: "record field address", occurrences: [123] },
    areaInfoType: { sourceRole: "area type reader", expression: "post-lookup field load", occurrences: [54] },
  }).layout;
  if (
    unsignedOperand(accessBody, 67) !== worldPlayers
    || unsignedOperand(playerBody, 108) !== worldPlayers
    || unsignedOperand(accessBody, 72) !== playerRecordStride
    || unsignedOperand(playerBody, 69) !== playerRecordStride
    || unsignedOperand(playerBody, 118) !== playerRecordStride
    || layout.areaInfoType >= observation.areaInfoStride
  ) return null;
  return Object.freeze({
    openExport: expected.openExport,
    configureExport: expected.configureExport,
    accessProof: Object.freeze({
      layout,
      readers: Object.freeze({
        "agent-id": Object.freeze({
          functionIndex: agentFunction, params: ["i32"] as const,
          results: ["i32"] as const, bodySha256: functionBodySha256(module, agentFunction),
        }),
        "access-flags": Object.freeze({
          functionIndex: accessFunction, params: ["i32"] as const,
          results: ["i32"] as const, bodySha256: functionBodySha256(module, accessFunction),
        }),
        "player-number": Object.freeze({
          functionIndex: playerFunction, params: ["i32"] as const,
          results: ["i32"] as const, bodySha256: functionBodySha256(module, playerFunction),
        }),
      }),
    }),
    handler: Object.freeze({
      functionIndex: handlerFunction,
      params: ["i32"] as const,
      results: [] as const,
      bodySha256: functionBodySha256(module, handlerFunction),
    }),
  });
}

function exactPartyFunction(
  module: ModuleShape,
  role: (typeof PARTY_EXACT_ROLES)[keyof typeof PARTY_EXACT_ROLES],
): number | null {
  return uniqueExactFunction(module, role.bodySha256, role.params, role.results);
}

function exactStaticBytesHash(
  module: ModuleShape,
  values: Map<string, number[]>,
  role: string,
  length: number,
  expected: string,
): boolean {
  return staticBytesHash(module, soleValue(values, role), length) === expected;
}

function derivePartyObservation(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
  observation: EnhancementObservationBaseLayout,
  uiDispatcher: NonNullable<KnownEnhancementBuild["uiDispatcher"]>,
  uiEvidence: NonNullable<PlayerChatUiEvidenceReport["candidate"]>,
): KnownEnhancementBuild["partyObservation"] | null {
  const expected = baseline.partyObservation;
  const baselineObservation = baseline.observationBase?.layout;
  if (!expected || !baselineObservation) return null;

  const partyInfoFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.partyInfoLifecycle);
  const partyFlagFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.partyFlagWriter);
  const accountFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.accountUnlockWriter);
  const flagFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.heroFlagWriter);
  const attributesFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.attributesWriter);
  const professionFunctions = [
    exactPartyFunction(module, PARTY_EXACT_ROLES.professionAgent),
    exactPartyFunction(module, PARTY_EXACT_ROLES.professionPrimary),
    exactPartyFunction(module, PARTY_EXACT_ROLES.professionSecondary),
    exactPartyFunction(module, PARTY_EXACT_ROLES.professionUnlocked),
  ];
  const skillbarReaderFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.skillbarReader);
  const skillSlotReaderFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.skillSlotReader);
  const characterUnlockFunction = exactPartyFunction(module, PARTY_EXACT_ROLES.characterUnlockReader);
  const worldFunction = uniqueRoleFunction(module, PARTY_WORLD_LIFECYCLE_ROLE);
  const playerPartyFunction = uniqueRoleFunction(module, PARTY_PLAYER_PARTY_ROLE);
  const skillbarUpdateFunction = uniqueRoleFunction(module, PARTY_SKILLBAR_UPDATE_ROLE);
  const dirtyFunctions = PARTY_DIRTY_ROLES.map((role) => uniqueRoleFunction(module, role));
  const infoFunction = dirtyFunctions[1] ?? null;
  const mapLoadedFunction = dirtyFunctions[2] ?? null;
  if (
    partyInfoFunction === null || partyFlagFunction === null || accountFunction === null
    || flagFunction === null || infoFunction === null || attributesFunction === null
    || professionFunctions.some((value) => value === null)
    || skillbarReaderFunction === null || skillSlotReaderFunction === null
    || characterUnlockFunction === null || worldFunction === null
    || playerPartyFunction === null || skillbarUpdateFunction === null
    || mapLoadedFunction === null || dirtyFunctions.some((value) => value === null)
  ) return null;

  const worldBody = functionBody(module, worldFunction);
  const playerPartyBody = functionBody(module, playerPartyFunction);
  const skillbarUpdateBody = functionBody(module, skillbarUpdateFunction);
  const mapLoadedBody = functionBody(module, mapLoadedFunction);
  const worldValues = valuesForRole(worldBody, PARTY_WORLD_LIFECYCLE_ROLE);
  const playerPartyValues = valuesForRole(playerPartyBody, PARTY_PLAYER_PARTY_ROLE);
  const skillbarValues = valuesForRole(skillbarUpdateBody, PARTY_SKILLBAR_UPDATE_ROLE);
  const mapValues = valuesForRole(mapLoadedBody, PARTY_DIRTY_ROLES[2]);
  if (
    staticCStringHash(module, soleValue(playerPartyValues, "party.membership-assertion"))
      !== PARTY_IMMUTABLE_HASHES.playerPartyAssertion
    || staticCStringHash(module, soleValue(skillbarValues, "skillbar.assertion"))
      !== PARTY_IMMUTABLE_HASHES.skillbarAssertion
    || !exactStaticBytesHash(module, worldValues, "world.assert-a", 12, PARTY_IMMUTABLE_HASHES.worldAssertionA)
    || !exactStaticBytesHash(module, worldValues, "world.assert-b", 12, PARTY_IMMUTABLE_HASHES.worldAssertionB)
    || commonRelocationDelta([
      [soleValue(mapValues, "map.lifecycle-static"), 1_447_112],
      [observation.contextRoot, baselineObservation.contextRoot],
    ]) === null
  ) return null;

  const dirtyMessages = [...expected.partyDirtyMessages];
  const decoded = decodeFunctions(module, dirtyMessages);
  for (let index = 0; index < dirtyMessages.length; index += 1) {
    const roleValues = valuesForRole(
      functionBody(module, dirtyFunctions[index]!),
      PARTY_DIRTY_ROLES[index]!,
    );
    if (soleValue(roleValues, "party.ui") !== uiDispatcher.functionIndex) return null;
    const relation = messageRelations(decoded, uiDispatcher.functionIndex, dirtyMessages[index]!)
      .filter((candidate) => candidate.producerFunctionIndex === dirtyFunctions[index]);
    if (relation.length !== 1 || relation[0]!.messageSites !== 1) return null;
  }

  const heroAddBody = functionBody(module, dirtyFunctions[6]!);
  const partyInfoBody = functionBody(module, partyInfoFunction);
  const partyFlagBody = functionBody(module, partyFlagFunction);
  const accountBody = functionBody(module, accountFunction);
  const flagBody = functionBody(module, flagFunction);
  const infoBody = functionBody(module, infoFunction);
  const attributesBody = functionBody(module, attributesFunction);
  const professionBodies = professionFunctions.map((value) => functionBody(module, value!));
  const skillbarReaderBody = functionBody(module, skillbarReaderFunction);
  const skillSlotReaderBody = functionBody(module, skillSlotReaderFunction);
  const characterUnlockBody = functionBody(module, characterUnlockFunction);

  const heroMemberStride = signedOperand(heroAddBody, 142);
  const skillbarSkills = unsignedOperand(skillbarUpdateBody, 352);
  const slotTotalOffset = unsignedOperand(skillSlotReaderBody, 144);
  const professionStateStride = unsignedOperand(professionBodies[0]!, 18);
  const layout: EnhancementPartyLayout = {
    partyContext: unsignedOperand(heroAddBody, 30),
    playerParty: unsignedOperand(playerPartyBody, 56),
    partyHeroes: unsignedOperand(heroAddBody, 111),
    heroMemberStride,
    heroAgentId: heroMemberStride + signedOperand(heroAddBody, 188),
    heroOwnerPlayerId: heroMemberStride + signedOperand(heroAddBody, 200),
    heroId: heroMemberStride + signedOperand(heroAddBody, 178),
    heroLevel: heroMemberStride + signedOperand(heroAddBody, 148),
    partyPlayers: unsignedOperand(partyInfoBody, 277),
    partyHenchmen: unsignedOperand(partyInfoBody, 242),
    partyFlag: unsignedOperand(partyFlagBody, 7),
    accountContextSlot: unsignedOperand(accountBody, 4),
    accountUnlockedSkills: unsignedOperand(accountBody, 12),
    worldHeroFlags: unsignedOperand(worldBody, 1_991),
    heroFlagStride: unsignedOperand(flagBody, 18),
    flagHeroId: 0,
    flagAgentId: unsignedOperand(flagBody, 63),
    flagBehavior: unsignedOperand(flagBody, 131),
    worldHeroInfo: unsignedOperand(worldBody, 1_953),
    heroInfoStride: unsignedOperand(infoBody, 35),
    infoHeroId: unsignedOperand(infoBody, 475),
    infoAgentId: unsignedOperand(infoBody, 468),
    infoLevel: unsignedOperand(infoBody, 461),
    infoPrimary: unsignedOperand(infoBody, 454),
    infoSecondary: unsignedOperand(infoBody, 447),
    infoAppearanceBitmap: unsignedOperand(infoBody, 412),
    worldSkillbars: unsignedOperand(worldBody, 983),
    skillbarStride: unsignedOperand(skillbarUpdateBody, 236),
    skillbarAgentId: unsignedOperand(skillbarReaderBody, 126),
    skillbarSkills,
    skillSlotStride: unsignedOperand(skillSlotReaderBody, 137),
    skillSlotId: slotTotalOffset - skillbarSkills,
    skillbarDisabled: unsignedOperand(skillbarReaderBody, 136),
    worldAttributes: unsignedOperand(worldBody, 2_826),
    attributeStride: unsignedOperand(attributesBody, 35),
    attributeAgentId: 0,
    attributeEntries: unsignedOperand(attributesBody, 198),
    attributeEntryStride: unsignedOperand(attributesBody, 181),
    attributeEntryId: 0,
    attributeEntryRank: 4,
    worldProfessionStates: unsignedOperand(worldBody, 1_213),
    professionStateStride,
    worldCharacterSkills: unsignedOperand(worldBody, 925),
  };
  if (
    unsignedOperand(playerPartyBody, 318) !== layout.playerParty
    || unsignedOperand(heroAddBody, 135) !== layout.partyHeroes
    || unsignedOperand(flagBody, 103) !== layout.heroFlagStride
    || unsignedOperand(flagBody, 119) !== layout.flagAgentId
    || [1, 2, 3].some((index) => unsignedOperand(professionBodies[index]!, 18) !== professionStateStride)
    || unsignedOperand(skillbarUpdateBody, 269) !== layout.skillbarStride
    || unsignedOperand(skillbarUpdateBody, 323) !== layout.skillbarStride
    || unsignedOperand(skillbarReaderBody, 18) !== layout.skillbarStride
    || unsignedOperand(skillSlotReaderBody, 18) !== layout.skillbarStride
    || unsignedOperand(characterUnlockBody, 70) !== layout.worldCharacterSkills
    || unsignedOperand(skillbarUpdateBody, 223) !== layout.worldSkillbars
  ) return null;

  const verified = verifyLayout(layout, {
    partyContext: { sourceRole: "PartyAddHero", expression: "GameContext PartyContext load", occurrences: [30, 213] },
    playerParty: { sourceRole: "party membership writer", expression: "matched load/store with shared party updater", occurrences: [56, 318] },
    partyHeroes: { sourceRole: "PartyAddHero+PartyInfo lifecycle", expression: "hero array field", occurrences: [111, 135, 207] },
    heroMemberStride: { sourceRole: "PartyAddHero", expression: "hero row multiplier", occurrences: [142] },
    heroAgentId: { sourceRole: "PartyAddHero", expression: "row end minus 24", occurrences: [188] },
    heroOwnerPlayerId: { sourceRole: "PartyAddHero", expression: "row end minus 20", occurrences: [200] },
    heroId: { sourceRole: "PartyAddHero", expression: "row end minus 16", occurrences: [178] },
    heroLevel: { sourceRole: "PartyAddHero", expression: "row end minus 4", occurrences: [148] },
    partyPlayers: { sourceRole: "PartyInfo lifecycle", expression: "player array clear", occurrences: [277] },
    partyHenchmen: { sourceRole: "PartyInfo lifecycle", expression: "henchman array clear", occurrences: [242] },
    partyFlag: { sourceRole: "party flag writer", expression: "field store followed by party updater", occurrences: [7] },
    accountContextSlot: { sourceRole: "account unlock writer", expression: "registered AccountContext slot", occurrences: [4] },
    accountUnlockedSkills: { sourceRole: "account unlock writer", expression: "AccountContext array field", occurrences: [12] },
    worldHeroFlags: { sourceRole: "WorldContext lifecycle", expression: "array clear field", occurrences: [1_991] },
    heroFlagStride: { sourceRole: "hero flag writer", expression: "binary-search row stride", occurrences: [18, 103] },
    flagHeroId: { sourceRole: "hero flag writer", expression: "first row key", occurrences: [0] },
    flagAgentId: { sourceRole: "hero flag writer", expression: "binary-search agent key", occurrences: [63, 119] },
    flagBehavior: { sourceRole: "hero flag writer", expression: "behavior store", occurrences: [131] },
    worldHeroInfo: { sourceRole: "WorldContext lifecycle", expression: "array clear field", occurrences: [1_953] },
    heroInfoStride: { sourceRole: "HeroDataAdded", expression: "hero-info row multiplier", occurrences: [35] },
    infoHeroId: { sourceRole: "HeroDataAdded", expression: "hero id store", occurrences: [475] },
    infoAgentId: { sourceRole: "HeroDataAdded", expression: "agent id store", occurrences: [468] },
    infoLevel: { sourceRole: "HeroDataAdded", expression: "level store", occurrences: [461] },
    infoPrimary: { sourceRole: "HeroDataAdded", expression: "primary profession store", occurrences: [454] },
    infoSecondary: { sourceRole: "HeroDataAdded", expression: "secondary profession store", occurrences: [447] },
    infoAppearanceBitmap: { sourceRole: "HeroDataAdded", expression: "appearance bitmap store", occurrences: [412] },
    worldSkillbars: { sourceRole: "WorldContext lifecycle+skillbar update", expression: "array field", occurrences: [983, 223] },
    skillbarStride: { sourceRole: "skillbar update+readers", expression: "row multiplier", occurrences: [236, 269, 323, 18] },
    skillbarAgentId: { sourceRole: "skillbar reader", expression: "first row key", occurrences: [126] },
    skillbarSkills: { sourceRole: "skillbar update", expression: "first repeated slot field", occurrences: [352] },
    skillSlotStride: { sourceRole: "skill slot reader", expression: "slot index multiplier", occurrences: [137] },
    skillSlotId: { sourceRole: "skillbar update+slot reader", expression: "total id offset minus slot base", occurrences: [144, 352] },
    skillbarDisabled: { sourceRole: "skillbar reader", expression: "disabled field load", occurrences: [136] },
    worldAttributes: { sourceRole: "WorldContext lifecycle", expression: "array clear field", occurrences: [2_826] },
    attributeStride: { sourceRole: "attribute writer", expression: "row multiplier", occurrences: [35, 68, 124] },
    attributeAgentId: { sourceRole: "attribute writer", expression: "first row key", occurrences: [0] },
    attributeEntries: { sourceRole: "attribute writer", expression: "entry table base", occurrences: [198] },
    attributeEntryStride: { sourceRole: "attribute writer", expression: "entry index multiplier", occurrences: [181] },
    attributeEntryId: { sourceRole: "attribute writer", expression: "first entry field", occurrences: [0] },
    attributeEntryRank: { sourceRole: "attribute writer", expression: "rank field following id", occurrences: [4] },
    worldProfessionStates: { sourceRole: "WorldContext lifecycle", expression: "array clear field", occurrences: [1_213] },
    professionStateStride: { sourceRole: "four profession readers", expression: "binary-search row stride", occurrences: [18, 18, 18, 18] },
    worldCharacterSkills: { sourceRole: "WorldContext lifecycle+unlock reader", expression: "bitset array field", occurrences: [925, 70] },
  }).layout;
  return Object.freeze({
    ...expected,
    partyDirtyMessages: Object.freeze(dirtyMessages) as typeof expected.partyDirtyMessages,
    playerChatProducer: uiEvidence.playerChatProducerFunctionIndex,
    nearbyPlayerMessageProducers: Object.freeze([
      uiEvidence.nearby7fProducerFunctionIndices[0]!,
      uiEvidence.nearby80ProducerFunctionIndices[0]!,
    ] as const),
    layout: verified,
  });
}

function deriveTeamApply(
  module: ModuleShape,
  baseline: KnownEnhancementBuild,
): KnownEnhancementBuild["teamApply"] | null {
  const expected = baseline.teamApply;
  if (!expected || expected.entries.length !== TEAM_BUILDER_ROLES.length) return null;
  const senderFunction = uniqueRoleFunction(module, TEAM_SENDER_ROLE);
  if (senderFunction === null) return null;
  const senderBody = functionBody(module, senderFunction);
  const senderValues = valuesForRole(senderBody, TEAM_SENDER_ROLE);
  const senderRoles = [
    "sender.assert-bytes", "sender.assert-string-length",
    "sender.assert-struct-count", "sender.assert-switch",
  ];
  if (senderRoles.some((role, index) =>
    staticCStringHash(module, soleValue(senderValues, role))
      !== TEAM_SENDER_IMMUTABLE_HASHES[index])) return null;

  let constructorFunction: number | null = null;
  const entries = TEAM_BUILDER_ROLES.map((role, index) => {
    const expectedEntry = expected.entries[index]!;
    const semantic = semanticRole(
      role.length,
      role.fingerprint,
      Object.freeze([
        { start: role.constructorAt, end: role.constructorAt + 5, role: "packet.constructor", addressClass: "function-index" },
        { start: role.senderAt, end: role.senderAt + 5, role: "packet.sender", addressClass: "function-index" },
      ]),
      expectedEntry.params,
      expectedEntry.results,
    );
    const functionIndex = uniqueRoleFunction(module, semantic);
    if (functionIndex === null) return null;
    const body = functionBody(module, functionIndex);
    const values = valuesForRole(body, semantic);
    const constructor = soleValue(values, "packet.constructor");
    if (constructorFunction !== null && constructorFunction !== constructor) return null;
    constructorFunction = constructor;
    if (
      soleValue(values, "packet.sender") !== senderFunction
      || unsignedOperand(body, role.opcodeAt) !== role.opcode
      || role.opcode !== expectedEntry.opcode
    ) return null;
    return Object.freeze({
      ...expectedEntry,
      functionIndex,
      bodySha256: functionBodySha256(module, functionIndex),
    });
  });
  if (constructorFunction === null || entries.some((entry) => entry === null)) return null;
  return Object.freeze({
    ...expected,
    professionTrace: Object.freeze({
      ...expected.professionTrace,
      sender: Object.freeze({
        ...expected.professionTrace.sender,
        functionIndex: senderFunction,
        bodySha256: functionBodySha256(module, senderFunction),
      }),
    }),
    entries: Object.freeze(entries) as typeof expected.entries,
  });
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

/**
 * Strict launch authority for read-only Target Distance on an unknown build.
 * Every pointer and structure offset is recovered from an independently
 * fingerprinted reader or writer. Relocated static data is accepted only when
 * its complete immutable content still matches.
 */
export function locateAutomaticTarget(
  input: Uint8Array,
  baselines: readonly KnownEnhancementBuild[],
): AutomaticTargetLocation | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const module = parseModule(input);
    const tick = tickEvidence(module).candidate;
    if (!tick) return null;
    const tickBody = functionBody(module, tick.functionIndex);
    if (!bodyMatchesRole(tickBody, CURSOR_TICK_ROLE)) return null;
    const observationLayout = deriveObservationLayout(module);
    if (!observationLayout) return null;
    const targetLayout = deriveTargetLayout(module, observationLayout);
    if (!targetLayout) return null;
    const matches = baselines.flatMap((baseline): AutomaticTargetLocation[] =>
      baseline.observationBase && baseline.targetObservation
      && signatureMatches(module, tick.functionIndex, baseline.hookParams, baseline.hookResults)
        ? [{
            baseline,
            hookFunction: tick.functionIndex,
            hookBodySha256: tick.bodySha256,
            observationLayout,
            targetLayout,
          }]
        : []);
    if (matches.length === 0) return null;
    const identity = (value: AutomaticTargetLocation) => JSON.stringify({
      hookFunction: value.hookFunction,
      observationLayout: value.observationLayout,
      targetLayout: value.targetLayout,
    });
    return matches.every((match) => identity(match) === identity(matches[0]!))
      ? matches[0]!
      : null;
  } catch {
    return null;
  }
}

/** Strict, independent authority for the three local action surfaces. */
export function locateAutomaticLocalActions(
  input: Uint8Array,
  baselines: readonly KnownEnhancementBuild[],
): AutomaticLocalActionsLocation | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const module = parseModule(input);
    const tick = tickEvidence(module).candidate;
    if (!tick || !bodyMatchesRole(functionBody(module, tick.functionIndex), CURSOR_TICK_ROLE)) {
      return null;
    }
    const locations: AutomaticLocalActionsLocation[] = [];
    for (const baseline of baselines) {
      const expectedUi = baseline.uiDispatcher;
      const party = baseline.partyObservation;
      if (!expectedUi || !party) continue;
      const decoded = decodeFunctions(module, {
        playerChatMessage: expectedUi.playerChatMessage,
        nearbyPlayerMessages: party.nearbyPlayerMessages,
      });
      const uiEvidence = playerChatUiEvidence(module, decoded, {
        playerChatMessage: expectedUi.playerChatMessage,
        nearbyPlayerMessages: party.nearbyPlayerMessages,
      }).candidate;
      const uiFunction = uiEvidence?.dispatcherFunctionIndex ?? null;
      const uiDispatcher = uiFunction !== null
        && functionBodySha256(module, uiFunction) === LOCAL_ACTION_HASHES.uiDispatcher
        ? Object.freeze({
            ...expectedUi,
            functionIndex: uiFunction,
            bodySha256: functionBodySha256(module, uiFunction),
          })
        : null;
      const gameThread = isolatedProof(() => deriveGameThread(module, baseline));

      const travelExpected = baseline.travelAction;
      const travelFunction = travelExpected
        ? uniqueExactFunction(
            module, LOCAL_ACTION_HASHES.travelProducer,
            travelExpected.producer.params, travelExpected.producer.results,
          )
        : null;
      const travelBody = travelFunction === null ? null : functionBody(module, travelFunction);
      const travelAction = uiDispatcher && gameThread && travelExpected && travelBody
        && unsignedOperand(travelBody, 169) === travelExpected.messageId
        && callsAt(travelBody, [132, 179], uiDispatcher.functionIndex)
        ? Object.freeze({
            ...travelExpected,
            producer: Object.freeze({
              ...travelExpected.producer,
              functionIndex: travelFunction!,
              bodySha256: functionBodySha256(module, travelFunction!),
            }),
          })
        : null;

      const handlerExpected = baseline.xunlaiAction?.handler;
      const handlerFunction = handlerExpected
        ? uniqueExactFunction(
            module, LOCAL_ACTION_HASHES.xunlaiHandler,
            handlerExpected.params, handlerExpected.results,
          )
        : null;
      const handlerBody = handlerFunction === null ? null : functionBody(module, handlerFunction);
      const observationLayout = isolatedProof(() => deriveObservationLayout(module));
      const xunlaiAction = uiDispatcher && gameThread && observationLayout
        && handlerBody
        && [85, 117, 159, 181, 200, 219].every(
          (offset, index) => unsignedOperand(handlerBody, offset) === 0x1000_0040 + index,
        )
        && callsAt(handlerBody, [98, 130, 172, 191, 210, 229], uiDispatcher.functionIndex)
        ? isolatedProof(() => deriveXunlaiAccess(
            module, baseline, observationLayout, handlerFunction!,
          ))
        : null;

      const aliasesExpected = baseline.chatAliases;
      const aliasFunction = aliasesExpected
        ? uniqueRoleFunction(module, CHAT_ALIASES_ROLE)
        : null;
      const aliasBody = aliasFunction === null ? null : functionBody(module, aliasFunction);
      const chatAliases = uiDispatcher && aliasesExpected && aliasBody
        && unsignedOperand(aliasBody, 316) === 0x1000_019d
        && unsignedOperand(aliasBody, 335) === 0x1000_019e
        && callsAt(aliasBody, [326, 345], uiDispatcher.functionIndex)
        ? Object.freeze({
            parser: Object.freeze({
              ...aliasesExpected.parser,
              functionIndex: aliasFunction!,
              bodySha256: functionBodySha256(module, aliasFunction!),
            }),
          })
        : null;
      const partyObservation = uiDispatcher && observationLayout && uiEvidence
        ? isolatedProof(() => derivePartyObservation(
            module, baseline, observationLayout, uiDispatcher, uiEvidence,
          ))
        : null;
      const teamApply = partyObservation && gameThread
        ? isolatedProof(() => deriveTeamApply(module, baseline))
        : null;
      if (!travelAction && !xunlaiAction && !chatAliases && !partyObservation) continue;
      locations.push(Object.freeze({
        baseline,
        hookFunction: tick.functionIndex,
        hookBodySha256: tick.bodySha256,
        observationLayout: xunlaiAction || partyObservation ? observationLayout : null,
        uiDispatcher,
        gameThread: travelAction || xunlaiAction || teamApply ? gameThread : null,
        travelAction,
        xunlaiAction,
        chatAliases,
        partyObservation,
        teamApply,
      }));
    }
    if (locations.length === 0) return null;
    const identity = (value: AutomaticLocalActionsLocation) => JSON.stringify({
      hookFunction: value.hookFunction,
      observationLayout: value.observationLayout,
      uiDispatcher: value.uiDispatcher,
      gameThread: value.gameThread,
      travelAction: value.travelAction,
      xunlaiAction: value.xunlaiAction,
      chatAliases: value.chatAliases,
      partyObservation: value.partyObservation,
      teamApply: value.teamApply,
    });
    return locations.every((match) => identity(match) === identity(locations[0]!))
      ? locations[0]!
      : null;
  } catch {
    return null;
  }
}
