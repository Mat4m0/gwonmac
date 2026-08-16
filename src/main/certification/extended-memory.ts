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
  "storage",
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
      ["cursor", "ddf3bbc72299bf6e06e55e22248681e90eae93b80b560cf9a821650b420bddbb", "20754c8cf5f06475408a3b0232ed470a56df2e7e2613c120cea8dfa5fff61342"],
      ["target", "cd0f6854903ff49e356f4c600f3dfd821472e901119e8d9986f81b1fd8ad4991", "16d74f3379591866f0c4d45485937f0a042b36cdf49ceee2621728e81cc6d63a"],
      ["cursorTarget", "0582a836960b76d001871690ba3f28b720a7087ce4274fc9f0030e455010fdf5", "b9e7136d0dafd753b2911d93a31d4802490604db4449c66c4d89df9a09dbc6e0"],
      ["party", "e11f644ae081698e9f24e53ad68a0606bdcbcf3bf54d4bdd9751db3b098223ee", "404a679073821971f687d1437c04d0ec73bbcf7c56778786024bce7dbecd96f5"],
      ["cursorParty", "77c4ce9b579c451ef27a48fe889ff4e137267ea8c75f3ebaf832b9679fab2937", "a83c4261ebbdb7076b1772585d5059a551f8f15f6fd888b5854d2fcd7f39571e"],
      ["targetParty", "8d6e2fac4cb99459b139f9f29ed608973eec6c189e210d7d62fe5bdd8f3b05f6", "424f1bd263006d8dab544b0fd07f0402d482df7ebfdc466c9a22cf333a7ed5e9"],
      ["cursorTargetParty", "b93ea4cf880024c74324bbc24b468533539ae6c7dd284018a91d6a8bc000393b", "59b6bba939df57d7d4efb32b79717bef75a84ecefa5c0352d5940955f7b87f45"],
      ["partyCommands", "bf8dfec78038f79e93b8d85e416f6bc0b95bd69b1bbad98fa40e8d74fb063b6e", "6010a866dd572e419cf0a815d01435bc9d84cf30dfc1a59e338f4b9d5b4bea5b"],
      ["cursorPartyCommands", "b7384d00dcfd5245d3e329901f3875088bba3bb33ea27dc36e89e13e2e2122f7", "1e4e37044d98c8bb1d3819aecd38cf8c567e6a5bd3381ad1c56caf209ef221ae"],
      ["targetPartyCommands", "03287bd899c7247006fb7ccbee1b6c51841aacef24d1631062b096f70eecd650", "99c28c2d22f9e0eae5fa58f60df65b592373e738ebb48929b4ffd87e35b6f2e1"],
      ["cursorTargetPartyCommands", "78e5d183071ddd9e6fc83611058e96d61ac2b630bbd8a42bc8b35a6a06adc620", "a1b2eb4fab238524fe9eb0e39f8a1fce28a91d0aaf918c0d96ba9004db137209"],
      ["storage", "89cb4e6d802e99dc3b40f6cb0fc0f8e56da471574a726bbcffe222e1af836d28", "103fc4f309d3ecd6eba6ad4593ec537583f922fdd49770a18b24170ba4585270"],
      ["partyStorage", "e32e1cf2225666e86413df9555550bf697f820ec5951c49044555d82fd22dfad", "10a694d1c20e20ae86f4dda02c98daef1233df0dee1aac05d87448439eec2980"],
      ["cursorPartyStorage", "515e579f2892ae8ce6d6eaea9445642e018337024ad921c61b09c00afa10fa0e", "58495dee230de14fac572660dd33a0deb4de20cd1e8f2abba701ae4247859b8a"],
      ["targetPartyStorage", "4319456e9b9759a837f099fecad05502aa9060e20a0bfd037a254227e1b6bd68", "48a31dd10f6385f25ecb67ce441fee9dd5b8a3c0ca2aff7020f2a6ac49676eb9"],
      ["cursorTargetPartyStorage", "8e3702861e38dfd67099a5f2b69ff60927bc2edde14875c2e51d12fd95aff869", "d97fd566136d9dc000b70bd7f2e59447da592461c4a182e9160e2bef335ca0c2"],
      ["partyCommandsStorage", "12ac351d160721eab874dc8243a0887dbc4ed5b54f38d4df6f01dbf8c7417bf9", "6316583221d4c2990d2db2e5d545b09675349d35edc83aa724a353dbbeefbfc7"],
      ["cursorPartyCommandsStorage", "850801fb84893e257dc9214d681628793aca2e61194cf81516f408ec05e2077a", "abb5270a621c70f73abef167f9041d1c922cf5e7fd2720da278c41d871f9d0ce"],
      ["targetPartyCommandsStorage", "26bcee5c721a4fa6bea809008af35b9cd762a530eb8595fa8b53f0d6f8c3aef2", "638560bd09d8267511b9f18a82408729deb4de6a1eeb9926ef1ff7e9859c95f6"],
      ["cursorTargetPartyCommandsStorage", "8b4bc57bd679144a34b00d2c1bd30eab5b4e290c261ad73c7d47ea20202d5024", "64f5808bca1dfc2b4d492be9e8e9c03cde222813960afc172661f2c03cd0ce54"],
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
