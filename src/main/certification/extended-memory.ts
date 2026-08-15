/**
 * Opt-in 4 GiB research profile for exact, reproducible ArenaNet derivatives.
 *
 * This is one paired transform. wasm32 addresses above 2 GiB arrive in
 * JavaScript as negative i32 values, so publishing the larger WASM memory
 * without the matching unsigned-pointer glue is never allowed.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { writeAtomic, writeAtomicJson } from "../core/atomic-file.js";
import {
  concat,
  encodeSection,
  readUleb,
  splitSections,
  uleb,
  WASM_HEADER,
  type Section,
} from "../core/wasm-binary.js";

declare const WebAssembly: { validate(bytes: Uint8Array): boolean };

export const EXTENDED_MEMORY_TRANSFORM_ABI = 1;
export const EXTENDED_MEMORY_MAX_PAGES = 65_535;
export const EXTENDED_MEMORY_MAX_BYTES = EXTENDED_MEMORY_MAX_PAGES * 65_536;
export const EXTENDED_MEMORY_PROFILES = [
  "off",
  "cursor",
  "target",
  "cursorTarget",
  "party",
  "cursorParty",
  "targetParty",
  "cursorTargetParty",
  "partyCommands",
  "cursorPartyCommands",
  "targetPartyCommands",
  "cursorTargetPartyCommands",
  "partyStorage",
  "cursorPartyStorage",
  "targetPartyStorage",
  "cursorTargetPartyStorage",
  "partyCommandsStorage",
  "cursorPartyCommandsStorage",
  "targetPartyCommandsStorage",
  "cursorTargetPartyCommandsStorage",
] as const;
export type ExtendedMemoryProfile = (typeof EXTENDED_MEMORY_PROFILES)[number];

export interface ExtendedMemoryWasmBuild {
  readonly buildId: 38_797 | 38_833;
  readonly profile: ExtendedMemoryProfile;
  readonly inputSha256: string;
  readonly outputSha256: string;
}

type ExtendedMemoryRow = readonly [
  profile: Exclude<ExtendedMemoryProfile, "off">,
  inputSha256: string,
  outputSha256: string,
];

function rows(
  buildId: ExtendedMemoryWasmBuild["buildId"],
  entries: readonly ExtendedMemoryRow[],
): readonly ExtendedMemoryWasmBuild[] {
  return entries.map(([profile, inputSha256, outputSha256]) => Object.freeze({
    buildId,
    profile,
    inputSha256,
    outputSha256,
  }));
}

/** Every post-double-click variant the current production chain can emit. */
export const EXTENDED_MEMORY_WASM_BUILDS: readonly ExtendedMemoryWasmBuild[] =
  Object.freeze([
    Object.freeze({
      buildId: 38_797 as const,
      profile: "off" as const,
      inputSha256: "e7d86cfcf7b09abbedd3afca758dbf4a3f3c6e1aa4d44e53b31e45e886d7f250",
      outputSha256: "862f97fc87267e3b4d342ea01f15834cc60a7be982fd9741cf0ae31b8a18a00b",
    }),
    Object.freeze({
      buildId: 38_833 as const,
      profile: "off" as const,
      inputSha256: "eeeb4b70edbba53d5ee98a50dbba395dd175e8eebdd3e3bf93f8f9fcfa428a7b",
      outputSha256: "99ac8364243d7755ad0869b6a4b0edc00e8037823d0cea2e560ffc5edeb1bda4",
    }),
    ...rows(38_833, [
      ["cursor", "4792a6c167ce4f530439b0586d44d21f8e9f3e101b36b85653aa9358c413c86b", "8e5bbe42e464a0257139f6df059e9963dde065617f9351c15636cf8945b8025f"],
      ["target", "5d5da7b300b08b79edcd1a4f7487725f166e45e31d68adb99aae6f9c87b1a60a", "3170469d790e6d858dd9a8bfd5e82b3d9bb5fdc20ff23c63b9bd6d66636f7da6"],
      ["cursorTarget", "da86cc6e930668d5b3c9ca4fcb62b8a3f22314f4bdb526397f9e7aa6c9ad84dc", "e6be7527817c93573c2fd73a30fd7b8526613adfc7f72f18f4dde837e2632a3c"],
      ["party", "52f27f9ead6bc55f49d6f52b240b0bc47b4176b76f5bf7526182751fcfcffb7c", "904be027639ea3442e795bc105fa0b184e588506e86827fa8f9482b5508601eb"],
      ["cursorParty", "fb18d1c57b17daeedd150e63dafe5cb155bad030518887b36e1411900a3b61a8", "e1a792b3bbe5f3fe09445b606d1f2f11d9b166d1e21c2897a5bc44737ea47684"],
      ["targetParty", "e3f2b856c3f8070f0541e058a1464f37a02521d9c8c66c05126175b644a28168", "26a2f6cd8ff2da31baea29d33ca8e4a5a933e35c424215647fdfd1136a0acbf9"],
      ["cursorTargetParty", "f6d12501e2ce505b402ebeb7c8a8acb91e71ebebe3730ccbb788c4fd6e5c5c89", "f375e2af2e8844c1b91fad29bfde396cb609101aeb7c6c49c4a7a90c214e3e18"],
      ["partyCommands", "63dd3273fb9b89ef44564ee40ffaebba5c2b6605e7cd2b47718c9fce0d9d8628", "3acfbf6f41e60f038217029b12f241388d2d2c872ad842f21e256a2e8c6dc3b2"],
      ["cursorPartyCommands", "2cda0d522d1af3a4bde6ab86cd0c88cb41070d6a032cb8fb6f155b3be9a08e3c", "fccda6f7fd18a8aaa008fa1148b072a7275350acb90087b9fd561acbee728c07"],
      ["targetPartyCommands", "95929a07e1c9f5fe5676debae7ce1ad025ccc2a8d6f0e5f2bf65ad30e052bdda", "be9a0d6ccb9df2cea2d77a453844e35c7daf2f668a7504061c5d2b43b758e485"],
      ["cursorTargetPartyCommands", "19aef2e32b6e87750620f6216169749514f80dda1fce62279ef7151758815909", "23d959ebd6abaa0c0ab4e3d25a7bc61392199b393893c69ae98bfdfcba25a119"],
      ["partyStorage", "2e5ce2efa84e5db5a6cb083d5d822c70f14ffa3c60d4e3b3e14cf2757ef7c545", "093b165db32fa0117b4b7af868af47f66824c51e975a0eb8bcaa205716906487"],
      ["cursorPartyStorage", "03ae7398b747a83e11a10ea61dee20f0fb4be363d3e204b820a1bf7c0538fd3a", "07904c7ccc72e10bdb575026fc49dada8dd9b2dfa912b0faccf93ca406b38923"],
      ["targetPartyStorage", "f0d1f9b7029a38d27337d33bfc7dce8fc3bd3492402af27c1b561b6ed71bad68", "dcc29ee5e0a4100e16dc5ac311cb71acfb1d733d3f6992c97199d968157d5882"],
      ["cursorTargetPartyStorage", "7e7e008a9a223720e2e03f36b2649590250eac5e4206ce81cabf33bbd320420d", "e1164b3c64bb79645d270c7af8b656ec360624c26b9651659d94c28615e8be3b"],
      ["partyCommandsStorage", "69f95e247a53ef88871891be3bd9bb615f090657ba0b86cab24a0d9843ee66ac", "85da677fdc2ba7fac0bb433f24fdeae14bc10b42e8898fda74757e280c8e127c"],
      ["cursorPartyCommandsStorage", "1d2569784d6f3113747a91e306fc230b13ad81e7f8a12de11e1831e37906a191", "5a3e5d9bede3100fe61a7b2a45ac7099b4ecfde9d77bbae1220a247332609ab4"],
      ["targetPartyCommandsStorage", "f2af03906e2994a72ebb66ab740c7ad372a9c37114b0198760cf12f536c1a6fd", "7e6ffb020b661119d66d3ac4cae4a7b026b976d2d26e828c2cd285f4df0fa841"],
      ["cursorTargetPartyCommandsStorage", "bfec94006f69f6a6212ae513f41fc70d6ba09515f49ee1cc36c7b29d65db6264", "f0fdf44f9a00651df14b09f94169c194d07d279959b499c8f12f0f532313e6f6"],
    ]),
  ]);

