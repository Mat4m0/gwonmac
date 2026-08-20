/**
 * Opt-in 4 GiB profile for structurally equivalent ArenaNet generations.
 *
 * This is one paired transform. wasm32 addresses above 2 GiB arrive in
 * JavaScript as negative i32 values, so publishing the larger WASM memory
 * without the matching unsigned-pointer glue is never allowed. The installed
 * manifest binds that glue to its official WASM generation; the isolated proof
 * then checks every audited conversion before Main repeats the transform.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  type EnhancementCapabilityProfile,
} from "../../shared/enhancement-contracts.js";
import { writeAtomic, writeAtomicJson } from "../core/atomic-file.js";
import {
  readPublishedClientManifest,
  verifyPublishedClientArtifacts,
} from "../core/published-client.js";
import { clientManifestPath } from "../core/paths.js";
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

export const EXTENDED_MEMORY_TRANSFORM_ABI = 2;
export const EXTENDED_MEMORY_MAX_PAGES = 65_535;
export const EXTENDED_MEMORY_MAX_BYTES = EXTENDED_MEMORY_MAX_PAGES * 65_536;
export const EXTENDED_MEMORY_PROFILES = Object.freeze([
  "off",
  ...Object.keys(ENHANCEMENT_CAPABILITY_PROFILES),
] as ("off" | EnhancementCapabilityProfile)[]);
export type ExtendedMemoryProfile = "off" | EnhancementCapabilityProfile;

/** Exact generated-glue semantics, with only relocatable ASM_CONSTS keys erased. */
export const EXTENDED_MEMORY_JS_PROOF = Object.freeze({
  asmConstCount: 59,
  normalizedSha256:
    "5ce37be431dfc71f1cef5294ffc112953faaffe22f09d0dd7b07ae7f40bc1db8",
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

/** Derive the candidate bytes from the sole exact memory declaration. */
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

/** Raise only the sole defined memory from 32,768 to 65,535 pages. */
export function rewriteExtendedMemoryWasm(input: Uint8Array): Uint8Array {
  return deriveExtendedMemoryWasm(input);
}

/**
 * Erases only the numeric keys ArenaNet's linker assigns to ASM_CONSTS.
 * Function bodies, order, whitespace, counts and all pointer expressions stay
 * byte-for-byte significant.
 */
export function normalizeExtendedMemoryJsForProof(input: string): string | null {
  const startMarker = "var ASM_CONSTS = {\r\n";
  const endMarker = "\r\n};\r\nfunction __asyncjs__";
  const start = input.indexOf(startMarker);
  const end = input.indexOf(endMarker, start + startMarker.length);
  if (
    start < 0 || end < 0
    || input.indexOf(startMarker, start + startMarker.length) !== -1
    || input.indexOf(endMarker, end + endMarker.length) !== -1
  ) return null;
  let count = 0;
  const normalizedBlock = input.slice(start, end).replace(
    /^(\s*)\d+: /gm,
    (_whole, whitespace: string) => {
      count += 1;
      return `${whitespace}<asm-const-key>: `;
    },
  );
  if (count !== EXTENDED_MEMORY_JS_PROOF.asmConstCount) return null;
  return input.slice(0, start) + normalizedBlock + input.slice(end);
}

/**
 * Apply Emscripten's CAN_ADDRESS_2GB unsigned-pointer lowering to the pinned
 * generated glue. The shifts and heap accesses were audited for this exact
 * input; this function never accepts an arbitrary script.
 */
export function rewriteExtendedMemoryJs(input: string): string {
  const normalized = normalizeExtendedMemoryJsForProof(input);
  if (
    normalized === null
    || sha256(normalized) !== EXTENDED_MEMORY_JS_PROOF.normalizedSha256
  ) {
    fail("JavaScript glue semantics changed");
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
  return output;
}

export interface ExtendedMemoryStructuralProof {
  readonly jsInputSha256: string;
  readonly jsOutputSha256: string;
  readonly wasmInputSha256: string;
  readonly wasmOutputSha256: string;
}

/** Pure structural proof used inside the bounded utility process. */
export function deriveExtendedMemoryStructuralProof(
  jsInput: string,
  wasmInput: Uint8Array,
): ExtendedMemoryStructuralProof {
  return Object.freeze({
    jsInputSha256: sha256(jsInput),
    jsOutputSha256: sha256(rewriteExtendedMemoryJs(jsInput)),
    wasmInputSha256: sha256(wasmInput),
    wasmOutputSha256: sha256(rewriteExtendedMemoryWasm(wasmInput)),
  });
}

export function isExtendedMemoryStructuralProof(
  value: unknown,
  jsInputSha256: string,
  wasmInputSha256: string,
): value is ExtendedMemoryStructuralProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<ExtendedMemoryStructuralProof>;
  return proof.jsInputSha256 === jsInputSha256
    && proof.wasmInputSha256 === wasmInputSha256
    && typeof proof.jsOutputSha256 === "string"
    && /^[0-9a-f]{64}$/.test(proof.jsOutputSha256)
    && typeof proof.wasmOutputSha256 === "string"
    && /^[0-9a-f]{64}$/.test(proof.wasmOutputSha256);
}

export interface ExtendedMemoryArtifacts {
  readonly jsPath: string;
  readonly wasmPath: string;
  readonly profile: ExtendedMemoryProfile;
}

interface ExtendedMemoryMetadata {
  abi?: unknown;
  generationFingerprint?: unknown;
  jsInputSha256?: unknown;
  jsOutputSha256?: unknown;
  wasmInputSha256?: unknown;
  wasmOutputSha256?: unknown;
  profile?: unknown;
}

interface ExtendedMemoryProof {
  readonly generationFingerprint: string;
  readonly jsInputSha256: string;
  readonly jsOutputSha256: string;
  readonly wasmInputSha256: string;
  readonly wasmOutputSha256: string;
  readonly profile: ExtendedMemoryProfile;
}

function artifactPaths(
  cacheRoot: string,
  proof: ExtendedMemoryProof,
): Omit<ExtendedMemoryArtifacts, "profile"> & {
  readonly cacheDir: string;
  readonly metadataPath: string;
} {
  const identity = sha256(
    `${proof.generationFingerprint}:${proof.profile}:${proof.jsInputSha256}:${proof.wasmInputSha256}`,
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
  proof: ExtendedMemoryProof,
): Promise<boolean> {
  const files = artifactPaths(cacheRoot, proof);
  try {
    const metadata = JSON.parse(
      await readFile(files.metadataPath, "utf8"),
    ) as ExtendedMemoryMetadata;
    if (
      metadata.abi !== EXTENDED_MEMORY_TRANSFORM_ABI
      || metadata.generationFingerprint !== proof.generationFingerprint
      || metadata.jsInputSha256 !== proof.jsInputSha256
      || metadata.jsOutputSha256 !== proof.jsOutputSha256
      || metadata.wasmInputSha256 !== proof.wasmInputSha256
      || metadata.wasmOutputSha256 !== proof.wasmOutputSha256
      || metadata.profile !== proof.profile
    ) return false;
    const [jsStat, wasmStat, jsHash, wasmHash] = await Promise.all([
      stat(files.jsPath),
      stat(files.wasmPath),
      fileSha256(files.jsPath),
      fileSha256(files.wasmPath),
    ]);
    return jsStat.isFile() && wasmStat.isFile()
      && jsHash === proof.jsOutputSha256
      && wasmHash === proof.wasmOutputSha256;
  } catch {
    return false;
  }
}

async function verifiedGenerationFingerprint(
  officialJsPath: string,
  officialWasmPath: string,
): Promise<string | null> {
  const artifactsDir = path.dirname(officialJsPath);
  if (
    path.dirname(officialWasmPath) !== artifactsDir
    || path.basename(officialJsPath) !== "Gw.jspi.js"
    || path.basename(officialWasmPath) !== "Gw.jspi.wasm"
  ) return null;
  try {
    const manifest = await readPublishedClientManifest(
      clientManifestPath(artifactsDir),
    );
    return manifest.clientFingerprint
      && await verifyPublishedClientArtifacts(artifactsDir, manifest) === true
      ? manifest.clientFingerprint
      : null;
  } catch {
    return null;
  }
}

/**
 * Atomically selects a proved JS/WASM pair. `null` means the pair is unsupported
 * and both official artifacts must be served unchanged.
 */
export async function prepareExtendedMemoryArtifacts(
  officialJsPath: string,
  officialWasmPath: string,
  inputWasmPath: string,
  profile: ExtendedMemoryProfile,
  cacheRoot: string,
  verifyUnknown: (options: {
    jsPath: string;
    jsInputSha256: string;
    wasmPath: string;
    wasmInputSha256: string;
  }) => Promise<ExtendedMemoryStructuralProof | null> = async () => null,
): Promise<ExtendedMemoryArtifacts | null> {
  const [generationFingerprint, jsInput, wasmInput] = await Promise.all([
    verifiedGenerationFingerprint(officialJsPath, officialWasmPath),
    readFile(officialJsPath, "utf8"),
    readFile(inputWasmPath),
  ]);
  if (!generationFingerprint || !EXTENDED_MEMORY_PROFILES.includes(profile)) {
    await rm(cacheRoot, { recursive: true, force: true });
    return null;
  }
  const jsInputSha256 = sha256(jsInput);
  const wasmInputSha256 = sha256(wasmInput);
  const structural = await verifyUnknown({
    jsPath: officialJsPath,
    jsInputSha256,
    wasmPath: inputWasmPath,
    wasmInputSha256,
  });
  if (!isExtendedMemoryStructuralProof(
    structural,
    jsInputSha256,
    wasmInputSha256,
  )) {
    await rm(cacheRoot, { recursive: true, force: true });
    return null;
  }
  let jsOutput: string;
  let wasmOutput: Uint8Array;
  try {
    jsOutput = rewriteExtendedMemoryJs(jsInput);
    wasmOutput = rewriteExtendedMemoryWasm(wasmInput);
  } catch {
    await rm(cacheRoot, { recursive: true, force: true });
    return null;
  }
  if (
    sha256(jsOutput) !== structural.jsOutputSha256
    || sha256(wasmOutput) !== structural.wasmOutputSha256
  ) fail("production transform disagrees with isolated proof");
  const proof: ExtendedMemoryProof = Object.freeze({
    generationFingerprint,
    ...structural,
    profile,
  });
  const files = artifactPaths(cacheRoot, proof);
  if (await usable(cacheRoot, proof)) {
    return { jsPath: files.jsPath, wasmPath: files.wasmPath, profile };
  }

  await rm(cacheRoot, { recursive: true, force: true });
  await mkdir(files.cacheDir, { recursive: true });
  await Promise.all([
    writeAtomic(files.jsPath, jsOutput),
    writeAtomic(files.wasmPath, wasmOutput),
  ]);
  await writeAtomicJson(files.metadataPath, {
    abi: EXTENDED_MEMORY_TRANSFORM_ABI,
    ...proof,
  });
  if (!await usable(cacheRoot, proof)) {
    fail("published artifact pair failed verification");
  }
  return { jsPath: files.jsPath, wasmPath: files.wasmPath, profile };
}
