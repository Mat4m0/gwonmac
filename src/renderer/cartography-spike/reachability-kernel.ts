/**
 * Loads the sealed, pointer-private reachability side module. Native graph
 * addresses never cross this boundary; callers receive one copied cell bitset.
 */
import {
  CARTOGRAPHY_REACHABILITY_ABI,
  CARTOGRAPHY_REACHABILITY_EXPORTS,
  CARTOGRAPHY_REACHABILITY_IMPORTS,
  CARTOGRAPHY_REACHABILITY_MAX_CELLS,
  CARTOGRAPHY_REACHABILITY_REGION_BYTES,
  CARTOGRAPHY_REACHABILITY_RUNTIME_ALIGN,
  CARTOGRAPHY_REACHABILITY_RUNTIME_BYTES,
  cartographyReachabilitySignatureBytes,
} from "../../shared/cartography-reachability-kernel-contract.js";

const MAGIC = 0x5257_4347;
const HEADER_BYTES = 72;
const WALKABLE_TERRAIN_BITS_OFFSET = 552_008;
const MAX_TERRAIN_RASTER_CELLS = 262_144;
const READY = 1;

export type CartographyReachabilitySnapshot = Readonly<{
  status: number;
  sequence: number;
  mapId: number;
  areaEpoch: number;
  layoutId: CartographyMemoryLayoutId;
  width: number;
  height: number;
  resourceGeneration: number;
  totalTrapezoids: number;
  reachableTrapezoids: number;
  groundCells: number;
  doorwayCount: number;
  reachableCells: Readonly<{ words: Uint32Array }>;
  walkableTerrain: Readonly<{
    mapLeft: number;
    mapTop: number;
    mapUnitsPerPixel: number;
    width: number;
    height: number;
    words: Uint32Array;
  }>;
}>;

export type CartographyReachabilityDiagnostic = Readonly<{
  status: number;
  sequence: number;
  mapId: number;
  areaEpoch: number;
  layoutId: number;
  width: number;
  height: number;
  resourceGeneration: number;
  totalTrapezoids: number;
  reachableTrapezoids: number;
  groundCells: number;
  doorwayCount: number;
  terrainWidth: number;
  terrainHeight: number;
}>;

export type CartographyReachabilityController = Readonly<{
  sha256: string | null;
  classify(input: Readonly<{
    layoutId: CartographyMemoryLayoutId;
    mapId: number;
    areaEpoch: number;
    playerId: number;
    worldAnchorX: number;
    worldAnchorY: number;
    width: number;
    height: number;
    mapMinX: number;
    mapMinY: number;
    mapMaxX: number;
    mapMaxY: number;
    revealRadius: 1 | 3;
  }>): CartographyReachabilitySnapshot | null;
  diagnostic(): CartographyReachabilityDiagnostic | null;
  dispose(): void;
}>;

type Classify = (
  region: number, bytes: number, layoutId: number, mapId: number,
  areaEpoch: number, playerId: number,
  anchorX: number, anchorY: number, width: number, height: number,
  mapMinX: number, mapMinY: number, mapMaxX: number, mapMaxY: number,
  revealRadius: number,
) => number;

const signatureModule = new WebAssembly.Module(
  cartographyReachabilitySignatureBytes(),
);

export type CartographyMemoryLayoutId = 1 | 2;

function exactSurface(
  actual: readonly WebAssembly.ModuleImportDescriptor[]
    | readonly WebAssembly.ModuleExportDescriptor[],
  expected: readonly string[],
): boolean {
  return JSON.stringify(actual.map((entry) => "module" in entry
    ? `${entry.module}.${entry.name}:${entry.kind}`
    : `${entry.name}:${entry.kind}`).sort()) === JSON.stringify(expected);
}

function allocation(
  malloc: (bytes: number) => unknown,
  bytes: number,
  align: number,
): Readonly<{ raw: number; pointer: number }> {
  const raw = Number(malloc(bytes + align - 1));
  const pointer = Math.ceil(raw / align) * align;
  if (!Number.isSafeInteger(raw) || raw <= 0 || pointer < raw) {
    throw new Error("Cartography reachability allocation failed");
  }
  return Object.freeze({ raw, pointer });
}

