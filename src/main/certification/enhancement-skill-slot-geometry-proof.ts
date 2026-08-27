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
  semanticRole,
  signatureMatches,
  soleValue,
  staticBytes,
  staticCStringHash,
  unsignedOperand,
  uniqueRoleFunction,
  valuesForRole,
} from "./wasm-evidence.js";
import type { EnhancementProofContext } from "./wasm-evidence.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import { indexOfBytes } from "../core/wasm-binary.js";
import { isDeepStrictEqual } from "node:util";

const SKILL_SLOT_CONSTRUCTOR_ROLE = semanticRole(137,
  "c6e2c7620ad7fc34a4ed78c716639e648755cf8010a73a03eade8873e202cb4e",
  [{ start: 38, end: 43, role: "frame.file", addressClass: "immutable-data" }],
  ["i32", "i32", "i32", "i32", "i32", "i32"], ["i32"]);
const SKILL_SLOT_ALLOCATOR_ROLE = semanticRole(359,
  "c42147cced310b1a2caffa8c91e6a824f156ce274c413a5033fa233598a64b7c",
  [
    { start: 277, end: 282, role: "allocator.assertion", addressClass: "immutable-data" },
    { start: 283, end: 288, role: "allocator.file", addressClass: "immutable-data" },
  ], ["i32", "i32", "i32", "i32", "i32"], ["i32"]);
const SKILL_SLOT_REGISTRAR_ROLE = semanticRole(360,
  "b9b40600c58634730684ebf668a33af0c500f99c7e6e4c113e131e0692730e94",
  [
    ...[76, 97].map((start) => ({ start, end: start + 5, role: "frame.plus24", addressClass: "mutable-static" as const })),
    { start: 108, end: 113, role: "frame.plus16", addressClass: "mutable-static" },
    ...[128, 191, 222, 247].map((start) => ({ start, end: start + 5, role: "frame.count", addressClass: "mutable-static" as const })),
    { start: 143, end: 148, role: "frame.array-file", addressClass: "immutable-data" },
    ...[162, 182, 213].map((start) => ({ start, end: start + 5, role: "frame.array", addressClass: "mutable-static" as const })),
    { start: 288, end: 293, role: "registrar.assertion", addressClass: "immutable-data" },
    { start: 294, end: 299, role: "registrar.file", addressClass: "immutable-data" },
    ...[342, 352].map((start) => ({ start, end: start + 5, role: "frame.plus48", addressClass: "mutable-static" as const })),
  ], ["i32", "i32"], ["i32"]);
const SKILL_SLOT_ID_RESOLVER_ROLE = semanticRole(247,
  "f67fce69172713e734d2a8ee44548898f878ed2de1821beb06a9e5ba872797b5",
  [
    ...[11, 73, 118, 198].map((start) => ({ start, end: start + 5, role: "frame.count", addressClass: "mutable-static" as const })),
    ...[23, 152, 232].map((start) => ({ start, end: start + 5, role: "frame.array", addressClass: "mutable-static" as const })),
    ...([[47, "resolver.assert-a"], [53, "resolver.file-a"], [82, "resolver.assert-b"], [88, "resolver.file-b"], [133, "frame.array-file"], [169, "resolver.assert-c"], [175, "resolver.file-b"], [213, "frame.array-file"]] as const)
      .map(([start, role]) => ({ start, end: start + 5, role, addressClass: "immutable-data" as const })),
  ], ["i32"], ["i32"]);

const IMMUTABLE = Object.freeze({
  frameFile: "ae09386d3c010580726df6fd3ebda81021733a84674bf912c72adfd8ad07429b",
  allocatorAssertion: "9b4c7b0c2a28bd729f917c387e1785c45244dd488393819d46ff7cc99707e2ee",
  allocatorFile: "5fe369b150019a5112f6d7d302f28b16c56327dfcc87d01dc8ccca9f7d3dcdf1",
  arrayFile: "47d3990810bf698e496109cd7d900538167fa8ee92f01099aad6bde4e5046357",
  resolverA: "15348bca30d112d278b858a939ab9b15af89f681c9de5ed8a5f6ee176bfc74cd",
  resolverFileA: "a7e614b1e6bff71e9d0cfca17edeb98cdfc8b2411d7b2a264ef563aba896749a",
  resolverB: "6e86ca57cf7d807bac78f054a0a73a3728b8765f0471e966776fd79fd7c3bfb4",
  resolverFileB: "060c2fd1625f12f7eb74e60cce2fac204a121485374e4d2944a5a1dbaaf6a63b",
  resolverC: "15ae4b2227cc9b0ea5263c8f2e1ab2cbcfc0d58b948f208d97eb659f35078f5f",
});

