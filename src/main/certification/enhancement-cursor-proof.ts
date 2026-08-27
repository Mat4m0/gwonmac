/**
 * Feature-local structural authority for the native Guild Wars cursor.
 * It refuses changed or ambiguous event ownership.
 */
import { verifyLayout } from "./semantic-proof.js";
import { CLIENT_TICK_ROLE } from "./enhancement-client-hook-role.js";
import { tickEvidence } from "./enhancement-tick-evidence.js";
import {
  bodyMatchesRole,
  enhancementProofContext,
  functionBody,
  functionBodySha256,
  functionHasSignature,
  MAX_INPUT_BYTES,
  matchesEvidenceInput,
  mutableSpans,
  signatureEvidence,
  uniqueExactFunction,
  uniqueRoleFunction,
  valuesForRole,
  soleValue,
} from "./wasm-evidence.js";
import type { EnhancementProofContext } from "./wasm-evidence.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import type { EnhancementCursorLayout } from "../../shared/enhancement-config.js";
import type {
  AutomaticCursorLocation,
  SemanticRole,
} from "./enhancement-evidence-types.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

const CURSOR_PRODUCER_ROLES: readonly [SemanticRole, SemanticRole] = Object.freeze([
  Object.freeze({
    bodyLength: 1_099,
    fingerprint: "aa5940ad3b732088ba52c01622933fca7ae1127e81f413112153ea674d38a0ff",
    spans: Object.freeze([
      ...mutableSpans([
        [68, 73, "producer.busy"], [104, 109, "producer.busy"],
        [688, 693, "producer.scratch"], [712, 717, "cursor.color-buffer"],
        [742, 747, "producer.scratch"], [761, 766, "cursor.color-buffer"],
        [772, 777, "producer.scratch-plus-one"],
        [798, 803, "cursor.color-buffer"], [829, 834, "cursor.color-buffer"],
        [835, 840, "producer.scratch"], [1075, 1080, "producer.busy"],
      ]),
      { start: 77, end: 82, role: "producer.updating-assert", addressClass: "immutable-data" as const },
      { start: 83, end: 88, role: "producer.source-file", addressClass: "immutable-data" as const },
      { start: 580, end: 585, role: "producer.array-source", addressClass: "immutable-data" as const },
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

const CURSOR_ART_RENDERER_ROLE: SemanticRole = Object.freeze({
  bodyLength: 277,
  fingerprint: "539c4f2f58df94f79a13441626ba0847181d55070e601c89245c052b7ac7cb40",
  spans: Object.freeze([
    ...mutableSpans([
      [84, 89, "cursor.art-cache-a"],
      [90, 95, "cursor.art-cache-b"],
      [148, 153, "cursor.scale"],
    ]),
    { start: 32, end: 37, role: "renderer.texture-assert", addressClass: "immutable-data" as const },
    { start: 38, end: 43, role: "renderer.source-file", addressClass: "immutable-data" as const },
  ]),
  params: Object.freeze(["i32", "i32"]),
  results: Object.freeze([]),
});

const CURSOR_STATE_READER_ROLE: SemanticRole = Object.freeze({
  bodyLength: 102,
  fingerprint: "31bd16b381bde0d9be77a421877194b870e95014ae46764982fa335d07dacb9a",
  spans: Object.freeze([
    ...mutableSpans([
      [9, 14, "cursor.software-model"],
      [20, 25, "cursor.show-count"],
      [36, 41, "cursor.active-art"],
    ]),
    { start: 49, end: 54, role: "state.texture-assert", addressClass: "immutable-data" as const },
    { start: 55, end: 60, role: "state.source-file", addressClass: "immutable-data" as const },
  ]),
  params: Object.freeze([]),
  results: Object.freeze([]),
});

const CURSOR_TABLE_AFTER_ROLE: SemanticRole = Object.freeze({
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

function deriveCursorLayout(
  context: EnhancementProofContext,
  producerFunctions: readonly [number, number],
): EnhancementCursorLayout | null {
  const module = context.moduleView();
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
  const uniqueCString = (values: Map<string, number[]>, role: string, expected: string) => {
    const address = soleValue(values, role);
    const encoded = new TextEncoder().encode(`${expected}\0`);
    return context.data.readCString(address) === expected
      && context.data.addresses(encoded).length === 1;
  };
  if (
    !uniqueCString(producerOne, "producer.updating-assert", "!s_updating")
    || !uniqueCString(producerOne, "producer.source-file", "../../../../Engine/Gr/Gles3/GlDev.cpp")
    || !uniqueCString(producerOne, "producer.array-source", "../../../../Base\\rtl\\Array.h")
    || !uniqueCString(renderer, "renderer.texture-assert", "m_texture")
    || !uniqueCString(renderer, "renderer.source-file", "../../../../Engine/Frame/FrCursor.cpp")
    || !uniqueCString(state, "state.texture-assert", "m_texture")
    || !uniqueCString(state, "state.source-file", "../../../../Engine/Frame/FrCursor.cpp")
  ) return null;
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
  suppliedContext?: EnhancementProofContext,
): AutomaticCursorLocation | null {
  if (!WebAssembly.validate(input) || input.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const context = matchesEvidenceInput(suppliedContext, input)
      ? suppliedContext
      : enhancementProofContext(input);
    if (!context) return null;
    const module = context.moduleView();
    const tick = tickEvidence(module).candidate;
    if (!tick) return null;
    const relations = context.tableRelations;
    const matches: AutomaticCursorLocation[] = [];
    for (const baseline of baselines) {
      const cursor = baseline.cursorEvent;
      if (!cursor) continue;
      const tickBody = functionBody(module, tick.functionIndex);
      const exactFamily = tick.bodySha256 === baseline.hookBodySha256;
      const semanticFamily = bodyMatchesRole(tickBody, CLIENT_TICK_ROLE);
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
      const producers = CURSOR_PRODUCER_ROLES.map((role) => {
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
      // Exact rows are regression evidence, never layout authority. Even a
      // retained binary must prove every address and field from its own code.
      const layout = deriveCursorLayout(
        context,
        producerFunctions,
      );
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