export const EXTENDED_MEMORY_JS_BUILD = Object.freeze({
  buildId: 38_797,
  inputSha256: "58ecc6377397f01919d8def58e802e19fbfd6ce13f421dbf14123a667e34f7d0",
  outputSha256: "1dd5d798b1491f46a7c128c641053c8488211bbc193fe40bdf1d7a886517993d",
});

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

function fail(message: string): never {
  throw new Error(`extended-memory transform: ${message}`);
}

function replaceExactly(
  source: string,
  search: string,
  replacement: string,
  expectedCount: number,
): string {
  const parts = source.split(search);
  if (parts.length - 1 !== expectedCount) {
    fail(`expected ${expectedCount} occurrences of ${JSON.stringify(search)}`);
  }
  return parts.join(replacement);
}

export function findExtendedMemoryWasmBuild(
  inputSha256: string,
): ExtendedMemoryWasmBuild | null {
  return EXTENDED_MEMORY_WASM_BUILDS.find(
    (build) => build.inputSha256 === inputSha256,
  ) ?? null;
}

/** Derive the candidate bytes; callers still need an exact input/output certificate. */
export function deriveExtendedMemoryWasm(input: Uint8Array): Uint8Array {
  const sections = splitSections(input);
  const memory = sections.find((section) => section.id === 5)
    ?? fail("missing memory section");
  const cursor = { offset: 0 };
  const count = readUleb(memory.body, cursor);
  const flags = readUleb(memory.body, cursor);
  const initial = readUleb(memory.body, cursor);
  const maximum = readUleb(memory.body, cursor);
  if (
    count !== 1 || flags !== 1 || initial !== 4_096 || maximum !== 32_768
    || cursor.offset !== memory.body.byteLength
  ) {
    fail("memory declaration is not the certified 256 MiB / 2 GiB shape");
  }
  const replacement: Section = {
    id: 5,
    body: concat(uleb(1), uleb(1), uleb(initial), uleb(EXTENDED_MEMORY_MAX_PAGES)),
  };
  const output = concat(
    WASM_HEADER,
    ...sections.map((section) =>
      encodeSection(section === memory ? replacement : section)),
  );
  if (!WebAssembly.validate(output)) fail("rewritten module does not validate");
  return output;
}

