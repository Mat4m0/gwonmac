/**
 * Exact-build proof for the five native frames used by reload automation.
 *
 * The proof starts at unique UTF-16 labels and binds the game's exact label
 * hash implementation. A translated caption, screen position, or nearby
 * generic Yes button grants no authority.
 */
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import type { ModuleShape } from "./enhancement-evidence-types.js";
import type { EnhancementPlayRegionLayout } from "../../shared/enhancement-config.js";
import type { WasmDataEvidence } from "./wasm-data-evidence.js";
import {
  codeOperandOccurrences,
  functionBody,
  functionBodySha256,
  mutableSpans,
  semanticRole,
  signatureMatches,
  soleValue,
  staticBytes,
  uniqueExactFunction,
  uniqueRoleFunction,
  unsignedOperand,
  valuesForRole,
  type EnhancementProofContext,
} from "./wasm-evidence.js";

const HASH_FUNCTION_ROLE = semanticRole(
  123,
  "b12924d38e54a8aa3ac1804ce10d5946da4c3d41a1819f6ad32dac2e017864d0",
  Object.freeze([
    { start: 84, end: 89, role: "hash.table", addressClass: "immutable-data" },
  ]),
  ["i32", "i32"],
  ["i32"],
);
const HASH_TABLE_SHA256 =
  "7d3ef45c38a522afbdc9e7fda537a0fc1eee1c1182400b83e7ed4ae825f02220";

const FRAME_RESOLVER_ROLE = semanticRole(
  247,
  "bb472c938517d6be0477a7b15cd387b1acef31a8572dc556a2072e615af91db5",
  Object.freeze([
    ...mutableSpans([
      [11, 16, "frame.count"], [23, 28, "frame.array"],
      [73, 78, "frame.count"], [118, 123, "frame.count"],
      [152, 157, "frame.array"], [198, 203, "frame.count"],
      [232, 237, "frame.array"],
    ]),
    ...[47, 53, 82, 88, 133, 169, 175, 213].map((start, index) => ({
      start, end: start + 5, role: `resolver.meta-${index}`,
      addressClass: "immutable-data" as const,
    })),
  ]),
  ["i32"],
  ["i32"],
);

const FRAME_REGISTRAR_ROLE = semanticRole(
  360,
  "5b53e7ea08a053c2ac512a6b28660f8d927c477968df8043471ec2c2dbceee5d",
  Object.freeze([
    ...mutableSpans([
      [76, 81, "frame.related-a"], [97, 102, "frame.related-a"],
      [108, 113, "frame.related-b"], [128, 133, "frame.count"],
      [162, 167, "frame.array"], [182, 187, "frame.array"],
      [191, 196, "frame.count"], [213, 218, "frame.array"],
      [222, 227, "frame.count"], [247, 252, "frame.count"],
      [342, 347, "frame.related-c"], [352, 357, "frame.related-c"],
    ]),
    ...[143, 288, 294].map((start, index) => ({
      start, end: start + 5, role: `registrar.meta-${index}`,
      addressClass: "immutable-data" as const,
    })),
  ]),
  ["i32", "i32"],
  ["i32"],
);

const FRAME_CONSTRUCTOR_ROLE = semanticRole(
  137,
  "5ffea848000894bd9d125990acb4974301d885065c3f1e4c2926fdd147ddaae9",
  Object.freeze([
    { start: 38, end: 43, role: "constructor.source-file", addressClass: "immutable-data" },
  ]),
  ["i32", "i32", "i32", "i32", "i32", "i32"],
  ["i32"],
);

const FRAME_HASH_READER_SHA256 =
  "462cfc24428d5bd180773c5cec7a693a01b9cb5fcd790e8f63bb2ab10f5d2840";
const CHARACTER_ARRAY_READER_SHA256 =
  "87b6b897fd8df7688f46fcaf517b78b1af5334d00e85f4c20d9d9978a4f799e0";
const SELECTED_CHARACTER_READER_SHA256 =
  "49eb229605004bc69ce17787f6e38d1b453892e740a1b0f3e071d86e4685d6aa";
const FRAME_CHILD_SHA256 =
  "9f73f1018d0bf99fd0d16b6ede0921dbe29cf70a4da4a61c9b24c1e68dbb0bf0";
const FRAME_PARENT_SHA256 =
  "46c90817c6ab335d5b8d57fdc1e38abd146c2b123dd8dcf0f08aca8245b8a9f2";
const FRAME_MESSAGE_SHA256 =
  "29041a4f537194fae813ddd84c99a06b6f716dd6fe2b4adc64d60f32857abd9f";
