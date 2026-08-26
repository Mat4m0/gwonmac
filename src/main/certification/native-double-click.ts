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
  encodeCode,
  encodeSection,
  parseExports,
  sectionById,
  splitSections,
  uleb,
  vectorPayload,
  WASM_HEADER,
  type Section,
} from "../core/wasm-binary.js";
import {
  activeTableEvidence,
  functionBody,
  signatureMatches,
  wasmEvidence,
} from "./wasm-evidence.js";

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
      // Build 38833 Enhancement profiles.
      "8c156901f7fa5a7d1ee23b6b2f2b53ce6c511dc358974e694db208e965f5d151": "ddf3bbc72299bf6e06e55e22248681e90eae93b80b560cf9a821650b420bddbb",
      "96786cba1fac260f0924e3b1880dd65452c552c4e79b4e5e8a72e835d4cca0c8": "cd0f6854903ff49e356f4c600f3dfd821472e901119e8d9986f81b1fd8ad4991",
      "d4d2406669ef5be751843112cf7547fa640c8444bae95a23e0eaba3a2d9c1517": "0582a836960b76d001871690ba3f28b720a7087ce4274fc9f0030e455010fdf5",
      "b528291df4bd96541a8128fdd7de88b5712413fc192e6e051f71ac47459e221f": "e11f644ae081698e9f24e53ad68a0606bdcbcf3bf54d4bdd9751db3b098223ee",
      "b7dc1e345bbe85a91b5423b4fc609ab37abbe2d15a387f29cfc7fbc7534c9fec": "77c4ce9b579c451ef27a48fe889ff4e137267ea8c75f3ebaf832b9679fab2937",
      "0e4da3a2a31b6c84b12ada9f5f0ec87abdcb9c239349fa38d46aa472ecbf74df": "8d6e2fac4cb99459b139f9f29ed608973eec6c189e210d7d62fe5bdd8f3b05f6",
      "4b5f4601b3ddfe363b9fc49a8130df417b28dc7ddcc75b0cc83a6dca3d21458d": "b93ea4cf880024c74324bbc24b468533539ae6c7dd284018a91d6a8bc000393b",
      "97213e19d336ccecd26a25d20291d4ee03fdd3102f4a58a56ce4e0ea2e0353b7": "bf8dfec78038f79e93b8d85e416f6bc0b95bd69b1bbad98fa40e8d74fb063b6e",
      aca4e4ff310162036a9dccab2d9d4180f4699930ca3e9337de8529ff391d245c: "b7384d00dcfd5245d3e329901f3875088bba3bb33ea27dc36e89e13e2e2122f7",
      "80d86e2af5c5f1160610ae17482e6385ff3990e97fbfbd798e7396be810b4e84": "03287bd899c7247006fb7ccbee1b6c51841aacef24d1631062b096f70eecd650",
      "00f8385b8343231e1f61bdac7a7ada1c48946d114f812e8c0927454eea72100c": "78e5d183071ddd9e6fc83611058e96d61ac2b630bbd8a42bc8b35a6a06adc620",
      "04a0532fd2d5e6f3ecbbc050afaf47370a7f6b479431b471bf76d738a2e06e8a": "89cb4e6d802e99dc3b40f6cb0fc0f8e56da471574a726bbcffe222e1af836d28",
      "43fa20fadf5b466976505696b80d95653c9b26f661ddf86959eb1cfbca6a9693": "e32e1cf2225666e86413df9555550bf697f820ec5951c49044555d82fd22dfad",
      db8dec116c17306853f5075926b657ee1d46d9ad04ae6cd1fc683638e89b7e9f: "515e579f2892ae8ce6d6eaea9445642e018337024ad921c61b09c00afa10fa0e",
      "92fbaba14a4986ad46cd5f412eccbc51d26bd41241bb6d6eb736df6d88216df3": "4319456e9b9759a837f099fecad05502aa9060e20a0bfd037a254227e1b6bd68",
      e58f556348af308a9e13b011588baf57a2eacb1213e0d25fbda8a12eb6aaf7d6: "8e3702861e38dfd67099a5f2b69ff60927bc2edde14875c2e51d12fd95aff869",
      "36ea50a64185d69da0f5e5de02d1e20a8fefcc0402cf19be22522de5ce795974": "12ac351d160721eab874dc8243a0887dbc4ed5b54f38d4df6f01dbf8c7417bf9",
      b98fb10c37deda13b06b79b19efa9130ae70aca62c7df3da75b463bc62af2f4b: "850801fb84893e257dc9214d681628793aca2e61194cf81516f408ec05e2077a",
      cc07d6c49c6a8079679114806231ecf2d015e41b7dab1242dacd8b7687bf8869: "26bcee5c721a4fa6bea809008af35b9cd762a530eb8595fa8b53f0d6f8c3aef2",
      "58f0ce10fd231263e560e2496e07b6e152241c41e3ac0b6d04e7f13ca44ee924": "8b4bc57bd679144a34b00d2c1bd30eab5b4e290c261ad73c7d47ea20202d5024",
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