/** Raise the sole defined memory from 32,768 to 65,535 pages. */
export function rewriteExtendedMemoryWasm(input: Uint8Array): Uint8Array {
  const build = findExtendedMemoryWasmBuild(sha256(input));
  if (!build) fail("uncertified WASM input");
  const output = deriveExtendedMemoryWasm(input);
  if (sha256(output) !== build.outputSha256) fail("derived WASM hash changed");
  return output;
}

/**
 * Apply Emscripten's CAN_ADDRESS_2GB unsigned-pointer lowering to the pinned
 * generated glue. The shifts and heap accesses were audited for this exact
 * input; this function never accepts an arbitrary script.
 */
export function rewriteExtendedMemoryJs(input: string): string {
  if (sha256(input) !== EXTENDED_MEMORY_JS_BUILD.inputSha256) {
    fail("uncertified JavaScript input");
  }
  let output = replaceExactly(input, "      2147483648;", "      4294901760;", 1);
  output = replaceExactly(
    output,
    "      4294901760;\r\n  \r\n  var alignMemory",
    "      4294901760;\r\n  Module['gwonmacHeapCapBytes'] = 4294901760;\r\n  \r\n  var alignMemory",
    1,
  );

  let signedShiftCount = 0;
  output = output.replace(/(?<!>)>>(?!>)/g, () => {
    signedShiftCount += 1;
    return ">>>";
  });
  if (signedShiftCount !== 327) fail("signed-shift audit count changed");

  let heapIndexCount = 0;
  output = output.replace(
    /\b(HEAP(?:U?8|U?16|U?32|F32|F64))\[([^\]\r\n]+)\]/g,
    (_whole, heap: string, index: string) => {
      heapIndexCount += 1;
      return `${heap}[((${index}) >>> 0)]`;
    },
  );
  if (heapIndexCount !== 341) fail("heap-index audit count changed");

  output = replaceExactly(
    output,
    "  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {\r\n  ",
    "  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {\r\n      idx >>>= 0;\r\n  ",
    1,
  );
  output = replaceExactly(
    output,
    "  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {\r\n",
    "  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {\r\n      outIdx >>>= 0;\r\n",
    1,
  );

  let viewOffsetCount = 0;
  output = output.replace(
    /new ((?:Big)?Uint(?:8|16|32|64)Array)\(Module\.HEAPU8\.buffer, ([^,\r\n]+),/g,
    (_whole, view: string, offset: string) => {
      viewOffsetCount += 1;
      return `new ${view}(Module.HEAPU8.buffer, ((${offset}) >>> 0),`;
    },
  );
  if (viewOffsetCount !== 7) fail("typed-array offset audit count changed");

  output = replaceExactly(
    output,
    "HEAP8.set(contents, ptr);",
    "HEAP8.set(contents, ptr >>> 0);",
    1,
  );
  output = replaceExactly(
    output,
    "Module.HEAPU8.set(data, dataPtr);",
    "Module.HEAPU8.set(data, dataPtr >>> 0);",
    1,
  );
  output = replaceExactly(
    output,
    "Module.HEAPU8.set(array, responseBody);",
    "Module.HEAPU8.set(array, responseBody >>> 0);",
    1,
  );
  output = replaceExactly(
    output,
    "Module.image.readAsync(imageId, offset, null, buffer, bytes)",
    "Module.image.readAsync(imageId, offset, null, buffer >>> 0, bytes)",
    2,
  );
  if (sha256(output) !== EXTENDED_MEMORY_JS_BUILD.outputSha256) {
    fail("derived JavaScript hash changed");
  }
  return output;
}