const LOGOUT_PRODUCER_SHA256 =
  "b618abba3579ffe6f149a23e2550f6b86571b0f3beaa30acea059153f7cd6b06";

const LABELS = Object.freeze({
  play: "Play",
  selector: "Selector",
  yes: "BtnYes",
  no: "BtnNo",
  reconnectDialog: "DlgReconnect",
});

type Proof = NonNullable<KnownEnhancementBuild["preGameControls"]>;

function utf16Le(value: string): Uint8Array {
  const bytes = new Uint8Array((value.length + 1) * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), true);
  }
  return bytes;
}

/** Exact, side-effect-free translation of the certified client hash body. */
function labelHash(
  module: ModuleShape,
  hashTableAddress: number,
  value: string,
): number | null {
  const bytes = staticBytes(module, hashTableAddress, 16 * 4);
  if (!bytes) return null;
  const table = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let result = 844_963_502;
  let rolling = 3_804_322_973;
  let sum = 561_029_770;
  for (const character of value) {
    const code = character.charCodeAt(0);
    const normalized = ((code - 97) & 0xffff) < 26 ? code - 32 : code;
    rolling = (normalized ^ (rolling << 3)) >>> 0;
    sum = (table.getUint32((rolling & 15) * 4, true) + sum) >>> 0;
    result = ((sum + rolling) ^ result) >>> 0;
  }
  return result;
}

function uniqueStaticAddress(
  data: WasmDataEvidence,
  needle: Uint8Array,
): number | null {
  const matches = data.addresses(needle);
  return matches.length === 1 ? matches[0]! : null;
}

function exactLabel(
  module: ModuleShape,
  data: WasmDataEvidence,
  value: string,
  expectedCodeReferences = 1,
): number | null {
  const encoded = utf16Le(value);
  const address = uniqueStaticAddress(data, encoded);
  if (
    address === null
    || codeOperandOccurrences(module, address) !== expectedCodeReferences
    || !isDeepStrictEqual(staticBytes(module, address, encoded.length), encoded)
  ) return null;
  return address;
}

export type CertifiedFrameLabel = Readonly<{
  labelAddress: number;
  labelHash: number;
}>;

/**
 * Certify one explicit frame label against the already reviewed label-hash
 * implementation. This remains a build-time locator: neither the address nor
 * the hash belongs in a renderer observation.
 */
export function deriveCertifiedFrameLabel(
  context: EnhancementProofContext,
  value: string,
  expectedCodeReferences: number,
): CertifiedFrameLabel | null {
  const module = context.moduleView();
  const labelAddress = exactLabel(
    module,
    context.data,
    value,
    expectedCodeReferences,
  );
  const hashFunction = uniqueRoleFunction(module, HASH_FUNCTION_ROLE);
  if (
    labelAddress === null
    || hashFunction === null
    || !signatureMatches(module, hashFunction, ["i32", "i32"], ["i32"])
  ) return null;
  const evidence = valuesForRole(
    functionBody(module, hashFunction),
    HASH_FUNCTION_ROLE,
  );
  const tableAddress = soleValue(evidence, "hash.table");
  const table = staticBytes(module, tableAddress, 16 * 4);
  if (
    table === null
    || context.data.addresses(table).length !== 1
    || createHash("sha256").update(table).digest("hex") !== HASH_TABLE_SHA256
  ) return null;
  const hash = labelHash(module, tableAddress, value);
  return hash === null || hash === 0
    ? null
    : Object.freeze({ labelAddress, labelHash: hash });
}

function uniqueCString(
  data: WasmDataEvidence,
  address: number,
  expected: string,
): boolean {
  return data.readCString(address) === expected
    && data.addresses(new TextEncoder().encode(`${expected}\0`)).length === 1;
}

function roleStringsMatch(
  data: WasmDataEvidence,
  values: Map<string, number[]>,
  expected: readonly string[],
  prefix: string,
): boolean {
  return expected.every((text, index) => {
    const addresses = values.get(`${prefix}.meta-${index}`) ?? [];
    return addresses.length === 1 && uniqueCString(data, addresses[0]!, text);
  });
}

