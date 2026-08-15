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
      ["cursor", "8dabd1e44b4a4974d5acc573cbcb941997d75a46ff09bc872315c55ff9f85145", "0c2e0d326e2f5a4ffdd00790c9eac067b4e8fe806a7a0d13cc4da511cf8a0671"],
      ["target", "e3912fd35f29b0d0559e5c1e27ceee096d3975eb1042b1dbd49267a9626c6f3f", "efc2f7137b6be56ce471c619d2d5e58674e543c4de0209b2fc72cff6983cacdc"],
      ["cursorTarget", "d5bfd6f235134725f9d8fff3bec14b1b8fe24061a8d97c669aa2f81965d94945", "d577452370f03ab3fae6496602f335184232f1b61e5d2b1e2bf82f76d502e8cf"],
      ["party", "9370ecccdcb7c8ea1748277da238e3620382b9989347ce8d67781c7db8295470", "47caf4ae8b4809a455b862b4fa96e7744e60adcef2367698fb6b98dc51d22a4a"],
      ["cursorParty", "59caec70c1a0af57f00d2357f9b9353465512baa750ea03e83ac0f3b5e1b43c4", "8b7fcc4d6b6712031e14956986d93b69ec0039d016ededfe204de5a0691782ed"],
      ["targetParty", "aa0ec6d42e9dad3b8e806fd9725941e8a233d08c064dba02bd0d9c6a23152dcf", "41b9b2c5a1e61332b9215ad6ad025e13d84c3dbb81022f3632e868fecb2b02f8"],
      ["cursorTargetParty", "7d2ba9591c8cf27b919545978048e45b7374f259ccb0072fc597c3e3a7dbc243", "db3d96813e26277f5eb90673e40f79ce597913ba3d5e552c753799f647ffe25e"],
      ["partyCommands", "2673c5d243f456fa482758ba71f9b6c6bd5690b0f7c94bd4867bcb3b0180cdf6", "f848561e38b456211207c1df931f77602a2429501fcfb010106f9709aea2ccf9"],
      ["cursorPartyCommands", "cca98dfab3bff8ab088a08ab2a75713da5fed3793f1fc410143ad2eb4e5c4263", "5036c13011e1306598dab2859484e95847b16086066ff05aa637ab250b2884c7"],
      ["targetPartyCommands", "924a26b4e270087435c089a2da0cd750f01b52238c4e1cab34909a6ca25c47da", "ea028efac51d1fd86f6fa4b0aa1c10460b6a0e434e3c582a7b76e2a6f4b9a53d"],
      ["cursorTargetPartyCommands", "74cbc499783f8c1afb8ed6dad4724d9a1679aca7989225287f416498a82f5dfd", "60059e7c56f7208b832ee2abc78e47d6beed73ea14d3633e6a8acea9b21b6c3c"],
      ["partyStorage", "ef7ae546f0964752a79a06bdc3cafce476279a984dafb961da7bb6d2b6f91f43", "c356b58de45060393f8afdd40fd0bf5a7e31f525d314590df02865273e2fbfb2"],
      ["cursorPartyStorage", "47767994fd3252bd0fcecdb5d4bc120a83e58b9f93b72e94a47c56b7263b68a2", "12eba1dc0e7ab68df3082342635cb33edce69219dac2e192c29c556284b3629d"],
      ["targetPartyStorage", "78f64b5a2b02ac9fa6ed29f4d4d3ef1c50275b3d5b8c76c8bc9287e8e0811713", "221b2d9b6e7ca2617816e5e92dc1b37f4bd776026cacfaf69f4c7f9b4261bd67"],
      ["cursorTargetPartyStorage", "215f1ab006790a7a94073a40cfd3dc3f6c236c1ab5c4f5fe29a7f6091b10dd39", "f5bec8b6721a3851603443b5e89da9961eb9ee8ae45cfaf989a3a87c58c6dd3b"],
      ["partyCommandsStorage", "c53198ee213a35a16d2ec59f44d3d387ec60c8ba7634e9beddf692cb236120b8", "4056fd7ff77f80e199490314223073e23fb81eb675ac8c5a61a9056201ff48a4"],
      ["cursorPartyCommandsStorage", "9328e5125f05eff7aca1e8a680b4241e11b13a3bd5bd893d66b87caf66d048de", "62d96a6bff01d570d61bbe5a8f265f7fd2aa3925535705bee6a05ec493a3f521"],
      ["targetPartyCommandsStorage", "e7a91de9218869a56d3bbe65e050d5e54340d706581f6049ca631ea927f77d0f", "b0d53dd1582a82dae5b03ec37f61e7d7bb362d117412e29781d072a28d66c182"],
      ["cursorTargetPartyCommandsStorage", "dd57bce6d2e1cc86913ac2679dac3b6282a9c4bf1b6282568d76ac5f3203494e", "77c5355cb5531289fc8504f6d00aff0542512787006da2f1ae53b6a21ef610b9"],
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
