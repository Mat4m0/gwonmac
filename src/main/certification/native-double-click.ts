/**
 * The native double-click transform: gives the client's own mouse double-click
 * flag the one byte the Emscripten glue never writes.
 *
 * `internal/upstream/mouse-double-click.md` owns the evidence. In short: the
 * client carries a per-press double-click bit from its input record through
 * `FrMouse` to the widget under the cursor, every consumer of it works, and
 * nothing ever sets it, because `fillMouseEventData` does not marshal
 * `MouseEvent.detail` and the mousedown callback memsets the record byte to
 * zero. Without it the host can only reach a double-click by synthesising a
 * touch tap pair, which is a different interaction: it warps the cursor,
 * force-releases captured buttons, enters the drag machinery, and delivers two
 * extra clicks on top of the player's own two.
 *
 * This appends one exported mutable global and one store. It adds no function,
 * moves no function index, and touches no table entry — the mousedown callback
 * writes the flag the host put in the global into the record slot the client
 * already reads.
 *
 * It refuses to own the decision about *when* a press is a double-click. That
 * is Chromium's click count under the player's own macOS preferences, and the
 * host writes it; this file only carries it across.
 */
import { createHash } from "node:crypto";
import {
  concat,
  countFunctionImports,
  encodeCode,
  encodeSection,
  parseCode,
  parseExports,
  parseIndexVector,
  parseTypes,
  readUleb,
  sectionById,
  splitSections,
  uleb,
  vectorPayload,
  WASM_HEADER,
  type Section,
} from "../core/wasm-binary.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const NATIVE_DOUBLE_CLICK_TRANSFORM_ABI = 1;

/** The exported mutable global the host writes before each trusted press. */
export const DOUBLE_CLICK_FLAG_EXPORT = "gwonmac_double_click";

/**
 * What must hold before a mousedown callback may be rewritten.
 *
 * `callbackBodySha256` is the whole proof. The transform inserts instructions
 * at a fixed offset into that body and relies on local 3 being the frame
 * pointer and the record living at frame+8; a body that hashes to the
 * certified value *is* that body, so there is nothing left to infer. A build
 * whose callback differs by a byte is refused rather than guessed at.
 *
 * `derivations` is separate from that proof and does a different job: it is
 * the set of certified predecessor modules this stage may consume, each mapped
 * to the module it produces. The chain runs this transform last, so those
 * predecessors are the template-save output and the Enhancement output of each
 * certified capability profile — and because the callback body survives both
 * of those transforms untouched, one proof covers every entry.
 */
export interface NativeDoubleClickBuild {
  /** Active table slot the client registers as its mousedown callback. */
  readonly callbackTableSlot: number;
  /** Function index that slot resolves to. */
  readonly callbackFunctionIndex: number;
  readonly callbackParams: readonly "i32"[];
  readonly callbackResults: readonly "i32"[];
  /** SHA-256 of that function's body, before the rewrite. */
  readonly callbackBodySha256: string;
  /** Byte offset in the body at which the flag store is inserted. */
  readonly flagStoreOffset: number;
  /**
   * Byte offset from the frame pointer in local 3 to the record's flag word.
   * The client's translator copies that word into the press message the
   * double-click bit is masked out of.
   */
  readonly flagStoreFrameOffset: number;
  /** Certified predecessor module hash -> the hash this stage produces. */
  readonly derivations: Readonly<Record<string, string>>;
}

/**
 * The retained exact build and the preceding template-save-only build use the
 * same callback function, body, table slot, and record layout. Every hash below is reproduced by
 * `pnpm certification double-click`, which re-runs the chain from the official
 * bytes; the table is a cache of that derivation, never its authority.
 */