function deriveFrameLayout(
  context: EnhancementProofContext,
  playRegion: EnhancementPlayRegionLayout,
): Proof["layout"] | null {
  const module = context.moduleView();
  const resolver = uniqueRoleFunction(module, FRAME_RESOLVER_ROLE);
  const registrar = uniqueRoleFunction(module, FRAME_REGISTRAR_ROLE);
  const constructor = uniqueRoleFunction(module, FRAME_CONSTRUCTOR_ROLE);
  const hashReader = uniqueExactFunction(
    module, FRAME_HASH_READER_SHA256, [], ["i32"],
  );
  if (
    resolver === null || registrar === null || constructor === null
    || hashReader === null
  ) return null;
  const resolverValues = valuesForRole(
    functionBody(module, resolver), FRAME_RESOLVER_ROLE,
  );
  const registrarValues = valuesForRole(
    functionBody(module, registrar), FRAME_REGISTRAR_ROLE,
  );
  if (
    !roleStringsMatch(context.data, resolverValues, [
      "Validate(id)", "../../../../Engine/Frame/FrMsg.cpp",
      "index < m_refArray.Count()", "../../../../Base\\rtl\\IdMgr.h",
      "../../../../Base\\rtl\\Array.h", "!index || m_refArray[index]",
      "../../../../Base\\rtl\\IdMgr.h", "../../../../Base\\rtl\\Array.h",
    ], "resolver")
    || !roleStringsMatch(context.data, registrarValues, [
      "../../../../Base\\rtl\\Array.h", "!Head()",
      "../../../../Base\\rtl\\List.h",
    ], "registrar")
  ) return null;
  const constructorValues = valuesForRole(
    functionBody(module, constructor), FRAME_CONSTRUCTOR_ROLE,
  );
  if (!uniqueCString(
    context.data,
    soleValue(constructorValues, "constructor.source-file"),
    "../../../../Engine/Frame/FrApi.cpp",
  )) return null;
  const frameArray = soleValue(resolverValues, "frame.array");
  const frameCount = soleValue(resolverValues, "frame.count");
  if (
    frameArray !== soleValue(registrarValues, "frame.array")
    || frameCount !== soleValue(registrarValues, "frame.count")
    || frameCount !== frameArray + 8
    || codeOperandOccurrences(module, frameArray) !== 16
    || codeOperandOccurrences(module, frameCount) !== 18
  ) return null;
  const constructorBody = functionBody(module, constructor);
  const hashReaderBody = functionBody(module, hashReader);
  return Object.freeze({
    frameArray,
    frameCount,
    frameBytes: unsignedOperand(constructorBody, 33),
    // These are part of the exact reviewed Frame constructor layout. The
    // constructor and frame-message bodies are both body-hash certified below.
    frameChildOffsetId: 0xb8,
    frameId: unsignedOperand(constructorBody, 134),
    frameHashId: unsignedOperand(hashReaderBody, 11),
    frameRelation: 0x128,
    frameState: unsignedOperand(constructorBody, 87),
    contextRoot: playRegion.contextRoot,
    gameContextSlot: playRegion.gameContextSlot,
    characterContext: playRegion.characterContext,
    characterUuid: playRegion.characterUuid,
    currentInstanceType: playRegion.currentInstanceType,
  });
}

