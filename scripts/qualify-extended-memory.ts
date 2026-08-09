/** Offline proof that build 38797's complete production chain crosses 2 GiB. */
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXTENDED_MEMORY_JS_BUILD,
  EXTENDED_MEMORY_MAX_BYTES,
  EXTENDED_MEMORY_WASM_BUILDS,
  prepareExtendedMemoryArtifacts,
  rewriteExtendedMemoryJs,
  rewriteExtendedMemoryWasm,
} from "../src/main/certification/extended-memory.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
} from "../src/main/certification/template-save-compat.js";
import { findEnhancementBuild } from "../src/main/certification/enhancement-builds.js";
import { transformEnhancementWasm } from "../src/main/certification/enhancement-transform.js";
import { rewriteNativeDoubleClickWasm } from "../src/main/certification/native-double-click.js";
import { ENHANCEMENT_CAPABILITY_PROFILES } from "../src/shared/enhancement-contracts.js";
import { certifyClientBuild } from "../src/main/certification/client-certification.js";
import { prepareClientModule } from "../src/main/certification/client-module.js";

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
const transformedJs = rewriteExtendedMemoryJs(officialJs);
if (sha256(transformedJs) !== EXTENDED_MEMORY_JS_BUILD.outputSha256) {
  throw new Error("transformed JavaScript does not match its certified hash");
}
new Function(transformedJs);

const templateBuild = findTemplateSaveBuild(sha256(officialWasm));
if (!templateBuild) throw new Error("official WASM is not template-save certified");
const templateWasm = rewriteTemplateSaveWasm(officialWasm, templateBuild);
const enhancementBuild = findEnhancementBuild(sha256(templateWasm));
if (!enhancementBuild) throw new Error("template output is not Enhancement certified");

const predecessors = new Map<string, Uint8Array>();
predecessors.set("off", rewriteNativeDoubleClickWasm(templateWasm));
for (const [profile, capabilities] of Object.entries(
  ENHANCEMENT_CAPABILITY_PROFILES,
)) {
  predecessors.set(
    profile,
    rewriteNativeDoubleClickWasm(
      transformEnhancementWasm(templateWasm, enhancementBuild, capabilities),
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
    predecessorPath,
    cacheRoot,
  );
  const cached = await prepareExtendedMemoryArtifacts(
    jsPath,
    predecessorPath,
    cacheRoot,
  );
  if (
    first?.profile !== "off"
    || cached?.jsPath !== first.jsPath
    || cached?.wasmPath !== first.wasmPath
  ) throw new Error("paired artifact cache did not reproduce its exact output");

  const changed = Uint8Array.from(predecessor);
  changed[changed.byteLength - 1] = changed[changed.byteLength - 1]! ^ 1;
  await writeFile(predecessorPath, changed);
  if (
    await prepareExtendedMemoryArtifacts(jsPath, predecessorPath, cacheRoot)
    !== null
  ) throw new Error("changed WASM pair was not refused");
  if (await stat(cacheRoot).then(() => true, () => false)) {
    throw new Error("refused pair left a stale derived cache");
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

const variants = [];
let allocatorModule: Uint8Array | null = null;
for (const build of EXTENDED_MEMORY_WASM_BUILDS) {
  const predecessor = predecessors.get(build.profile);
  if (!predecessor || sha256(predecessor) !== build.inputSha256) {
    throw new Error(`${build.profile} predecessor does not match certification`);
  }
  const output = rewriteExtendedMemoryWasm(predecessor);
  if (
    sha256(output) !== build.outputSha256
    || !WebAssembly.validate(Uint8Array.from(output))
  ) {
    throw new Error(`${build.profile} output does not match certification`);
  }
  if (build.profile === "cursorToolbox") allocatorModule = output;
  variants.push({
    profile: build.profile,
    inputSha256: build.inputSha256,
    outputSha256: build.outputSha256,
  });
}
if (!allocatorModule) throw new Error("allocator qualification variant is missing");

const selectionScratch = await mkdtemp(join(tmpdir(), "gwonmac-4gb-selection-"));
try {
  const officialJsPath = join(selectionScratch, "official", "Gw.jspi.js");
  const officialWasmPath = join(selectionScratch, "official", "Gw.jspi.wasm");
  await mkdir(join(selectionScratch, "official"), { recursive: true });
  await Promise.all([
    writeFile(officialJsPath, officialJs),
    writeFile(officialWasmPath, officialWasm),
  ]);
  const officialSha256 = sha256(officialWasm);
  const selected = await prepareClientModule({
    officialJsPath,
    officialWasmPath,
    officialSha256,
    certification: certifyClientBuild(officialSha256),
    enhancementCapabilities: {
      nativeCursor: false,
      targetObservation: false,
      toolbox: false,
      commands: false,
    },
    compatibilityCacheRoot: join(selectionScratch, "compatibility"),
    enhancementCacheRoot: join(selectionScratch, "enhancements"),
    nativeDoubleClickCacheRoot: join(selectionScratch, "double-click"),
    extendedMemoryCacheRoot: join(selectionScratch, "extended-memory"),
  });
  if (
    selected.extendedMemory.status !== "active"
    || selected.extendedMemory.profile !== "off"
    || sha256(await readFile(selected.jsPath)) !== EXTENDED_MEMORY_JS_BUILD.outputSha256
    || sha256(await readFile(selected.wasmPath))
      !== EXTENDED_MEMORY_WASM_BUILDS[0]!.outputSha256
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
for (let index = 0; index < 6; index += 1) {
  const raw = exports.malloc(allocationBytes);
  if (raw === 0) throw new Error(`allocation ${index + 1} failed`);
  pointers.push(raw);
  if ((raw >>> 0) >= 0x8000_0000) highPointer ??= raw;
}
if (highPointer === undefined || memory.buffer.byteLength <= 0x8000_0000) {
  throw new Error("allocator did not cross 2 GiB");
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
  jsInputSha256: EXTENDED_MEMORY_JS_BUILD.inputSha256,
  jsOutputSha256: EXTENDED_MEMORY_JS_BUILD.outputSha256,
  variants,
  heapBytes: capacityBeforeFree,
  highPointerUnsigned: highAddress,
  crossed2GiB: true,
  freedBlockReusedWithoutGrowth: true,
}, null, 2));