export const NATIVE_DOUBLE_CLICK_BUILDS: readonly NativeDoubleClickBuild[] = [
  {
    callbackTableSlot: 903,
    callbackFunctionIndex: 2448,
    callbackParams: ["i32", "i32", "i32"],
    callbackResults: ["i32"],
    callbackBodySha256:
      "1f6d69d4364a8369aba990defe34f746063a412fb2e6bc0ae9cc1b4b236acf1e",
    flagStoreOffset: 101,
    flagStoreFrameOffset: 24,
    derivations: {
      // template-save output, with the Enhancement off
      "9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094":
        "e7d86cfcf7b09abbedd3afca758dbf4a3f3c6e1aa4d44e53b31e45e886d7f250",
      // Build 38833 template-save output and Enhancement profiles.
      "7d0ced840d3dc167b823ed0ad6ed411319faf97316345c8e37620e86d86f536e":
        "eeeb4b70edbba53d5ee98a50dbba395dd175e8eebdd3e3bf93f8f9fcfa428a7b",
      // Build 38833 Enhancement ABI 33 profiles.
      "9ef763994577dd1a78fa7c8931d2fe6e75104790867450c2b1ed345601e7b120": "e5da9e585b729686b8947677a35768443a1d40f26413a33640dee98495c62702",
      "7ce7fc87062fe351cf3d9830320deb8b647e7261cca207c42fd9efbbbec18bf2": "75c1976551a1af976b62d483962a2b1111891f19bce81105b131c5a2467c42e6",
      "9392729dff7ad62e7dc2f52ab297b3f835d9707fe7edeb60b261398b45b2ea42": "08e289c0fbe06bd7d18bade47dbf6baccd59cd7349b76d2bb923d6d790682a52",
      "895f66aee9292aa9c96ace648d7063e75ff20e25e45d340d4b15e78041056906": "b3a497ee3ff7ca6976648b07744c811a7758bb3d4e3a72de4bcff001923ff28a",
      "9c545793e5aba877be575eeb5197e1d2f9b9007303eed1c503b7a93aee580fd4": "b8c73572d73e5d9eac92a89215718219776d4fe288cdc100e7027ee172ce0b9b",
      a743f0fd9318fd6d9008d8dc1619d0f51a974198641676aa4df6c369c669835e: "17b9a62a1a3a4a7e00bad63f61a5412cebf6d87265005b4df6040ecb1adae86b",
      "2c10a054ccf24902f00f835862362abd3f8ecd0fe2f5c7822533c70cc299ab57": "fcba4be3f23a0d306704a721209af3d358f219cc2f5275fab7146d0a006d862e",
      "9e1f20e817c11cb0793539574ccc0a9babc6570744bbbfb8c5503ae317ba5e21": "13b958a0ea703ed5e34d2e7b4ae02e0ce9e4b572643b654e51a779b02ec0deb3",
      "5ca5c2206dfbe154b3eaa363a965ea0a796c436b14650751575b9ac1b38c2b27": "e99e8814c7c3865a3b7e1603781d2c01b2c6815e8a019d0112fa217c8239851c",
      "9d767bba917640b0d0a4665078b972a5a3d2e9c70fd16a126c6177100f093863": "1cebf123aea5373359cab9fefdcf759c1e3b4062d0cf700b80d4073197ced4df",
      "212226bb0ddf7a63d6371f9c95d60add0795abc1da67b07249c7c5d98f92d0b0": "0b0bcc9f2b543345fa06883f139e3e654df8fb50199d58b3d48546355db6c28b",
      "79d90acc181ea0fdc0b512da693a4174840beff757f852a79ccd695de3d68373": "2fec578bfc3fed4e98de56f13d68e4a38aba078f0831c2225b9032d81ad4c47e",
      "405242a2c0f2cc4b623fb9fafbb5663754afd0746a5f0730853266e517f5d6cc": "dc39ca631b5949980fbdc3f8fdad132914eaa00c873a6872ad367e30fc6a887d",
      dd74d05643a78d6f8abac0194e32adfa020705a9b37774224eac9581b5b1fad6: "8ec2ee0aadfb4932edd9a12d2074ea9f3ce50cbcf2a44255069f6f6518f9a762",
      "05797d5a6e83957cbc472f79458b3b4f19b753c1ebde54a90da7ae8b8298fdc5": "3241aad41eb3d87a9f9ab35c7d7cca20bd9996db208270079d9fe37bbd5f6f5f",
      "4eb4a194ae0799a15206bb5b11320d6f8cc0a8f211067b3835db67263dd517ef": "fa5916e8cbd47586f20c2fcba2d0515d23a79883d20eebb292706bc115f12df7",
      df9a6fd5b43952ea1eed8ef8b9961f93aa617d751103234009a0931503fed37a: "cf9996a6cebd8711a0dfaaa659095687d9d95c4f96c59673fc002dec16f8fc37",
      aef4f6b79e21adce6985e18bc7aed36569126989a985059737d089eccca79c45: "a161958b509776fc1a87d249fcd6cd7e08520815d4547070c2a9d8f3aad2445f",
      edc1793dca6d6cd204c6b559971c09a1f9f6b107af91803cbdeaf6b342f65d7c: "18efc7d5f20cbdcf32416413119890d2f6d1ca6a329cd47bf9719665c723d756",
    },
  },
];