function sameStrings(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

/** Validate a relocated record that crossed the isolated-process boundary. */
export function isDerivedNativeDoubleClickBuild(
  value: unknown,
  inputSha256: string,
  baselines: readonly NativeDoubleClickBuild[] = NATIVE_DOUBLE_CLICK_BUILDS,
): value is NativeDoubleClickBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<NativeDoubleClickBuild>;
  if (
    !Number.isSafeInteger(build.callbackTableSlot)
    || (build.callbackTableSlot as number) < 0
    || !Number.isSafeInteger(build.callbackFunctionIndex)
    || (build.callbackFunctionIndex as number) < 0
    || !Number.isSafeInteger(build.flagStoreOffset)
    || (build.flagStoreOffset as number) < 0
    || !Number.isSafeInteger(build.flagStoreFrameOffset)
    || (build.flagStoreFrameOffset as number) < 0
    || typeof build.callbackBodySha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(build.callbackBodySha256)
    || !build.derivations
    || typeof build.derivations !== "object"
    || Object.keys(build.derivations).length !== 1
    || !/^[0-9a-f]{64}$/.test(build.derivations[inputSha256] ?? "")
  ) return false;
  return baselines.some((baseline) =>
    build.callbackBodySha256 === baseline.callbackBodySha256
    && build.flagStoreOffset === baseline.flagStoreOffset
    && build.flagStoreFrameOffset === baseline.flagStoreFrameOffset
    && sameStrings(build.callbackParams, baseline.callbackParams)
    && sameStrings(build.callbackResults, baseline.callbackResults)
  );
}

/** Locate an unchanged callback semantically when only the predecessor hash moved. */
export function deriveNativeDoubleClickBuild(
  input: Uint8Array,
  baselines: readonly NativeDoubleClickBuild[] = NATIVE_DOUBLE_CLICK_BUILDS,
): NativeDoubleClickBuild | null {
  try {
    const evidence = wasmEvidence(input);
    if (!evidence) return null;
    const module = evidence.moduleView();
    const table = activeTableEvidence(module.elementSection);
    if (table.overwrittenSlots.length > 0) return null;
    const tableRelations = table.relations;
    const inputSha256 = evidence.inputSha256;
    const matches: NativeDoubleClickBuild[] = [];
    for (const baseline of baselines) {
      const candidates = module.bodies.flatMap((body, localIndex) =>
        sha256(body) === baseline.callbackBodySha256
          ? [localIndex + module.functionImportCount]
          : [],
      );
      if (candidates.length !== 1) continue;
      const callbackFunctionIndex = candidates[0]!;
      const callbackSlots = tableRelations.get(callbackFunctionIndex) ?? [];
      if (
        callbackSlots.length !== 1 ||
        !signatureMatches(
          module,
          callbackFunctionIndex,
          baseline.callbackParams,
          baseline.callbackResults,
        )
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
 * Rewrites one semantically certified module. Production obtains unknown-build
 * evidence in the isolated verifier; this synchronous helper is used by local
 * qualification and accepts the same unique callback/table proof.
 */
export function rewriteNativeDoubleClickWasm(input: Uint8Array): Uint8Array {
  const build = deriveNativeDoubleClickBuild(input);
  if (!build) fail("module does not prove the native double-click callback");
  return rewriteWithBuild(input, build);
}

/**
 * The rewrite itself, against an entry supplied rather than looked up. The
 * production caller supplies the isolated verifier's record; this is separated
 * so production performs and checks the transform again before publication.
 */
export function rewriteWithBuild(
  input: Uint8Array,
  build: NativeDoubleClickBuild,
): Uint8Array {
  const sections = splitSections(input);
  const evidence = wasmEvidence(input);
  if (!evidence) fail("invalid or unsupported input module");
  const module = evidence.moduleView();
  const table = activeTableEvidence(module.elementSection);
  if (table.overwrittenSlots.length > 0) {
    fail(`duplicate active table slot ${table.overwrittenSlots[0]}`);
  }
  const callbackSlots = table.relations.get(build.callbackFunctionIndex) ?? [];
  if (!callbackSlots.includes(build.callbackTableSlot)) {
    const held = [...table.relations].find(([, slots]) =>
      slots.includes(build.callbackTableSlot))?.[0];
    fail(
      `table slot ${build.callbackTableSlot} holds function ${held}, `
        + `not ${build.callbackFunctionIndex}`,
    );
  }

  const bodies = module.bodies;
  const localIndex = build.callbackFunctionIndex - module.functionImportCount;
  const body = functionBody(module, build.callbackFunctionIndex);
  if (!body) fail(`function ${build.callbackFunctionIndex} has no body`);
  if (
    !signatureMatches(
      module,
      build.callbackFunctionIndex,
      build.callbackParams,
      build.callbackResults,
    )
  ) fail("the mousedown callback does not have the certified signature");
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
