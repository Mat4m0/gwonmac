/**
 * Feature-local authority for the SkillBar frame capture and its read-only
 * layout. The proof starts at the client's unique UTF-16 `SkillBar` label,
 * follows its one constructor call, and accepts the frame offsets only beside
 * the reviewed constructor, allocator, registrar, and ID resolver bodies.
 *
 * No address here is a nearest-match guess. A changed body, duplicate label,
 * changed call relation, or moved operand refuses only this capability.
 */
import {
  codeOperandOccurrences,
  decodeFunctions,
  functionBody,
  functionBodySha256,
  paddedOperand,
  signatureMatches,
  staticBytes,
  uniqueExactFunction,
  unsignedOperand,
} from "./wasm-evidence.js";
import type { EnhancementProofContext } from "./wasm-evidence.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import { indexOfBytes } from "../core/wasm-binary.js";
import { isDeepStrictEqual } from "node:util";

const INITIALIZER_SHA256 =
  "e4b1af23a4efcbb7fd1c484c4168553c91df5df7e1e40a65ff31bb4ca10790e1";
const CONSTRUCTOR_SHA256 =
  "a29fca1d30e5fa7dea1ca30f6453acbb8a099e4423c1f05ee43b01cfc3045c41";
const ALLOCATOR_SHA256 =
  "171af12f08fe6eda12961dcc504620c6e5b6681d79cb8f270c34ba412910584d";
const REGISTRAR_SHA256 =
  "e118bceb7966e620dfd7f3aec4e54684c44b5d2679e4b3428f98fde884cde4bb";
const ID_RESOLVER_SHA256 =
  "9b27bd812d4b8a1aafe4f03e6a34b36a28081bc912c96d6dd218bb7109efd268";

const FRAME_ARRAY = 5_906_396;
const FRAME_COUNT = 5_906_404;
const SKILL_SLOT_LAYOUT = Object.freeze({
  frameArray: FRAME_ARRAY,
  frameCount: FRAME_COUNT,
  frameBytes: 0x1c8,
  frameChildOffsetId: 0xb8,
  frameId: 0xbc,
  framePositionFlags: 0xd8,
  frameViewportWidth: 0x104,
  frameViewportHeight: 0x108,
  frameScreenLeft: 0x10c,
  frameScreenBottom: 0x110,
  frameScreenRight: 0x114,
  frameScreenTop: 0x118,
  frameRelation: 0x128,
  frameState: 0x18c,
});

function utf16Le(value: string): Uint8Array {
  const bytes = new Uint8Array((value.length + 1) * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), true);
  }
  return bytes;
}

function equal(left: Uint8Array | null, right: Uint8Array): boolean {
  return left !== null
    && left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function uniqueStaticAddress(
  context: EnhancementProofContext,
  needle: Uint8Array,
): number | null {
  const matches = context.data.addresses(needle);
  return matches.length === 1 ? matches[0]! : null;
}

export type SkillSlotGeometryProof = NonNullable<
  KnownEnhancementBuild["skillSlotGeometry"]
>;

/** Validate every proof field crossing back from the isolated verifier. */
export function isSkillSlotGeometryProof(
  value: unknown,
): value is SkillSlotGeometryProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<SkillSlotGeometryProof>;
  const initializer = proof.initializer;
  const constructor = proof.constructor;
  return Object.keys(proof).sort().join() ===
      "constructor,initializer,labelAddress,layout"
    && initializer !== undefined
    && Object.keys(initializer).sort().join() ===
      "bodySha256,constructorCallOperand,functionIndex,params,results"
    && Number.isSafeInteger(initializer.functionIndex)
    && initializer.functionIndex >= 0
    && Number.isSafeInteger(initializer.constructorCallOperand)
    && initializer.constructorCallOperand >= 0
    && isDeepStrictEqual(initializer.params, ["i32", "i32"])
    && isDeepStrictEqual(initializer.results, [])
    && initializer.bodySha256 === INITIALIZER_SHA256
    && constructor !== undefined
    && Object.keys(constructor).sort().join() ===
      "bodySha256,functionIndex,params,results"
    && Number.isSafeInteger(constructor.functionIndex)
    && constructor.functionIndex >= 0
    && isDeepStrictEqual(
      constructor.params,
      ["i32", "i32", "i32", "i32", "i32", "i32"],
    )
    && isDeepStrictEqual(constructor.results, ["i32"])
    && constructor.bodySha256 === CONSTRUCTOR_SHA256
    && typeof proof.labelAddress === "number"
    && Number.isSafeInteger(proof.labelAddress)
    && proof.labelAddress > 0
    && isDeepStrictEqual(proof.layout, SKILL_SLOT_LAYOUT);
}