const FIXED_SKILL_SLOT_LAYOUT = Object.freeze({
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
  const layout = proof.layout;
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
    && /^[0-9a-f]{64}$/.test(initializer.bodySha256 ?? "")
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
    && /^[0-9a-f]{64}$/.test(constructor.bodySha256 ?? "")
    && typeof proof.labelAddress === "number"
    && Number.isSafeInteger(proof.labelAddress)
    && proof.labelAddress > 0
    && layout !== undefined
    && Number.isSafeInteger(layout.frameArray)
    && Number.isSafeInteger(layout.frameCount)
    && layout.frameArray > 0
    && layout.frameCount === layout.frameArray + 8
    && isDeepStrictEqual(
      Object.fromEntries(Object.entries(layout).filter(
        ([key]) => key !== "frameArray" && key !== "frameCount",
      )),
      FIXED_SKILL_SLOT_LAYOUT,
    );
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
    || !signatureMatches(module, initializer.functionIndex, ["i32", "i32"], [])
  ) return null;

  const constructorFunction = unsignedOperand(initializer.body, callOperand);
  const constructor = uniqueRoleFunction(module, SKILL_SLOT_CONSTRUCTOR_ROLE);
  if (
    constructor === null
    || constructorFunction !== constructor
    ||
    !signatureMatches(
      module,
      constructorFunction,
      ["i32", "i32", "i32", "i32", "i32", "i32"],
      ["i32"],
    )
  ) return null;

  const allocator = uniqueRoleFunction(module, SKILL_SLOT_ALLOCATOR_ROLE);
  const registrar = uniqueRoleFunction(module, SKILL_SLOT_REGISTRAR_ROLE);
  const resolver = uniqueRoleFunction(module, SKILL_SLOT_ID_RESOLVER_ROLE);
  if (allocator === null || registrar === null || resolver === null) return null;
  const constructorValues = valuesForRole(functionBody(module, constructor), SKILL_SLOT_CONSTRUCTOR_ROLE);
  const allocatorValues = valuesForRole(functionBody(module, allocator), SKILL_SLOT_ALLOCATOR_ROLE);
  const registrarValues = valuesForRole(functionBody(module, registrar), SKILL_SLOT_REGISTRAR_ROLE);
  const resolverValues = valuesForRole(functionBody(module, resolver), SKILL_SLOT_ID_RESOLVER_ROLE);
  const frameArray = soleValue(registrarValues, "frame.array");
  const frameCount = soleValue(registrarValues, "frame.count");
  const decoded = decodeFunctions(module, []);
  const calls = new Map(decoded.map((entry) => [entry.functionIndex, entry.calls]));
  if (
    calls.get(constructorFunction)?.get(allocator) !== 1
    || calls.get(constructorFunction)?.get(resolver) !== 1
    || calls.get(allocator)?.get(registrar) !== 1
    || frameCount !== frameArray + 8
    || soleValue(registrarValues, "frame.plus16") !== frameArray + 16
    || soleValue(registrarValues, "frame.plus24") !== frameArray + 24
    || soleValue(registrarValues, "frame.plus48") !== frameArray + 48
    || soleValue(resolverValues, "frame.array") !== frameArray
    || soleValue(resolverValues, "frame.count") !== frameCount
    || codeOperandOccurrences(module, frameArray) !== 16
    || codeOperandOccurrences(module, frameCount) !== 18
    || staticCStringHash(module, soleValue(constructorValues, "frame.file")) !== IMMUTABLE.frameFile
    || staticCStringHash(module, soleValue(allocatorValues, "allocator.assertion")) !== IMMUTABLE.allocatorAssertion
    || staticCStringHash(module, soleValue(allocatorValues, "allocator.file")) !== IMMUTABLE.allocatorFile
    || staticCStringHash(module, soleValue(registrarValues, "frame.array-file")) !== IMMUTABLE.arrayFile
    || staticCStringHash(module, soleValue(registrarValues, "registrar.assertion")) !== IMMUTABLE.allocatorAssertion
    || staticCStringHash(module, soleValue(registrarValues, "registrar.file")) !== IMMUTABLE.allocatorFile
    || staticCStringHash(module, soleValue(resolverValues, "frame.array-file")) !== IMMUTABLE.arrayFile
    || staticCStringHash(module, soleValue(resolverValues, "resolver.assert-a")) !== IMMUTABLE.resolverA
    || staticCStringHash(module, soleValue(resolverValues, "resolver.file-a")) !== IMMUTABLE.resolverFileA
    || staticCStringHash(module, soleValue(resolverValues, "resolver.assert-b")) !== IMMUTABLE.resolverB
    || staticCStringHash(module, soleValue(resolverValues, "resolver.file-b")) !== IMMUTABLE.resolverFileB
    || staticCStringHash(module, soleValue(resolverValues, "resolver.assert-c")) !== IMMUTABLE.resolverC
  ) return null;

  const layout = Object.freeze({ frameArray, frameCount, ...FIXED_SKILL_SLOT_LAYOUT });

  return Object.freeze({
    initializer: Object.freeze({
      functionIndex: initializer.functionIndex,
      params: Object.freeze(["i32", "i32"] as const),
      results: Object.freeze([] as const),
      bodySha256: functionBodySha256(module, initializer.functionIndex),
      constructorCallOperand: callOperand,
    }),
    constructor: Object.freeze({
      functionIndex: constructorFunction,
      params: Object.freeze([
        "i32", "i32", "i32", "i32", "i32", "i32",
      ] as const),
      results: Object.freeze(["i32"] as const),
      bodySha256: functionBodySha256(module, constructorFunction),
    }),
    labelAddress,
    layout,
  });
}
