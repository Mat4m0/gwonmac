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
      // Build 38833 Enhancement ABI 32 profiles.
      "0d8663dd9bf005f0722d287eb3c83e9d6bfc8552f888d6e618ee7507457c244b": "8dabd1e44b4a4974d5acc573cbcb941997d75a46ff09bc872315c55ff9f85145",
      "70f1fe8c9aadb4653b3908e57254f89cb34249cc275fa8b8279df694fd190bae": "e3912fd35f29b0d0559e5c1e27ceee096d3975eb1042b1dbd49267a9626c6f3f",
      a99b11b931ecd091f6c493eb25acf128a7e2a19d360da017066ffb3f6aef5742: "d5bfd6f235134725f9d8fff3bec14b1b8fe24061a8d97c669aa2f81965d94945",
      "6e84233490f32fa754a0249132345f9b09ef98c2bd65f6858454813c20f19998": "9370ecccdcb7c8ea1748277da238e3620382b9989347ce8d67781c7db8295470",
      f764101cc5b57095fe65e32154e6571d3c543c6dae1bdfa6275f4368812beac0: "59caec70c1a0af57f00d2357f9b9353465512baa750ea03e83ac0f3b5e1b43c4",
      "794fb82a4eeb653ae8a189d2214934a4ab4c14194fbea7c9c00d2aa2c394c290": "aa0ec6d42e9dad3b8e806fd9725941e8a233d08c064dba02bd0d9c6a23152dcf",
      faa30ad12005cefe7cdd2edca5ad1af77181fe3355be10403f3b47105a96a5f9: "7d2ba9591c8cf27b919545978048e45b7374f259ccb0072fc597c3e3a7dbc243",
      c48095e2bd0c5d945226553d47c169e80142a17430772b80656d5dcf86013cc0: "2673c5d243f456fa482758ba71f9b6c6bd5690b0f7c94bd4867bcb3b0180cdf6",
      "6876309347c839dc6e95d81407a00b5615ad9c891464112d30a9f66706db997c": "cca98dfab3bff8ab088a08ab2a75713da5fed3793f1fc410143ad2eb4e5c4263",
      d7e532cdf17d217d8e970b257ea34feaf4b2d23c001ff2a9c746b023dcbdc20b: "924a26b4e270087435c089a2da0cd750f01b52238c4e1cab34909a6ca25c47da",
      c134e23276232fad22404ebe5479684416f62126473687f3c0f26945eb72ecdd: "74cbc499783f8c1afb8ed6dad4724d9a1679aca7989225287f416498a82f5dfd",
      "84be9b4d06e434ac74fa04c80cca58b6102694ac54a22072b8531aeaf2377f24": "ef7ae546f0964752a79a06bdc3cafce476279a984dafb961da7bb6d2b6f91f43",
      d11f190e2e7982da5e21636c45600bbc79a699e81bd804ef9f16f87a1da93048: "47767994fd3252bd0fcecdb5d4bc120a83e58b9f93b72e94a47c56b7263b68a2",
      e681b50367efbcc933d4c4e9f529cfffa94d38d3f0e25176e4900c66c0d0bf60: "78f64b5a2b02ac9fa6ed29f4d4d3ef1c50275b3d5b8c76c8bc9287e8e0811713",
      "15fff41f382574ec664674841e75dc2c11ff3f0877abfcfc03d92129a6b3afcc": "215f1ab006790a7a94073a40cfd3dc3f6c236c1ab5c4f5fe29a7f6091b10dd39",
      "4e1b14bc5725ca2ff1c620c6db89bd34f426ba5b4efa043d0c42280d645ceb5e": "c53198ee213a35a16d2ec59f44d3d387ec60c8ba7634e9beddf692cb236120b8",
      ac124f6c29774a2211bac75ca60694ae8a2f13494f7f4f7d220059ac467d8d80: "9328e5125f05eff7aca1e8a680b4241e11b13a3bd5bd893d66b87caf66d048de",
      d780fb35bee8fb3fbafa8a06ff24a63b787b6a90fef6714dc586eca9c2e817ba: "e7a91de9218869a56d3bbe65e050d5e54340d706581f6049ca631ea927f77d0f",
      cc15e0c84bf98aea363ff1cb23a0ad6534dd953ef0252d23a8574f1368f39565: "dd57bce6d2e1cc86913ac2679dac3b6282a9c4bf1b6282568d76ac5f3203494e",
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
