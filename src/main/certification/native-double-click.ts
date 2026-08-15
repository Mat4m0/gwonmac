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
      // Build 38833 Enhancement ABI 31 profiles.
      "13cac908e7fef7873be2f295fb8cb4348d9b5eaa7188207c96fdc79f688b5bd4": "4792a6c167ce4f530439b0586d44d21f8e9f3e101b36b85653aa9358c413c86b",
      "2cc29a94e731169d4c1aeeda268635264ac020049a5b02ba14a0d243e8a4755a": "5d5da7b300b08b79edcd1a4f7487725f166e45e31d68adb99aae6f9c87b1a60a",
      fc6ceaaeeeb3b6c3b739b36b54fee5c737375716abd263ac88b2538675e706e6: "da86cc6e930668d5b3c9ca4fcb62b8a3f22314f4bdb526397f9e7aa6c9ad84dc",
      "0f089212ec505e6b229d32c57d2a509401613d04aff4cb83685617ec2a5128e6": "52f27f9ead6bc55f49d6f52b240b0bc47b4176b76f5bf7526182751fcfcffb7c",
      "914f22489fd36c203f5ab1f14cc2b152bd7b27e337ac1e44ea6d580f9e06f0b0": "fb18d1c57b17daeedd150e63dafe5cb155bad030518887b36e1411900a3b61a8",
      f148d0409e007a77905a1c0f5ec727243af3425e42b98f8762413a7a965b8c92: "e3f2b856c3f8070f0541e058a1464f37a02521d9c8c66c05126175b644a28168",
      f7ca4ec0cc5dd9bd89f76a2b4cfc983552827ba34d9dfb77f6a1c62689811d4d: "f6d12501e2ce505b402ebeb7c8a8acb91e71ebebe3730ccbb788c4fd6e5c5c89",
      "878c9409c35e52d580764bc874285f7d0bf37583f13f8e7698f4dd5ba1ca8a7e": "63dd3273fb9b89ef44564ee40ffaebba5c2b6605e7cd2b47718c9fce0d9d8628",
      e96b61673d6f1f675cecd48089ec2daaea367af7ad7f1d13675f79e924f86184: "2cda0d522d1af3a4bde6ab86cd0c88cb41070d6a032cb8fb6f155b3be9a08e3c",
      dfd9baecfbddf16504b6e83e540e1361edaf2225770a8c5ef0e5f81b03b531e6: "95929a07e1c9f5fe5676debae7ce1ad025ccc2a8d6f0e5f2bf65ad30e052bdda",
      b1bc9b05a1d4e0bf055b602a414da8b65d783c35a89381fd498c03f621f4fb02: "19aef2e32b6e87750620f6216169749514f80dda1fce62279ef7151758815909",
      "1ca5bbd1734924e44bc250b3855e514d40aba1af83390e213eb651c262e2be1b": "2e5ce2efa84e5db5a6cb083d5d822c70f14ffa3c60d4e3b3e14cf2757ef7c545",
      "16b9654e24ce51c6a3b3abecb489c6e8f01d9eb0881e41891ce632b5d6fa2eed": "03ae7398b747a83e11a10ea61dee20f0fb4be363d3e204b820a1bf7c0538fd3a",
      ed3e5ffa293f290f445974fcb41af2b4d90e270a66d5251e3ae4544eae062cdd: "f0d1f9b7029a38d27337d33bfc7dce8fc3bd3492402af27c1b561b6ed71bad68",
      "749e046ef6a887088854d105a6dffad89247896ec237f5c3f9570eade47e9682": "7e7e008a9a223720e2e03f36b2649590250eac5e4206ce81cabf33bbd320420d",
      e9c500238b12dc2bb04e3916fff9f6304e50d10186e067fb15c35979459b5e43: "69f95e247a53ef88871891be3bd9bb615f090657ba0b86cab24a0d9843ee66ac",
      e25740cb04c8ceb005251d3d4ea537526a01f5437e6c3f05f541cd35305f6fc1: "1d2569784d6f3113747a91e306fc230b13ad81e7f8a12de11e1831e37906a191",
      "71d6053fcfbe8bc7f9343701c22ab299b3637e7344c130ac5ccc113eed36f80d": "f2af03906e2994a72ebb66ab740c7ad372a9c37114b0198760cf12f536c1a6fd",
      "4d70f15840fcdfcc4bc07933704863c1c125c0e330dd63de45a3f4beee9fc2ac": "bfec94006f69f6a6212ae513f41fc70d6ba09515f49ee1cc36c7b29d65db6264",
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
