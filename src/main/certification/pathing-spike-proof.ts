/**
 * Exact-client pathing shape evidence for the cartography research spike.
 * This module proves record shape only; it grants no production capability and
 * deliberately carries no owner-chain offsets or game-memory reader.
 */
import {
  functionBodySha256,
  signatureEvidence,
  wasmEvidence,
  type WasmEvidence,
} from "./wasm-evidence.js";
import type { DecodedFunction, MemoryOperandSite } from "./enhancement-evidence-types.js";

const ANCHORS = Object.freeze({
  bound: "def->trapezoidCount < 1024",
  index: "index < pathMap.trapezoidCount",
  infinite: "Failure: Infinite trapezoid bounds",
});
const EXPECTED_FUNCTIONS = Object.freeze({
  loader: 3208,
  converter: 3216,
  boundWriter: 3273,
  coordinateWriter: 3281,
  builder: 3288,
});
const EXPECTED_HASHES = Object.freeze({
  loader: "ff5dcae4a3610a874609316758affe178eaf5ae698a0826c55dc96229796c1fd",
  converter: "fca90c6024da65a96f19461a85ece6547528cd10841a77a35f8719c13858ab66",
  boundWriter: "5d0f51071e59d14fc4690cbc3e529d65a3240e9b757296ca5e87229b5562b53f",
  coordinateWriter: "45b114e3982a2433572cf1c9589398b47b0d8e4931958f80788c5efb08fcc715",
  builder: "47b1743a0f714bdb0c2d03ca8e6fb4ae4ef25278b29cff2f68ef5070f7ba50bc",
});

const I32_LOAD = 0x28;
const I32_LOAD16_U = 0x2f;
const F32_LOAD = 0x2a;
const F64_LOAD = 0x2b;
const F32_STORE = 0x38;
const I32_STORE16 = 0x3b;

export interface PathingShapeFacts {
  readonly converterCaller: number;
  readonly converterCallSiteOffset: number;
  readonly pathMapHolderOffset: number;
  readonly pathMapTrapezoidCount: number;
  readonly pathMapTrapezoidPointer: number;
  readonly liveStride: number;
  readonly livePortalFields: readonly number[];
  readonly liveCoordinateFields: readonly number[];
  readonly definitionCoordinateFields: readonly number[];
  readonly definitionReferenceMaximumExclusive: number;
}

export interface PathingShapeProof {
  readonly status: "shape-only";
  readonly clientSha256: string;
  readonly functions: Readonly<Record<keyof typeof EXPECTED_FUNCTIONS, Readonly<{
    functionIndex: number;
    bodySha256: string;
  }>>>;
  readonly facts: PathingShapeFacts;
  readonly refused: readonly [
    "game-context-to-map-context",
    "map-context-to-path-context",
    "path-context-to-static-data",
    "pathing-map-array",
    "total-trapezoid-bound",
  ];
}

const EXPECTED_FACTS: PathingShapeFacts = Object.freeze({
  converterCaller: EXPECTED_FUNCTIONS.loader,
  converterCallSiteOffset: 0x1b9,
  pathMapHolderOffset: 0x00,
  pathMapTrapezoidCount: 0x14,
  pathMapTrapezoidPointer: 0x18,
  liveStride: 0x30,
  livePortalFields: Object.freeze([0x14, 0x16]),
  liveCoordinateFields: Object.freeze([0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c]),
  definitionCoordinateFields: Object.freeze([0x14, 0x18, 0x1c, 0x20, 0x24, 0x28]),
  definitionReferenceMaximumExclusive: 1024,
});

function sameNumbers(actual: readonly number[], expected: readonly number[]): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

/** Mutation-test boundary for every shape value the spike is willing to claim. */
export function validPathingShapeFacts(candidate: PathingShapeFacts): boolean {
  return candidate.converterCaller === EXPECTED_FACTS.converterCaller
    && candidate.converterCallSiteOffset === EXPECTED_FACTS.converterCallSiteOffset
    && candidate.pathMapHolderOffset === EXPECTED_FACTS.pathMapHolderOffset
    && candidate.pathMapTrapezoidCount === EXPECTED_FACTS.pathMapTrapezoidCount
    && candidate.pathMapTrapezoidPointer === EXPECTED_FACTS.pathMapTrapezoidPointer
    && candidate.liveStride === EXPECTED_FACTS.liveStride
    && sameNumbers(candidate.livePortalFields, EXPECTED_FACTS.livePortalFields)
    && sameNumbers(candidate.liveCoordinateFields, EXPECTED_FACTS.liveCoordinateFields)
    && sameNumbers(
      candidate.definitionCoordinateFields,
      EXPECTED_FACTS.definitionCoordinateFields,
    )
    && candidate.definitionReferenceMaximumExclusive
      === EXPECTED_FACTS.definitionReferenceMaximumExclusive;
}

function containsOffsets(
  sites: readonly MemoryOperandSite[],
  opcode: number,
  expected: readonly number[],
): boolean {
  const actual = sites.filter((site) => site.opcode === opcode).map((site) => site.value);
  return expected.every((value) => actual.includes(value));
}

function exactSignature(
  evidence: WasmEvidence,
  functionIndex: number,
  params: readonly string[],
  results: readonly string[],
): boolean {
  const signature = signatureEvidence(evidence.moduleView(), functionIndex);
  return signature !== null
    && signature.params.length === params.length
    && signature.params.every((value, index) => value === params[index])
    && signature.results.length === results.length
    && signature.results.every((value, index) => value === results[index]);
}

