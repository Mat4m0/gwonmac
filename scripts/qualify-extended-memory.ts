/** Offline proof that the retained build's complete production chain crosses 2 GiB. */
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveExtendedMemoryStructuralProof,
  EXTENDED_MEMORY_JS_PROOF,
  EXTENDED_MEMORY_MAX_BYTES,
  prepareExtendedMemoryArtifacts,
  rewriteExtendedMemoryJs,
  rewriteExtendedMemoryWasm,
} from "../src/main/certification/extended-memory.js";
import {
  preparePostTemplateSaveModule,
} from "../src/main/certification/template-save-verifier.js";
import { transformEnhancementWasm } from "../src/main/certification/enhancement-transform.js";
import {
  deriveNativeDoubleClickBuild,
  rewriteWithBuild,
} from "../src/main/certification/native-double-click.js";
import {
  ENHANCEMENT_BUILDS,
  enhancementProfilesForBuild,
} from "../src/main/certification/enhancement-builds.js";
import {
  enhancementCapabilitiesForProfile,
} from "../src/shared/enhancement-contracts.js";
import {
  certificationFromLocalVerification,
} from "../src/main/certification/client-certification.js";
import { prepareClientModule } from "../src/main/certification/client-module.js";
import {
  verifyLocalClientBytes,
} from "../src/main/certification/local-client-verifier.js";

const [jsPath, wasmPath] = process.argv.slice(2);
if (!jsPath || !wasmPath) {
  throw new Error(
    "usage: qualify-extended-memory.ts <official Gw.jspi.js> <official Gw.jspi.wasm>",
  );
}

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
const [officialJs, officialWasm] = await Promise.all([
  readFile(jsPath, "utf8"),
  readFile(wasmPath),
]);
const verifyExtendedMemory = async (options: {
  jsPath: string;
  wasmPath: string;
}) => deriveExtendedMemoryStructuralProof(
  await readFile(options.jsPath, "utf8"),
  await readFile(options.wasmPath),
);
const transformedJs = rewriteExtendedMemoryJs(officialJs);
const jsInputSha256 = sha256(officialJs);
const jsOutputSha256 = sha256(transformedJs);
new Function(transformedJs);

const verification = verifyLocalClientBytes(officialWasm);
const preparedTemplate = preparePostTemplateSaveModule(officialWasm);
const enhancementBuild = verification.enhancementBuild;
if (!preparedTemplate || !enhancementBuild) {
  throw new Error("official WASM did not pass the local semantic verifier");
}
const templateWasm = preparedTemplate.bytes;

function withNativeDoubleClick(input: Uint8Array): Uint8Array {
  const build = deriveNativeDoubleClickBuild(input);
  if (!build) throw new Error("native double-click proof failed");
  return rewriteWithBuild(input, build);
}

const predecessors = new Map<string, Uint8Array>();
predecessors.set("off", withNativeDoubleClick(templateWasm));
const profileBaseline = ENHANCEMENT_BUILDS.at(-1);
if (!profileBaseline) throw new Error("Enhancement profile fixture is missing");
for (const profile of enhancementProfilesForBuild(profileBaseline)) {
  const capabilities = enhancementCapabilitiesForProfile(profile);
  if (!capabilities) throw new Error(`invalid certified profile ${profile}`);
  const profileVerification = verifyLocalClientBytes(officialWasm, capabilities);
  const profileBuild = profileVerification.enhancementBuild;
  if (!profileBuild) {
    throw new Error(`semantic verification refused profile ${profile}`);
  }
  predecessors.set(
    profile,
    withNativeDoubleClick(
      transformEnhancementWasm(templateWasm, profileBuild, capabilities),
    ),
  );
}