function fail(message: string): never {
  throw new Error(`native double-click transform: ${message}`);
}

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function encodeName(name: string): Uint8Array {
  const bytes = new TextEncoder().encode(name);
  return concat(uleb(bytes.length), bytes);
}

/** The entry that may consume this module, or null when none may. */
export function findNativeDoubleClickBuild(
  inputSha256: string,
): NativeDoubleClickBuild | null {
  return (
    NATIVE_DOUBLE_CLICK_BUILDS.find((build) =>
      Object.hasOwn(build.derivations, inputSha256),
    ) ?? null
  );
}

/** The module this stage produces from a certified predecessor. */
export function nativeDoubleClickOutputSha256(
  build: NativeDoubleClickBuild,
  inputSha256: string,
): string | null {
  return build.derivations[inputSha256] ?? null;
}

/** Locate an unchanged callback semantically when only the predecessor hash moved. */
export function deriveNativeDoubleClickBuild(
  input: Uint8Array,
  baselines: readonly NativeDoubleClickBuild[] = NATIVE_DOUBLE_CLICK_BUILDS,
): NativeDoubleClickBuild | null {
  if (!WebAssembly.validate(input)) return null;
  try {
    const sections = splitSections(input);
    const bodies = parseCode(sectionById(sections, 10));
    const importCount = countFunctionImports(sectionById(sections, 2));
    const functionTypes = parseIndexVector(sectionById(sections, 3));
    const types = parseTypes(sectionById(sections, 1));
    const slots = tableSlotFunctions(sectionById(sections, 9));
    const inputSha256 = sha256(input);
    const matches: NativeDoubleClickBuild[] = [];
    for (const baseline of baselines) {
      const candidates = bodies.flatMap((body, localIndex) =>
        sha256(body) === baseline.callbackBodySha256
          ? [localIndex + importCount]
          : [],
      );
      if (candidates.length !== 1) continue;
      const callbackFunctionIndex = candidates[0]!;
      const callbackSlots = [...slots]
        .filter(([, functionIndex]) => functionIndex === callbackFunctionIndex)
        .map(([slot]) => slot);
      const type = types[functionTypes[callbackFunctionIndex - importCount]!];
      if (
        callbackSlots.length !== 1 ||
        !type ||
        type.params
          .map((value) => (value === 0x7f ? "i32" : "other"))
          .join() !== baseline.callbackParams.join() ||
        type.results
          .map((value) => (value === 0x7f ? "i32" : "other"))
          .join() !== baseline.callbackResults.join()
      )
        continue;
      const candidate: NativeDoubleClickBuild = {
        ...baseline,
        callbackTableSlot: callbackSlots[0]!,
        callbackFunctionIndex,
        derivations: {},
      };
      const output = rewriteWithBuild(input, candidate);
      matches.push({
        ...candidate,
        derivations: Object.freeze({ [inputSha256]: sha256(output) }),
      });
    }
    return matches.length === 1 ? matches[0]! : null;
  } catch {
    return null;
  }
}

/**
 * Every active table slot mapped to the function it holds. Only slot-zero
 * segments with a constant offset appear in this module; anything else is
 * refused rather than approximated, because a mislocated callback would
 * rewrite an unrelated function.
 */
function tableSlotFunctions(body: Uint8Array): Map<number, number> {
  const slots = new Map<number, number>();
  const cursor = { offset: 0 };
  const count = readUleb(body, cursor);
  for (let segment = 0; segment < count; segment += 1) {
    if (readUleb(body, cursor) !== 0) fail("unsupported element segment flags");
    if (body[cursor.offset++] !== 0x41) fail("expected element i32.const");
    const base = readUleb(body, cursor);
    if (body[cursor.offset++] !== 0x0b) fail("malformed element offset");
    const entries = readUleb(body, cursor);
    for (let i = 0; i < entries; i += 1) {
      const slot = base + i;
      if (slots.has(slot)) fail(`duplicate active table slot ${slot}`);
      slots.set(slot, readUleb(body, cursor));
    }
  }
  if (cursor.offset !== body.byteLength) fail("malformed element section");
  return slots;
}