function anchoredFunction(
  evidence: WasmEvidence,
  decoded: readonly DecodedFunction[],
  label: string,
): number | null {
  const addresses = evidence.data.addresses(new TextEncoder().encode(`${label}\0`));
  if (addresses.length !== 1) return null;
  const functions = decoded.filter((candidate) =>
    candidate.constantSites.some((site) => site.value === addresses[0])
  );
  return functions.length === 1 ? functions[0]!.functionIndex : null;
}

function decodedAt(
  decoded: readonly DecodedFunction[],
  functionIndex: number,
): DecodedFunction | null {
  return decoded.find((candidate) => candidate.functionIndex === functionIndex) ?? null;
}

function exactHash(
  evidence: WasmEvidence,
  key: keyof typeof EXPECTED_FUNCTIONS,
): boolean {
  return functionBodySha256(evidence.moduleView(), EXPECTED_FUNCTIONS[key])
    === EXPECTED_HASHES[key];
}

/**
 * Proves the exact pathing record shape. Whole-module identity is deliberately
 * not an invariant: unrelated ArenaNet changes may alter the client hash while
 * every pathing function and relation below remains byte-for-byte identical.
 */
export function certifyPathingShape(input: Uint8Array): PathingShapeProof | null {
  const evidence = wasmEvidence(input);
  if (!evidence) return null;
  const decoded = evidence.decodeFunctions([0x30, 1024]);
  const converter = decodedAt(decoded, EXPECTED_FUNCTIONS.converter);
  const loader = decodedAt(decoded, EXPECTED_FUNCTIONS.loader);
  const boundWriter = decodedAt(decoded, EXPECTED_FUNCTIONS.boundWriter);
  const coordinateWriter = decodedAt(decoded, EXPECTED_FUNCTIONS.coordinateWriter);
  const builder = decodedAt(decoded, EXPECTED_FUNCTIONS.builder);
  const converterCallers = decoded.filter(
    (candidate) => (candidate.calls.get(EXPECTED_FUNCTIONS.converter) ?? 0) > 0,
  );
  const converterCallSites = loader?.callSites.get(EXPECTED_FUNCTIONS.converter) ?? [];
  if (!converter || !loader || !boundWriter || !coordinateWriter || !builder) return null;
  if (
    anchoredFunction(evidence, decoded, ANCHORS.index) !== EXPECTED_FUNCTIONS.converter
    || anchoredFunction(evidence, decoded, ANCHORS.bound) !== EXPECTED_FUNCTIONS.boundWriter
    || anchoredFunction(evidence, decoded, ANCHORS.infinite)
      !== EXPECTED_FUNCTIONS.coordinateWriter
    || !Object.keys(EXPECTED_FUNCTIONS).every(
      (key) => exactHash(evidence, key as keyof typeof EXPECTED_FUNCTIONS),
    )
    || !exactSignature(evidence, EXPECTED_FUNCTIONS.loader, ["i32", "i32", "i32", "i32"], ["i32"])
    || !exactSignature(evidence, EXPECTED_FUNCTIONS.converter, ["i32", "i32", "i32", "i32"], ["i32"])
    || !exactSignature(evidence, EXPECTED_FUNCTIONS.boundWriter, ["i32", "i32", "i32"], [])
    || !exactSignature(evidence, EXPECTED_FUNCTIONS.coordinateWriter, ["i32", "i32", "i32"], [])
    || !exactSignature(evidence, EXPECTED_FUNCTIONS.builder, ["i32", "i32", "i32"], ["i32"])
    || converterCallers.length !== 1
    || converterCallers[0]?.functionIndex !== EXPECTED_FACTS.converterCaller
    || loader.calls.get(EXPECTED_FUNCTIONS.converter) !== 1
    || converterCallSites.length !== 1
    || converterCallSites[0]?.offset !== EXPECTED_FACTS.converterCallSiteOffset
    || builder.calls.get(EXPECTED_FUNCTIONS.coordinateWriter) !== 1
    || builder.calls.get(EXPECTED_FUNCTIONS.boundWriter) !== 1
    || converter.constantSites.filter((site) => site.value === 0x30).length !== 6
    || boundWriter.constantSites.filter((site) => site.value === 1024).length !== 1
    || !containsOffsets(converter.memorySites, I32_LOAD, [
      EXPECTED_FACTS.pathMapHolderOffset,
      EXPECTED_FACTS.pathMapTrapezoidCount,
      EXPECTED_FACTS.pathMapTrapezoidPointer,
    ])
    || !containsOffsets(converter.memorySites, I32_LOAD16_U, [0x10, 0x12])
    || !containsOffsets(converter.memorySites, I32_STORE16, [0x14, 0x16])
    || !containsOffsets(converter.memorySites, F32_LOAD, EXPECTED_FACTS.definitionCoordinateFields)
    || !containsOffsets(converter.memorySites, F32_STORE, EXPECTED_FACTS.liveCoordinateFields)
    || !containsOffsets(coordinateWriter.memorySites, F64_LOAD, [0x28, 0x30, 0x40, 0x48, 0x50, 0x60])
  ) return null;

  const functions = Object.fromEntries(
    Object.entries(EXPECTED_FUNCTIONS).map(([key, functionIndex]) => [key, Object.freeze({
      functionIndex,
      bodySha256: functionBodySha256(evidence.moduleView(), functionIndex),
    })]),
  ) as PathingShapeProof["functions"];
  return Object.freeze({
    status: "shape-only",
    clientSha256: evidence.inputSha256,
    functions: Object.freeze(functions),
    facts: EXPECTED_FACTS,
    refused: Object.freeze([
      "game-context-to-map-context",
      "map-context-to-path-context",
      "path-context-to-static-data",
      "pathing-map-array",
      "total-trapezoid-bound",
    ] as const),
  });
}