const scratch = await mkdtemp(join(tmpdir(), "gwonmac-4gb-qualification-"));
try {
  const predecessorPath = join(scratch, "Gw.jspi.wasm");
  const cacheRoot = join(scratch, "cache");
  const predecessor = predecessors.get("off");
  if (!predecessor) throw new Error("Enhancements-off predecessor is missing");
  await writeFile(predecessorPath, predecessor);
  const first = await prepareExtendedMemoryArtifacts(
    jsPath,
    wasmPath,
    predecessorPath,
    sha256(predecessor),
    "off",
    cacheRoot,
    verifyExtendedMemory,
  );
  const cached = await prepareExtendedMemoryArtifacts(
    jsPath,
    wasmPath,
    predecessorPath,
    sha256(predecessor),
    "off",
    cacheRoot,
    verifyExtendedMemory,
  );
  if (
    first?.profile !== "off"
    || cached?.jsPath !== first.jsPath
    || cached?.wasmPath !== first.wasmPath
  ) throw new Error("paired artifact cache did not reproduce its exact output");

  await writeFile(first.jsPath, "corrupt");
  const repaired = await prepareExtendedMemoryArtifacts(
    jsPath, wasmPath, predecessorPath, sha256(predecessor), "off", cacheRoot,
    verifyExtendedMemory,
  );
  if (!repaired || sha256(await readFile(repaired.jsPath)) !== jsOutputSha256) {
    throw new Error("corrupt paired cache was not rebuilt from proof");
  }
  const substituted = await prepareExtendedMemoryArtifacts(
    jsPath, wasmPath, predecessorPath, "0".repeat(64), "off", cacheRoot,
    verifyExtendedMemory,
  );
  if (substituted !== null) {
    throw new Error("4 GB preparation accepted a predecessor with the wrong chain hash");
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

const variants = [];
let allocatorModule: Uint8Array | null = null;
let offOutputSha256: string | null = null;
for (const [profile, predecessor] of predecessors) {
  const output = rewriteExtendedMemoryWasm(predecessor);
  if (!WebAssembly.validate(Uint8Array.from(output))) {
    throw new Error(`${profile} output does not validate`);
  }
  const inputSha256 = sha256(predecessor);
  const outputSha256 = sha256(output);
  if (profile === "off") offOutputSha256 = outputSha256;
  if (profile !== "off" && allocatorModule === null) allocatorModule = output;
  variants.push({
    profile,
    inputSha256,
    outputSha256,
  });
}
if (!allocatorModule || !offOutputSha256) {
  throw new Error("required qualification variant is missing");
}

const selectionScratch = await mkdtemp(join(tmpdir(), "gwonmac-4gb-selection-"));
try {
  const officialJsPath = jsPath;
  const officialWasmPath = wasmPath;
  const officialSha256 = sha256(officialWasm);
  const selected = await prepareClientModule({
    officialJsPath,
    officialWasmPath,
    officialSha256,
    certification: certificationFromLocalVerification(verification),
    enhancementCapabilities: {
      nativeCursor: false,
      targetObservation: false,
      partyObservation: false,
      teamApply: false,
      travelAction: false,
      xunlaiAction: false,
      chatAliases: false,
    },
    compatibilityCacheRoot: join(selectionScratch, "compatibility"),
    enhancementCacheRoot: join(selectionScratch, "enhancements"),
    nativeDoubleClickCacheRoot: join(selectionScratch, "double-click"),
    extendedMemoryCacheRoot: join(selectionScratch, "extended-memory"),
    extendedMemoryEnabled: true,
  }, async ({ wasmPath: candidatePath }) =>
    deriveNativeDoubleClickBuild(await readFile(candidatePath)), verifyExtendedMemory);
  if (
    selected.extendedMemory.status !== "active"
    || selected.extendedMemory.profile !== "off"
    || sha256(await readFile(selected.jsPath)) !== jsOutputSha256
    || sha256(await readFile(selected.wasmPath))
      !== offOutputSha256
  ) throw new Error("production client selection did not publish the certified pair");
} finally {
  await rm(selectionScratch, { recursive: true, force: true });
}

const module = new WebAssembly.Module(Uint8Array.from(allocatorModule));
const state: { memory?: WebAssembly.Memory } = {};
const imports: WebAssembly.Imports = {};
for (const entry of WebAssembly.Module.imports(module)) {
  const namespace = (imports[entry.module] ??= {}) as Record<string, unknown>;
  if (entry.kind !== "function") {
    throw new Error(`unsupported ${entry.kind} import ${entry.module}.${entry.name}`);
  }
  namespace[entry.name] = entry.name === "emscripten_resize_heap"
    ? (requested: number) => {
        const memory = state.memory;
        if (!memory) throw new Error("heap growth requested during instantiation");
        const target = requested >>> 0;
        if (target > EXTENDED_MEMORY_MAX_BYTES) return 0;
        const current = memory.buffer.byteLength;
        if (target <= current) return 1;
        memory.grow(Math.ceil((target - current) / 65_536));
        return 1;
      }
    : () => 0;
}
const instance = await WebAssembly.instantiate(module, imports);
const exports = instance.exports as {
  memory: WebAssembly.Memory;
  malloc(bytes: number): number;
  free(pointer: number): void;
};
const memory = exports.memory;
state.memory = memory;

const allocationBytes = 480 * 1_024 * 1_024;
const pointers: number[] = [];
let highPointer: number | undefined;
for (let index = 0; index < 7; index += 1) {
  const raw = exports.malloc(allocationBytes);
  if (raw === 0) throw new Error(`allocation ${index + 1} failed`);
  pointers.push(raw);
  if ((raw >>> 0) >= 0x8000_0000) highPointer ??= raw;
}
if (highPointer === undefined || memory.buffer.byteLength <= 0xc000_0000) {
  throw new Error("allocator did not grow above 3 GiB");
}

const highAddress = highPointer >>> 0;
const view = new DataView(memory.buffer);
view.setUint32(highAddress, 0x4757_3447, true);
if (view.getUint32(highAddress, true) !== 0x4757_3447) {
  throw new Error("high-address read/write failed");
}
const capacityBeforeFree = memory.buffer.byteLength;
for (const pointer of pointers) exports.free(pointer);
const reused = exports.malloc(allocationBytes);
if (reused === 0 || memory.buffer.byteLength !== capacityBeforeFree) {
  throw new Error("freed allocation was not reused without heap growth");
}
exports.free(reused);

console.log(JSON.stringify({
  jsInputSha256,
  jsOutputSha256,
  normalizedJsSha256: EXTENDED_MEMORY_JS_PROOF.normalizedSha256,
  variants,
  heapBytes: capacityBeforeFree,
  highPointerUnsigned: highAddress,
  crossed3GiB: true,
  freedBlockReusedWithoutGrowth: true,
}, null, 2));