export interface ExtendedMemoryArtifacts {
  readonly jsPath: string;
  readonly wasmPath: string;
  readonly profile: ExtendedMemoryProfile;
}

interface ExtendedMemoryMetadata {
  abi?: unknown;
  jsInputSha256?: unknown;
  jsOutputSha256?: unknown;
  wasmInputSha256?: unknown;
  wasmOutputSha256?: unknown;
  profile?: unknown;
}

function artifactPaths(
  cacheRoot: string,
  build: ExtendedMemoryWasmBuild,
): Omit<ExtendedMemoryArtifacts, "profile"> & {
  readonly cacheDir: string;
  readonly metadataPath: string;
} {
  const identity = sha256(
    `${EXTENDED_MEMORY_JS_BUILD.inputSha256}:${build.inputSha256}`,
  );
  const cacheDir = path.join(cacheRoot, identity, String(EXTENDED_MEMORY_TRANSFORM_ABI));
  return {
    cacheDir,
    jsPath: path.join(cacheDir, "Gw.jspi.js"),
    wasmPath: path.join(cacheDir, "Gw.jspi.wasm"),
    metadataPath: path.join(cacheDir, "metadata.json"),
  };
}

async function fileSha256(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

async function usable(
  cacheRoot: string,
  build: ExtendedMemoryWasmBuild,
): Promise<boolean> {
  const files = artifactPaths(cacheRoot, build);
  try {
    const metadata = JSON.parse(
      await readFile(files.metadataPath, "utf8"),
    ) as ExtendedMemoryMetadata;
    if (
      metadata.abi !== EXTENDED_MEMORY_TRANSFORM_ABI
      || metadata.jsInputSha256 !== EXTENDED_MEMORY_JS_BUILD.inputSha256
      || metadata.jsOutputSha256 !== EXTENDED_MEMORY_JS_BUILD.outputSha256
      || metadata.wasmInputSha256 !== build.inputSha256
      || metadata.wasmOutputSha256 !== build.outputSha256
      || metadata.profile !== build.profile
    ) return false;
    const [jsStat, wasmStat, jsHash, wasmHash] = await Promise.all([
      stat(files.jsPath),
      stat(files.wasmPath),
      fileSha256(files.jsPath),
      fileSha256(files.wasmPath),
    ]);
    return jsStat.isFile() && wasmStat.isFile()
      && jsHash === EXTENDED_MEMORY_JS_BUILD.outputSha256
      && wasmHash === build.outputSha256;
  } catch {
    return false;
  }
}

/**
 * Atomically selects a certified JS/WASM pair. `null` means this exact pair is
 * unsupported and both official artifacts must be served unchanged.
 */
export async function prepareExtendedMemoryArtifacts(
  officialJsPath: string,
  inputWasmPath: string,
  cacheRoot: string,
): Promise<ExtendedMemoryArtifacts | null> {
  const [jsInput, wasmInput] = await Promise.all([
    readFile(officialJsPath, "utf8"),
    readFile(inputWasmPath),
  ]);
  const build = findExtendedMemoryWasmBuild(sha256(wasmInput));
  if (sha256(jsInput) !== EXTENDED_MEMORY_JS_BUILD.inputSha256 || !build) {
    await rm(cacheRoot, { recursive: true, force: true });
    return null;
  }
  const files = artifactPaths(cacheRoot, build);
  if (await usable(cacheRoot, build)) {
    return { jsPath: files.jsPath, wasmPath: files.wasmPath, profile: build.profile };
  }

  const jsOutput = rewriteExtendedMemoryJs(jsInput);
  const wasmOutput = rewriteExtendedMemoryWasm(wasmInput);
  await rm(cacheRoot, { recursive: true, force: true });
  await mkdir(files.cacheDir, { recursive: true });
  await Promise.all([
    writeAtomic(files.jsPath, jsOutput),
    writeAtomic(files.wasmPath, wasmOutput),
  ]);
  await writeAtomicJson(files.metadataPath, {
    abi: EXTENDED_MEMORY_TRANSFORM_ABI,
    jsInputSha256: EXTENDED_MEMORY_JS_BUILD.inputSha256,
    jsOutputSha256: EXTENDED_MEMORY_JS_BUILD.outputSha256,
    wasmInputSha256: build.inputSha256,
    wasmOutputSha256: build.outputSha256,
    profile: build.profile,
  });
  if (!await usable(cacheRoot, build)) {
    fail("published artifact pair failed verification");
  }
  return { jsPath: files.jsPath, wasmPath: files.wasmPath, profile: build.profile };
}