export function deriveSkillSlotGeometry(
  context: EnhancementProofContext,
): SkillSlotGeometryProof | null {
  const module = context.moduleView();
  const label = utf16Le("SkillBar");
  const labelAddress = uniqueStaticAddress(context, label);
  if (
    labelAddress === null
    || !equal(staticBytes(module, labelAddress, label.byteLength), label)
    || codeOperandOccurrences(module, labelAddress) !== 1
  ) return null;

  const encodedLabel = paddedOperand(labelAddress);
  const candidates = module.bodies.flatMap((body, localIndex) => {
    const operand = indexOfBytes(body, encodedLabel);
    return operand < 0
      ? []
      : [{ body, operand, functionIndex: module.functionImportCount + localIndex }];
  });
  if (candidates.length !== 1) return null;
  const initializer = candidates[0]!;
  const callOperand = initializer.operand + encodedLabel.byteLength + 1;
  if (
    initializer.body[initializer.operand - 1] !== 0x41
    || initializer.body[callOperand - 1] !== 0x10
    || initializer.body.byteLength !== 8_162
    || !signatureMatches(module, initializer.functionIndex, ["i32", "i32"], [])
    || functionBodySha256(module, initializer.functionIndex) !== INITIALIZER_SHA256
  ) return null;

  const constructorFunction = unsignedOperand(initializer.body, callOperand);
  if (
    !signatureMatches(
      module,
      constructorFunction,
      ["i32", "i32", "i32", "i32", "i32", "i32"],
      ["i32"],
    )
    || functionBodySha256(module, constructorFunction) !== CONSTRUCTOR_SHA256
    || uniqueExactFunction(
      module,
      CONSTRUCTOR_SHA256,
      ["i32", "i32", "i32", "i32", "i32", "i32"],
      ["i32"],
    ) !== constructorFunction
  ) return null;

  const allocator = uniqueExactFunction(
    module, ALLOCATOR_SHA256, ["i32", "i32", "i32", "i32", "i32"], ["i32"],
  );
  const registrar = uniqueExactFunction(
    module, REGISTRAR_SHA256, ["i32", "i32"], ["i32"],
  );
  const resolver = uniqueExactFunction(
    module, ID_RESOLVER_SHA256, ["i32"], ["i32"],
  );
  if (allocator === null || registrar === null || resolver === null) return null;
  const decoded = decodeFunctions(module, []);
  const calls = new Map(decoded.map((entry) => [entry.functionIndex, entry.calls]));
  if (
    calls.get(constructorFunction)?.get(allocator) !== 1
    || calls.get(allocator)?.get(registrar) !== 1
    || codeOperandOccurrences(module, FRAME_ARRAY) !== 16
    || codeOperandOccurrences(module, FRAME_COUNT) !== 18
    || !functionBody(module, resolver).includes(paddedOperand(FRAME_ARRAY)[0]!)
  ) return null;

  return Object.freeze({
    initializer: Object.freeze({
      functionIndex: initializer.functionIndex,
      params: Object.freeze(["i32", "i32"] as const),
      results: Object.freeze([] as const),
      bodySha256: INITIALIZER_SHA256,
      constructorCallOperand: callOperand,
    }),
    constructor: Object.freeze({
      functionIndex: constructorFunction,
      params: Object.freeze([
        "i32", "i32", "i32", "i32", "i32", "i32",
      ] as const),
      results: Object.freeze(["i32"] as const),
      bodySha256: CONSTRUCTOR_SHA256,
    }),
    labelAddress,
    layout: SKILL_SLOT_LAYOUT,
  });
}
