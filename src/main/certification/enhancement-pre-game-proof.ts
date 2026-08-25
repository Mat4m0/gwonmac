/**
 * Exact-build proof for the four native frames used by reload automation.
 *
 * The proof starts at unique UTF-16 labels and binds the game's exact label
 * hash and FrameRelation initializer. A translated caption, screen position,
 * or nearby generic Yes button grants no authority.
 */
import { isDeepStrictEqual } from "node:util";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";
import {
  codeOperandOccurrences,
  functionBodySha256,
  signatureMatches,
  staticBytes,
  uniqueExactFunction,
  type EnhancementProofContext,
} from "./enhancement-wasm-proof-context.js";

const HASH_FUNCTION_SHA256 =
  "90e009c029d1a6fb53f0e7b92d72583497455266a64841d34ac56905289ac95b";
const RELATION_INITIALIZER_SHA256 =
  "91bbf0aa603cb47b3b3a1c7ea2a7062730794600897f16cd94c41a6151214199";
const HASH_TABLE_ADDRESS = 1_249_776;

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
function labelHash(context: EnhancementProofContext, value: string): number | null {
  const bytes = staticBytes(context.module, HASH_TABLE_ADDRESS, 16 * 4);
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
  context: EnhancementProofContext,
  needle: Uint8Array,
): number | null {
  const matches: number[] = [];
  for (const segment of context.module.dataSegments) {
    for (let at = segment.bytes.indexOf(needle[0]!); at >= 0;) {
      if (
        at + needle.byteLength <= segment.bytes.byteLength
        && needle.every((byte, index) => segment.bytes[at + index] === byte)
      ) matches.push(segment.base + at);
      at = segment.bytes.indexOf(needle[0]!, at + 1);
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

function exactLabel(
  context: EnhancementProofContext,
  value: string,
): number | null {
  const encoded = utf16Le(value);
  const address = uniqueStaticAddress(context, encoded);
  if (
    address === null
    || codeOperandOccurrences(context.module, address) !== 1
    || !isDeepStrictEqual(staticBytes(context.module, address, encoded.length), encoded)
  ) return null;
  return address;
}

export function derivePreGameControls(
  context: EnhancementProofContext,
  frameLayout: Proof["layout"],
): Proof | null {
  const play = exactLabel(context, LABELS.play);
  const selector = exactLabel(context, LABELS.selector);
  const yes = exactLabel(context, LABELS.yes);
  const no = exactLabel(context, LABELS.no);
  const reconnectDialog = exactLabel(context, LABELS.reconnectDialog);
  if (play === null || selector === null || yes === null || no === null
    || reconnectDialog === null) return null;
  const hashFunction = uniqueExactFunction(
    context.module,
    HASH_FUNCTION_SHA256,
    ["i32", "i32"],
    ["i32"],
  );
  const relationInitializer = uniqueExactFunction(
    context.module,
    RELATION_INITIALIZER_SHA256,
    ["i32", "i32", "i32", "i32"],
    ["i32"],
  );
  if (hashFunction === null || relationInitializer === null
    || !signatureMatches(context.module, hashFunction, ["i32", "i32"], ["i32"])
    || !signatureMatches(
      context.module,
      relationInitializer,
      ["i32", "i32", "i32", "i32"],
      ["i32"],
    )) return null;
  const labelHashes = {
    play: labelHash(context, LABELS.play),
    selector: labelHash(context, LABELS.selector),
    yes: labelHash(context, LABELS.yes),
    no: labelHash(context, LABELS.no),
  };
  if (Object.values(labelHashes).some((hash) => hash === null || hash === 0)) {
    return null;
  }

  return Object.freeze({
    hashFunction: Object.freeze({
      functionIndex: hashFunction,
      params: Object.freeze(["i32", "i32"] as const),
      results: Object.freeze(["i32"] as const),
      bodySha256: functionBodySha256(context.module, hashFunction),
    }),
    relationInitializer: Object.freeze({
      functionIndex: relationInitializer,
      params: Object.freeze(["i32", "i32", "i32", "i32"] as const),
      results: Object.freeze(["i32"] as const),
      bodySha256: functionBodySha256(context.module, relationInitializer),
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
    }),
    layout: Object.freeze({ ...frameLayout }),
  });
}
