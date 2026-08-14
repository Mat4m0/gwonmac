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
 * Builds 38797 and 38833 use the same callback function, body, table slot, and
 * record layout. Every hash below is reproduced by
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
      "6a30db8464650f1a8ad0745c3cb586e02d3d579b75db51ffc2e8854b33723b27":
        "73e0f9966c1427a3fafb9b39031da1881a7d7b6f11bf5ad87c2eea32c4c8242a",
      ba812710731835e05e60c37e2118f16c7b477f0694c65b35c6dada8445607d57:
        "232034754c23d5e38bf8af92301a2bdf8ad8d9b0a3a8902fb3d9e9cb3cdfaf2b",
      "6888d8ee2e68b7c48466f37031444312e0a3c9b8c234b3b5784cade1aed7f76b":
        "e806674f7601c4db88b28b37a361f0aec9cc6fc44d0e3358b230cd08304dcb68",
      aab4582fdb21d26de4e02ebd8f20912a9e0215c5f5fa99c02afa59404dc6e97f:
        "a15e1cbf0e5e0cca399ef7632cbb0349ad93b7f66ae1a412c6ccb3ab5c92a988",
      adb6789c4a160dc904e993187e96e0c93234d7f39d4b86649515b03e591d036d:
        "68dfea06f43660278defcfacf79d31cb5e39a5c1ed3924db4cc256718f00432d",
      "354120aff01eabd08d6b42dc8e999fada60351951b2653ae7ffcb00c563f6ac5":
        "0bf140ff4bef3fe3478fe4fc77ab43f6163d4ca95a88e363ca3e103eb0a24308",
      f157b3cc36fae38a261a44d6d81e6efb4b6f08179116c986030db6b88cdce0b3:
        "896c4450cbfe6417be7fd5945f349ad65333b3485f129a0023b1a0442ef44c5a",
      ed880ddbf71739b3bb80145950460e5812acac3bb51c27704e4d4fdb616df6ca:
        "7e22c1e0e45e9098180d348f96d1961b8a91d52897bca3b31d7b3b69579b2ea3",
      "788a2764fe936411796c703e3c197d41037d4f6894e3eef17d8e4803f55561d2":
        "83c633e7b53af557e83d8966f541d52eb7b9bc0c718aa9adf5586c5b95d06b69",
      "8c7c3eac47188d453ce519c2f4cc4a694a89365d84467f9a570cdc62f3bfe803":
        "5b9fbff417f45d5a9ebab9b7c94eb02df6ef555864ad3581eea2975a2ee14f5d",
      "07091013048e13376a39422e08e0d5ccc977f3754ac87624b20ecf43d2d7757e":
        "08748635f6dac5c5f457bea63186e82d791313929bf24bc373eda23bd9107c98",
      // Build 38833 template-save output and Enhancement profiles.
      "7d0ced840d3dc167b823ed0ad6ed411319faf97316345c8e37620e86d86f536e":
        "eeeb4b70edbba53d5ee98a50dbba395dd175e8eebdd3e3bf93f8f9fcfa428a7b",
      "3b0c52c9167381797851ab097c9c75a7340f84da729479bf4e308fa06a46d4d9":
        "3a8bbcc6252991e3e00c93731ac22dc6792f4f04b4fed528890bebf157f47e1c",
      b8c0b991ec76e38fcf888f3cb6347b523a1f38015a2a1e9e4629e658d7e3a3d0:
        "02b656f95ed5a1b8b20e6c561ff951091baa37532a8d5ee75e54e363d6ba1692",
      b92ae155065419a7ea42d906a6af55fd6b9830e852ede6b3272a51f01ecd2ef0:
        "c977cb4688b891460bec57eedd22b600dc18164a53a14d8783fbebf24b775ee9",
      "41ab635b061f64fcab8c5f6b019450bbe0825ec948ddbbc54cfd3841662e2574":
        "aa159977a25158965b6be89677afce0045b1a2373befd68561824850779c6b0b",
      "20516a6a63c527f3e87ade45fe1a9f1dc11a47fb8bdb3bac379d402999bf5112":
        "4d171805a854653fa91204b31aadb09fa128803ae45f2375234ac6d5e043b43e",
      "9ce3e81fb062c1030653f06dcc2a683ea59712555410b731ebad4024c9d34c7f":
        "550d785095e058e19a90524d13840f77aae54bec0a8a349a99b9f6da8308ea38",
      "636231e0bdb10e2c5432998bf9277749f25e9c93ac66cb7553de3bae58b6a277":
        "1cf0d9c59f56ab4d24675e461e079c79daa9bc84e53134ea4f764ca73bf7a8d2",
      "0e1c127dea275e39d543104728811eec7db9ee5c84bd732bd98c48e4ef923485":
        "43397b1c49116d7a04399a64875c0a728cb8ccb8e1960d71067b4f157b10b563",
      fed08223c3b414e9e2c8a07158573b74fccde760cc65e2831f9ca90e97da9683:
        "e51e1be614423ea86ff46430ca1b6c5749645bf2d1574abcb59584659c155fce",
      "7902cbe81dafa9aae7875f2682b20dca6b60bb03fb637d5a027df7b08c9c16a7":
        "1f43e5a77a02803170874d9e3258acd4a2a82ba9ce4a085fd70517614866a683",
      "72dd16dd1ea1b9d7642017c2df68175022177e2fb0f51da8fa8b42dc15511c7a":
        "85b9abade7f89d71a1bb2e4c726214cba49dd70fcefa0832e482cfb18ec5d57c",
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