export function derivePreGameControls(
  context: EnhancementProofContext,
  playRegion: EnhancementPlayRegionLayout,
): Proof | null {
  const module = context.moduleView();
  const { data } = context;
  const frameLayout = deriveFrameLayout(context, playRegion);
  const play = exactLabel(module, data, LABELS.play);
  const selector = exactLabel(module, data, LABELS.selector);
  const yes = exactLabel(module, data, LABELS.yes);
  const no = exactLabel(module, data, LABELS.no);
  const reconnectDialog = exactLabel(module, data, LABELS.reconnectDialog);
  const characterArrayReader = uniqueExactFunction(
    module, CHARACTER_ARRAY_READER_SHA256, ["i32", "i32"], ["i32"],
  );
  const selectedCharacterReader = uniqueExactFunction(
    module, SELECTED_CHARACTER_READER_SHA256, ["i32", "i32"], [],
  );
  const frameChild = uniqueExactFunction(
    module, FRAME_CHILD_SHA256, ["i32", "i32"], ["i32"],
  );
  const frameParent = uniqueExactFunction(
    module, FRAME_PARENT_SHA256, ["i32"], ["i32"],
  );
  const frameMessage = uniqueExactFunction(
    module, FRAME_MESSAGE_SHA256, ["i32", "i32", "i32", "i32"], [],
  );
  const frameResolver = uniqueRoleFunction(module, FRAME_RESOLVER_ROLE);
  const logoutProducer = uniqueExactFunction(
    module, LOGOUT_PRODUCER_SHA256, ["i32", "i32", "i32"], [],
  );
  if (frameLayout === null || play === null || selector === null || yes === null
    || no === null || reconnectDialog === null || characterArrayReader === null
    || selectedCharacterReader === null || frameChild === null || frameParent === null
    || frameMessage === null || frameResolver === null || logoutProducer === null) return null;
  const frameMessageEvidence = context.decodeFunctions([85, 168]).find(
    (candidate) => candidate.functionIndex === frameMessage,
  );
  const frameDispatchCandidates = frameMessageEvidence
    ? [...frameMessageEvidence.calls.keys()].filter((functionIndex) =>
        functionIndex !== frameMessage
        && signatureMatches(module, functionIndex, ["i32", "i32", "i32", "i32"], []))
    : [];
  if (
    frameMessageEvidence?.calls.get(frameResolver) !== 1
    || frameMessageEvidence.messageSites[85] !== 2
    || frameMessageEvidence.messageSites[168] !== 1
    || frameDispatchCandidates.length !== 1
  ) return null;
  const frameDispatch = frameDispatchCandidates[0]!;
  const characterArrayBody = functionBody(module, characterArrayReader);
  const selectedCharacterBody = functionBody(module, selectedCharacterReader);
  const characterArrayCount = unsignedOperand(characterArrayBody, 9);
  const characterArrayPointer = unsignedOperand(characterArrayBody, 23);
  const selectedCharacterName = unsignedOperand(selectedCharacterBody, 33);
  if (
    characterArrayCount !== characterArrayPointer + 8
    || selectedCharacterName <= characterArrayCount
  ) return null;
  const hashFunction = uniqueRoleFunction(module, HASH_FUNCTION_ROLE);
  if (hashFunction === null
    || !signatureMatches(module, hashFunction, ["i32", "i32"], ["i32"])) {
    return null;
  }
  const hashEvidence = valuesForRole(
    functionBody(module, hashFunction), HASH_FUNCTION_ROLE,
  );
  const hashTableAddress = soleValue(hashEvidence, "hash.table");
  const hashTable = staticBytes(module, hashTableAddress, 16 * 4);
  if (
    hashTable === null
    || context.data.addresses(hashTable).length !== 1
    || createHash("sha256").update(hashTable).digest("hex") !== HASH_TABLE_SHA256
  ) return null;
  const labelHashes = {
    play: labelHash(module, hashTableAddress, LABELS.play),
    selector: labelHash(module, hashTableAddress, LABELS.selector),
    yes: labelHash(module, hashTableAddress, LABELS.yes),
    no: labelHash(module, hashTableAddress, LABELS.no),
    reconnectDialog: labelHash(module, hashTableAddress, LABELS.reconnectDialog),
  };
  if (Object.values(labelHashes).some((hash) => hash === null || hash === 0)) {
    return null;
  }

  return Object.freeze({
    characterSwitchAction: Object.freeze({
      enqueueExport: "enhancement_character_action",
      configureExport: "enhancement_configure_character_action",
      logoutMessageId: 0x1000_009d,
      frameDispatchOffset: 0xa8,
      frameChild: Object.freeze({
        functionIndex: frameChild,
        params: Object.freeze(["i32", "i32"] as const),
        results: Object.freeze(["i32"] as const),
        bodySha256: functionBodySha256(module, frameChild),
      }),
      frameParent: Object.freeze({
        functionIndex: frameParent,
        params: Object.freeze(["i32"] as const),
        results: Object.freeze(["i32"] as const),
        bodySha256: functionBodySha256(module, frameParent),
      }),
      frameResolver: Object.freeze({
        functionIndex: frameResolver,
        params: Object.freeze(["i32"] as const),
        results: Object.freeze(["i32"] as const),
        bodySha256: functionBodySha256(module, frameResolver),
      }),
      frameDispatch: Object.freeze({
        functionIndex: frameDispatch,
        params: Object.freeze(["i32", "i32", "i32", "i32"] as const),
        results: Object.freeze([] as const),
        bodySha256: functionBodySha256(module, frameDispatch),
      }),
      logoutProducer: Object.freeze({
        functionIndex: logoutProducer,
        params: Object.freeze(["i32", "i32", "i32"] as const),
        results: Object.freeze([] as const),
        bodySha256: functionBodySha256(module, logoutProducer),
      }),
    }),
    characterListLayout: Object.freeze({
      characterArrayPointer,
      characterArrayCount,
      selectedCharacterName,
    }),
    hashFunction: Object.freeze({
      functionIndex: hashFunction,
      params: Object.freeze(["i32", "i32"] as const),
      results: Object.freeze(["i32"] as const),
      bodySha256: functionBodySha256(module, hashFunction),
    }),
    labels: Object.freeze({
      play,
      selector,
      yes,
      no,
      reconnectDialog,
    }),
    labelHashes: Object.freeze({
      play: labelHashes.play!,
      selector: labelHashes.selector!,
      yes: labelHashes.yes!,
      no: labelHashes.no!,
      reconnectDialog: labelHashes.reconnectDialog!,
    }),
    layout: Object.freeze({ ...frameLayout }),
  });
}
