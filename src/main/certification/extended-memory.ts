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
      ["cursor", "e5da9e585b729686b8947677a35768443a1d40f26413a33640dee98495c62702", "556116ed0fb8afe4fdb5e44c7a0335cd13f489752f84e6a4fff56f914dd95c88"],
      ["target", "75c1976551a1af976b62d483962a2b1111891f19bce81105b131c5a2467c42e6", "a9d53f5ce196a0127194066bdd7ac9a3a5a7021f1bb09c0be0e54e30eab4b905"],
      ["cursorTarget", "08e289c0fbe06bd7d18bade47dbf6baccd59cd7349b76d2bb923d6d790682a52", "bf5cd6db7adf4f7e1ecde773d17135bfe5c08e797bda45ad258761bc95713384"],
      ["party", "b3a497ee3ff7ca6976648b07744c811a7758bb3d4e3a72de4bcff001923ff28a", "1a068fc1f419b103b5093e79d41dda94b798ac534d07c4e9ed252d0b450462eb"],
      ["cursorParty", "b8c73572d73e5d9eac92a89215718219776d4fe288cdc100e7027ee172ce0b9b", "c1ff9dd5611ae84bcd7cde7c4ed2c29ef9c3983a6e692a7a517955f345e59ab0"],
      ["targetParty", "17b9a62a1a3a4a7e00bad63f61a5412cebf6d87265005b4df6040ecb1adae86b", "06b266f3cf14468c76f4585407efb4d6fbe7e3c312f2dad59fcb846adc344783"],
      ["cursorTargetParty", "fcba4be3f23a0d306704a721209af3d358f219cc2f5275fab7146d0a006d862e", "807b19de9bc199e3721a849629dc2e7b13a2ae9e9765bc246e16ffdec6112548"],
      ["partyCommands", "13b958a0ea703ed5e34d2e7b4ae02e0ce9e4b572643b654e51a779b02ec0deb3", "ea21f5fdceb6280a15326058bc9495d83f2962e7ea6b99f404b7272f815acf93"],
      ["cursorPartyCommands", "e99e8814c7c3865a3b7e1603781d2c01b2c6815e8a019d0112fa217c8239851c", "d121051aa1830cb3c1cb698c930402b30af18806bad864ccf146aec6c6e25c67"],
      ["targetPartyCommands", "1cebf123aea5373359cab9fefdcf759c1e3b4062d0cf700b80d4073197ced4df", "b63d53b57215f27e8d0cb1710fd34081cb8439224bb47c571d4e11208e739dec"],
      ["cursorTargetPartyCommands", "0b0bcc9f2b543345fa06883f139e3e654df8fb50199d58b3d48546355db6c28b", "f87056e2989cdd0da6deec066a319aaa40c6cecad50305d2cec5d7b75ee4bdc0"],
      ["partyStorage", "2fec578bfc3fed4e98de56f13d68e4a38aba078f0831c2225b9032d81ad4c47e", "73e03fa00f34cc30374f2d225c770d09127b988e42a29f2c2a56ceb0a5e8d2e4"],
      ["cursorPartyStorage", "dc39ca631b5949980fbdc3f8fdad132914eaa00c873a6872ad367e30fc6a887d", "69e7dfd12d573771566cddc9f165137db2b643673c7f6e354439b24cf07d5b64"],
      ["targetPartyStorage", "8ec2ee0aadfb4932edd9a12d2074ea9f3ce50cbcf2a44255069f6f6518f9a762", "255b4819255ef22057efba1ee84d8d4ca50bfa60579413642e174ab7ac2d46c9"],
      ["cursorTargetPartyStorage", "3241aad41eb3d87a9f9ab35c7d7cca20bd9996db208270079d9fe37bbd5f6f5f", "8d0771d7a9267713a4df342e90d7a15ce5c7392622122d4f0650d597569e35d1"],
      ["partyCommandsStorage", "fa5916e8cbd47586f20c2fcba2d0515d23a79883d20eebb292706bc115f12df7", "cdb2e9d474fc061504b0a521dfe403ac20651311ac013ba9b11aa9862995d545"],
      ["cursorPartyCommandsStorage", "cf9996a6cebd8711a0dfaaa659095687d9d95c4f96c59673fc002dec16f8fc37", "b6cf4551095fe69f8cefb09293c1a6bb7c93ea0a143fb14009c5c18479459e8c"],
      ["targetPartyCommandsStorage", "a161958b509776fc1a87d249fcd6cd7e08520815d4547070c2a9d8f3aad2445f", "7273175aa54464fa98870f42c37abceb87cc46e4362ee70e8d53d30985c116d6"],
      ["cursorTargetPartyCommandsStorage", "18efc7d5f20cbdcf32416413119890d2f6d1ca6a329cd47bf9719665c723d756", "ddde2def48eb9f3136638b33209acf3a59b19a050917460b43fbb0acc6353fdd"],
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
