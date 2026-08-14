/**
 * Opt-in 4 GiB research profile for exact ArenaNet builds 38797 and 38833.
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
    ...rows(38_797, [
      ["cursor", "73e0f9966c1427a3fafb9b39031da1881a7d7b6f11bf5ad87c2eea32c4c8242a", "caa9a32d0936c15a6ba83f511b0c5eabeecc05edb103f41573f066b52225889d"],
      ["target", "232034754c23d5e38bf8af92301a2bdf8ad8d9b0a3a8902fb3d9e9cb3cdfaf2b", "83335d3411353f65830add602510cf4167c7c69edda44ebeb887dadfed01ff97"],
      ["cursorTarget", "e806674f7601c4db88b28b37a361f0aec9cc6fc44d0e3358b230cd08304dcb68", "b2090100dfdf7e9e10d0d0c0e6f0bafdb9840dff2867b1c92d40c1a079bcb5f2"],
      ["party", "a15e1cbf0e5e0cca399ef7632cbb0349ad93b7f66ae1a412c6ccb3ab5c92a988", "6d6d3ffd6d71e052e5b45ab7abeab7fad53fa5375be2ca2baba9323a61dfd813"],
      ["cursorParty", "68dfea06f43660278defcfacf79d31cb5e39a5c1ed3924db4cc256718f00432d", "8cfc782803097d461b503ea40d01e177b6dcb2127a877c5fbfa1d05f3a0aaef5"],
      ["targetParty", "0bf140ff4bef3fe3478fe4fc77ab43f6163d4ca95a88e363ca3e103eb0a24308", "daf0a3785ac78106d94bd2fd473ccf22e5c2d44ce179240cb860048f85f83e7d"],
      ["cursorTargetParty", "896c4450cbfe6417be7fd5945f349ad65333b3485f129a0023b1a0442ef44c5a", "ab98f7097550e62af8bc24e77aba50eca9fe8b343dced0a9c39b33b70e2c3a95"],
      ["partyCommands", "7e22c1e0e45e9098180d348f96d1961b8a91d52897bca3b31d7b3b69579b2ea3", "c63bd43c3e765135e7d40621cdc663193ff114ade9a0d6fa305723a447a96cf1"],
      ["cursorPartyCommands", "83c633e7b53af557e83d8966f541d52eb7b9bc0c718aa9adf5586c5b95d06b69", "c7a0a1985021c0f29afdaa9e47d7e7fe0bfa39b56089c57de6a18c1f0c35dc7e"],
      ["targetPartyCommands", "5b9fbff417f45d5a9ebab9b7c94eb02df6ef555864ad3581eea2975a2ee14f5d", "5f1da357b9c2c38d0422cc2d34451ada66c996bf9fb363c94674f100e10656b1"],
      ["cursorTargetPartyCommands", "08748635f6dac5c5f457bea63186e82d791313929bf24bc373eda23bd9107c98", "d8f4fe954e8103730a0b4bac30db4eb036a11c1557fd3cc5e4fadbbc8d33d412"],
    ]),
    Object.freeze({
      buildId: 38_833 as const,
      profile: "off" as const,
      inputSha256: "eeeb4b70edbba53d5ee98a50dbba395dd175e8eebdd3e3bf93f8f9fcfa428a7b",
      outputSha256: "99ac8364243d7755ad0869b6a4b0edc00e8037823d0cea2e560ffc5edeb1bda4",
    }),
    ...rows(38_833, [
      ["cursor", "3a8bbcc6252991e3e00c93731ac22dc6792f4f04b4fed528890bebf157f47e1c", "06e5c31c8302f0ef11ba1bb4f5cb02f0118d1434474df9a0a4b0a3ec7e18d5e5"],
      ["target", "02b656f95ed5a1b8b20e6c561ff951091baa37532a8d5ee75e54e363d6ba1692", "2829319e336c2ffcd3920bf90dad3f4773ff5689d17f75edb9a6345784170399"],
      ["cursorTarget", "c977cb4688b891460bec57eedd22b600dc18164a53a14d8783fbebf24b775ee9", "c5108a7399136d9d2ebcae58f77d8a542c99bb718e23defbd97d036703905ec7"],
      ["party", "aa159977a25158965b6be89677afce0045b1a2373befd68561824850779c6b0b", "63e5ae9165d76405e353ca01055b7930698199c3e4d6fef0701717f59a51f7df"],
      ["cursorParty", "4d171805a854653fa91204b31aadb09fa128803ae45f2375234ac6d5e043b43e", "5bbaa0aa78be16d1512cd37e12b058eeacbfb150d69839c5b9b8d03df80edc7d"],
      ["targetParty", "550d785095e058e19a90524d13840f77aae54bec0a8a349a99b9f6da8308ea38", "8093f59f54c1f02f7cbf11ce5efe8c1462fbb427c21f408e5198e5f83b8eaf7c"],
      ["cursorTargetParty", "1cf0d9c59f56ab4d24675e461e079c79daa9bc84e53134ea4f764ca73bf7a8d2", "235c9894f34b070053e2e5888fc6b239cb8f2c05fd9f94186c2016cb5af0ee66"],
      ["partyCommands", "43397b1c49116d7a04399a64875c0a728cb8ccb8e1960d71067b4f157b10b563", "4a5b47279a98d06c32867f7d1b1637d0df0d5aa184d7f843d06f37ac47491487"],
      ["cursorPartyCommands", "e51e1be614423ea86ff46430ca1b6c5749645bf2d1574abcb59584659c155fce", "f4da4d0bef465945ee1c29f4d62a5fe42cf3526298b4c3c47862e4292a9f4baf"],
      ["targetPartyCommands", "1f43e5a77a02803170874d9e3258acd4a2a82ba9ce4a085fd70517614866a683", "0b9d6ca555e7cca03217de6d9548d3b7b09e177d406db8153183f98f7807b575"],
      ["cursorTargetPartyCommands", "85b9abade7f89d71a1bb2e4c726214cba49dd70fcefa0832e482cfb18ec5d57c", "a3975399e5b4f2b41e75c6f1faf8ae3470ebd3239da74aec6ca1aaa73097b4d0"],
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
