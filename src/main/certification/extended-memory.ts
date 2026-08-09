/**
 * Opt-in 4 GiB research profile for exact ArenaNet build 38797.
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
export const EXTENDED_MEMORY_RESEARCH_ENABLED =
  process.env.GWONMAC_EXTENDED_MEMORY_RESEARCH === "1";
export const EXTENDED_MEMORY_MAX_PAGES = 65_535;
export const EXTENDED_MEMORY_MAX_BYTES = EXTENDED_MEMORY_MAX_PAGES * 65_536;
export const EXTENDED_MEMORY_PROFILES = [
  "off",
  "cursor",
  "target",
  "cursorTarget",
  "cursorToolbox",
  "cursorToolboxCommands",
  "cursorTargetToolboxCommands",
] as const;
export type ExtendedMemoryProfile = (typeof EXTENDED_MEMORY_PROFILES)[number];

export interface ExtendedMemoryWasmBuild {
  readonly buildId: 38_797;
  readonly profile: ExtendedMemoryProfile;
  readonly inputSha256: string;
  readonly outputSha256: string;
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
      buildId: 38_797 as const,
      profile: "cursor" as const,
      inputSha256: "7b5af185fc2a6cb11ba5833f65b259ddd3069c3cdf14634f9efa14bf4b4bc8ba",
      outputSha256: "4df4d655f9815c252e4b1b61c69c2fef38eb15df6e9e2e5453104312a3bf6f39",
    }),
    Object.freeze({
      buildId: 38_797 as const,
      profile: "target" as const,
      inputSha256: "bb185bb54a0959517c69cc303b5a678bdbb59062d76bd4187c49f67d1d82f54d",
      outputSha256: "6554c91398e7afe914fccddc3b9a66d441008387df258691ba36ff36843a24c4",
    }),
    Object.freeze({
      buildId: 38_797 as const,
      profile: "cursorTarget" as const,
      inputSha256: "f5a72a7d6ddd55d4ff836543ccd89b5a65aacb1c1ee49968bdca8ee56a1e1cfd",
      outputSha256: "6f0b59e1b8bfc99131ebc78a6f934cd5f45de9cd10e4336c33e81d72504ba7d6",
    }),
    Object.freeze({
      buildId: 38_797 as const,
      profile: "cursorToolbox" as const,
      inputSha256: "045b1e3d985552f00d1ab21fe3007552df91ffbc0807d4b5dddcc54ce78dbc2a",
      outputSha256: "be6cef0eb228023816ca85ea3a6c7ba37d69424b067325f59138548a6ac516be",
    }),
    Object.freeze({
      buildId: 38_797 as const,
      profile: "cursorToolboxCommands" as const,
      inputSha256: "5656ee7775aa70f30b6d6d2e62cb924a2be088ffb4e359a24832056f8ab71c1c",
      outputSha256: "72796b63dc20353701f716caca510726728178541410946e4af38567efb693e0",
    }),
    Object.freeze({
      buildId: 38_797 as const,
      profile: "cursorTargetToolboxCommands" as const,
      inputSha256: "f968fe035db695300394fbc3600ac17fc103c94f13dde27f603cd23ecbe22b4b",
      outputSha256: "633711c7bde61d11190f137a97f889483ca8239ec39a19c4e328cf5ab67d877b",
    }),
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

/** Raise the sole defined memory from 32,768 to 65,535 pages. */
export function rewriteExtendedMemoryWasm(input: Uint8Array): Uint8Array {
  const build = findExtendedMemoryWasmBuild(sha256(input));
  if (!build) fail("uncertified WASM input");
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