/**
 * `local.get 3; global.get $flag; i32.store offset=<frameOffset>`.
 *
 * Three instructions and no branch: whatever the host last wrote lands in the
 * record slot, so a press the host declared ordinary clears the slot as surely
 * as a double-click sets it and no state survives between presses.
 */
function flagStore(globalIndex: number, frameOffset: number): Uint8Array {
  return concat(
    Uint8Array.of(0x20, 0x03),
    Uint8Array.of(0x23),
    uleb(globalIndex),
    Uint8Array.of(0x36, 0x02),
    uleb(frameOffset),
  );
}

/**
 * Rewrites one certified module. Returns the derived bytes; throws with the
 * reason on any input the entry above does not exactly describe.
 */
export function rewriteNativeDoubleClickWasm(input: Uint8Array): Uint8Array {
  const build = findNativeDoubleClickBuild(sha256(input));
  if (!build) fail("module hash is not a certified build");
  return rewriteWithBuild(input, build);
}

/**
 * The rewrite itself, against an entry supplied rather than looked up. The
 * production caller above resolves the entry by module hash; this is separated
 * so the guards can be executed against modules the shipped table does not
 * name, which is every module a test can build.
 */
export function rewriteWithBuild(
  input: Uint8Array,
  build: NativeDoubleClickBuild,
): Uint8Array {
  const sections = splitSections(input);
  const slots = tableSlotFunctions(sectionById(sections, 9));
  const held = slots.get(build.callbackTableSlot);
  if (held !== build.callbackFunctionIndex) {
    fail(
      `table slot ${build.callbackTableSlot} holds function ${held}, ` +
        `not ${build.callbackFunctionIndex}`,
    );
  }

  const bodies = parseCode(sectionById(sections, 10));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const localIndex = build.callbackFunctionIndex - importCount;
  const body = bodies[localIndex];
  if (!body) fail(`function ${build.callbackFunctionIndex} has no body`);
  if (sha256(body) !== build.callbackBodySha256) {
    fail("the mousedown callback is not the certified body");
  }
  if (build.flagStoreOffset > body.byteLength) {
    fail("flag store offset lies outside the callback body");
  }

  const globals = vectorPayload(sectionById(sections, 6));
  const exportSection = sectionById(sections, 7);
  const exports = vectorPayload(exportSection);
  if (
    parseExports(exportSection).some(
      (entry) => entry.name === DOUBLE_CLICK_FLAG_EXPORT,
    )
  ) {
    fail(`export ${DOUBLE_CLICK_FLAG_EXPORT} already exists`);
  }
  const flagGlobalIndex = globals.count;

  const nextBodies = [...bodies];
  nextBodies[localIndex] = concat(
    body.subarray(0, build.flagStoreOffset),
    flagStore(flagGlobalIndex, build.flagStoreFrameOffset),
    body.subarray(build.flagStoreOffset),
  );

  const rewritten = sections.map((section): Section => {
    if (section.id === 6) {
      return {
        id: section.id,
        body: concat(
          uleb(globals.count + 1),
          globals.entries,
          // i32, mutable, initialised to zero: no press is a double-click
          // until the host says so, including the first one after a reload.
          Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b),
        ),
      };
    }
    if (section.id === 7) {
      return {
        id: section.id,
        body: concat(
          uleb(exports.count + 1),
          exports.entries,
          encodeName(DOUBLE_CLICK_FLAG_EXPORT),
          Uint8Array.of(0x03),
          uleb(flagGlobalIndex),
        ),
      };
    }
    if (section.id === 10) {
      return { id: section.id, body: encodeCode(nextBodies) };
    }
    return section;
  });

  const output = concat(WASM_HEADER, ...rewritten.map(encodeSection));
  if (!WebAssembly.validate(output)) fail("rewritten module failed validation");
  return output;
}