function decode(
  memory: WebAssembly.Memory,
  region: number,
  mapLeft: number,
  mapTop: number,
): CartographyReachabilitySnapshot | null {
  if (region + CARTOGRAPHY_REACHABILITY_REGION_BYTES > memory.buffer.byteLength) {
    return null;
  }
  const header = new DataView(memory.buffer, region, HEADER_BYTES);
  const first = header.getUint32(12, true);
  if ((first & 1) !== 0) return null;
  const status = header.getUint32(16, true);
  const mapId = header.getUint32(20, true);
  const areaEpoch = header.getUint32(24, true);
  const layoutId = header.getUint32(28, true);
  const width = header.getUint32(32, true);
  const height = header.getUint32(36, true);
  const cells = width * height;
  if (
    header.getUint32(0, true) !== MAGIC
    || header.getUint32(4, true) !== CARTOGRAPHY_REACHABILITY_ABI
    || header.getUint32(8, true) !== CARTOGRAPHY_REACHABILITY_REGION_BYTES
    || status < READY || status > 6 || areaEpoch === 0
    || (layoutId !== 1 && layoutId !== 2)
    || !Number.isSafeInteger(cells)
    || cells <= 0 || cells > CARTOGRAPHY_REACHABILITY_MAX_CELLS
  ) return null;
  const wordCount = Math.ceil(cells / 32);
  const words = new Uint32Array(wordCount);
  words.set(new Uint32Array(memory.buffer, region + HEADER_BYTES, wordCount));
  const terrainWidth = header.getUint32(60, true);
  const terrainHeight = header.getUint32(64, true);
  const terrainCells = terrainWidth * terrainHeight;
  const mapUnitsPerPixel = header.getFloat32(68, true);
  if (
    !Number.isSafeInteger(terrainCells)
    || terrainCells <= 0 || terrainCells > MAX_TERRAIN_RASTER_CELLS
    || !Number.isFinite(mapUnitsPerPixel) || mapUnitsPerPixel <= 0
    || !Number.isFinite(mapLeft) || !Number.isFinite(mapTop)
  ) return null;
  const terrainWordCount = Math.ceil(terrainCells / 32);
  const terrainWords = new Uint32Array(terrainWordCount);
  terrainWords.set(new Uint32Array(
    memory.buffer,
    region + WALKABLE_TERRAIN_BITS_OFFSET,
    terrainWordCount,
  ));
  const second = new DataView(memory.buffer, region, HEADER_BYTES).getUint32(12, true);
  if (first !== second || (second & 1) !== 0) return null;
  const tailBits = cells % 32;
  if (tailBits !== 0 && ((words.at(-1) ?? 0) >>> tailBits) !== 0) return null;
  const terrainTailBits = terrainCells % 32;
  if (
    terrainTailBits !== 0
    && ((terrainWords.at(-1) ?? 0) >>> terrainTailBits) !== 0
  ) return null;
  return Object.freeze({
    status,
    sequence: second,
    mapId,
    areaEpoch,
    layoutId,
    width,
    height,
    resourceGeneration: header.getUint32(40, true),
    totalTrapezoids: header.getUint32(44, true),
    reachableTrapezoids: header.getUint32(48, true),
    groundCells: header.getUint32(52, true),
    doorwayCount: header.getUint32(56, true),
    reachableCells: Object.freeze({ words }),
    walkableTerrain: Object.freeze({
      mapLeft,
      mapTop,
      mapUnitsPerPixel,
      width: terrainWidth,
      height: terrainHeight,
      words: terrainWords,
    }),
  });
}

function diagnostic(
  memory: WebAssembly.Memory,
  region: number,
): CartographyReachabilityDiagnostic | null {
  if (region + HEADER_BYTES > memory.buffer.byteLength) return null;
  const header = new DataView(memory.buffer, region, HEADER_BYTES);
  const first = header.getUint32(12, true);
  if (
    (first & 1) !== 0
    || header.getUint32(0, true) !== MAGIC
    || header.getUint32(4, true) !== CARTOGRAPHY_REACHABILITY_ABI
    || header.getUint32(8, true) !== CARTOGRAPHY_REACHABILITY_REGION_BYTES
  ) return null;
  const result = Object.freeze({
    status: header.getUint32(16, true),
    sequence: first,
    mapId: header.getUint32(20, true),
    areaEpoch: header.getUint32(24, true),
    layoutId: header.getUint32(28, true),
    width: header.getUint32(32, true),
    height: header.getUint32(36, true),
    resourceGeneration: header.getUint32(40, true),
    totalTrapezoids: header.getUint32(44, true),
    reachableTrapezoids: header.getUint32(48, true),
    groundCells: header.getUint32(52, true),
    doorwayCount: header.getUint32(56, true),
    terrainWidth: header.getUint32(60, true),
    terrainHeight: header.getUint32(64, true),
  });
  const second = new DataView(memory.buffer, region, HEADER_BYTES).getUint32(12, true);
  return first === second && (second & 1) === 0 ? result : null;
}

export async function installCartographyReachabilityKernel(
  exports: WebAssembly.Exports,
): Promise<CartographyReachabilityController> {
  const memory = exports.memory;
  const malloc = exports.malloc;
  const free = exports.free;
  if (
    !(memory instanceof WebAssembly.Memory)
    || typeof malloc !== "function" || typeof free !== "function"
  ) throw new Error("game memory or allocator exports are unavailable");
  const response = await fetch("cartography-reachability-kernel.wasm");
  if (!response.ok) {
    throw new Error(`kernel artifact request failed (${response.status})`);
  }
  const kernelBytes = await response.arrayBuffer();
  const kernelSha256 = [...new Uint8Array(
    await crypto.subtle.digest("SHA-256", kernelBytes),
  )].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (kernelSha256.length !== 64) {
    throw new Error("kernel artifact digest is invalid");
  }
  const kernelModule = await WebAssembly.compile(kernelBytes);
  if (
    !exactSurface(WebAssembly.Module.imports(kernelModule), CARTOGRAPHY_REACHABILITY_IMPORTS)
    || !exactSurface(WebAssembly.Module.exports(kernelModule), CARTOGRAPHY_REACHABILITY_EXPORTS)
  ) throw new Error("Cartography reachability kernel surface is invalid");

  const allocate = malloc as (bytes: number) => unknown;
  const release = free as (pointer: number) => void;
  const runtime = allocation(
    allocate,
    CARTOGRAPHY_REACHABILITY_RUNTIME_BYTES,
    CARTOGRAPHY_REACHABILITY_RUNTIME_ALIGN,
  );
  let region: ReturnType<typeof allocation> | null = null;
  let disposed = false;
  try {
    region = allocation(allocate, CARTOGRAPHY_REACHABILITY_REGION_BYTES, 4);
    const output = region;
    if (
      runtime.pointer + CARTOGRAPHY_REACHABILITY_RUNTIME_BYTES > memory.buffer.byteLength
      || output.pointer + CARTOGRAPHY_REACHABILITY_REGION_BYTES > memory.buffer.byteLength
      || !(runtime.pointer + CARTOGRAPHY_REACHABILITY_RUNTIME_BYTES <= output.pointer
        || output.pointer + CARTOGRAPHY_REACHABILITY_REGION_BYTES <= runtime.pointer)
    ) throw new Error("Cartography reachability regions are invalid");
    new Uint8Array(
      memory.buffer,
      output.pointer,
      CARTOGRAPHY_REACHABILITY_REGION_BYTES,
    ).fill(0);
    const immutable = (value: number) => new WebAssembly.Global(
      { value: "i32", mutable: false }, value,
    );
    const instance = await WebAssembly.instantiate(kernelModule, {
      env: {
        memory,
        __memory_base: immutable(runtime.pointer),
        __stack_pointer: new WebAssembly.Global(
          { value: "i32", mutable: true },
          runtime.pointer + CARTOGRAPHY_REACHABILITY_RUNTIME_BYTES,
        ),
        __table_base: immutable(0),
      },
    });
    new WebAssembly.Instance(signatureModule, { kernel: instance.exports });
    const abi = instance.exports.cartography_reachability_abi as () => number;
    const bytes = instance.exports.cartography_reachability_region_bytes as () => number;
    if (
      abi() !== CARTOGRAPHY_REACHABILITY_ABI
      || bytes() !== CARTOGRAPHY_REACHABILITY_REGION_BYTES
    ) throw new Error("Cartography reachability kernel rejected its ABI");
    const classify = instance.exports.cartography_reachability_classify as Classify;
    let lastDiagnostic: CartographyReachabilityDiagnostic | null = null;
    return Object.freeze({
      sha256: kernelSha256,
      classify(input) {
        if (disposed) return null;
        classify(
          output.pointer,
          CARTOGRAPHY_REACHABILITY_REGION_BYTES,
          input.layoutId,
          input.mapId,
          input.areaEpoch,
          input.playerId,
          input.worldAnchorX,
          input.worldAnchorY,
          input.width,
          input.height,
          input.mapMinX,
          input.mapMinY,
          input.mapMaxX,
          input.mapMaxY,
          input.revealRadius,
        );
        lastDiagnostic = diagnostic(memory, output.pointer);
        return decode(memory, output.pointer, input.mapMinX, input.mapMinY);
      },
      diagnostic: () => lastDiagnostic,
      dispose() {
        if (disposed) return;
        disposed = true;
        release(output.raw);
        release(runtime.raw);
      },
    });
  } catch (error) {
    if (!disposed) {
      disposed = true;
      if (region !== null) release(region.raw);
      release(runtime.raw);
    }
    throw error;
  }
}
