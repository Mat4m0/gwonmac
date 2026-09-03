/**
 * Loads and verifies the fixed companion side module before it can receive
 * pointers or become reachable from the game callback table.
 *
 * This is the complete executable-boundary check before caller-owned pointers
 * are used: exact imports, exact
 * exports, exact Wasm function signatures, fixed ABI/region sizes, and the
 * side module's private aligned memory base. It initializes the verified
 * kernel, but grants no feature policy and never publishes or enables a hook.
 */
import {
  COMPANION_ABI,
} from "../shared/companion-abi.js";
import {
  COMPANION_KERNEL_EXPORTS,
  COMPANION_KERNEL_IMPORTS,
  companionKernelSignatureBytes,
} from "../shared/companion-kernel-contract.js";
import { COMPANION_PLAY_REGION_BYTES } from "./companion-play-region-snapshot.js";
import {
  COMPANION_KERNEL_RUNTIME_ALIGN,
  COMPANION_KERNEL_RUNTIME_BYTES,
  validateCompanionOwnedRegions,
} from "./companion-owned-regions.js";

const COMPANION_CURSOR_BYTES = COMPANION_ABI.cursor.bytes;
const COMPANION_PARTY_BYTES = COMPANION_ABI.party.bytes;
const COMPANION_SNAPSHOT_BYTES = COMPANION_ABI.snapshot.bytes;
const COMPANION_TOOLBOX_BYTES = COMPANION_ABI.toolbox.bytes;
const COMPANION_SKILL_SLOT_BYTES = COMPANION_ABI.skillSlots.bytes;
const COMPANION_SKILL_COOLDOWN_BYTES = COMPANION_ABI.skillCooldowns.bytes;
const COMPANION_CHARACTER_LIST_BYTES = COMPANION_ABI.characterList.bytes;

type CompanionKernelInit = (
  snapshotPointer: number,
  snapshotBytes: number,
  configPointer: number,
  configBytes: number,
  cursorPointer: number,
  cursorBytes: number,
  toolboxPointer: number,
  toolboxBytes: number,
  partyPointer: number,
  partyBytes: number,
  skillSlotPointer: number,
  skillSlotBytes: number,
  skillCooldownPointer: number,
  skillCooldownBytes: number,
  playRegionPointer: number,
  playRegionBytes: number,
  characterListPointer: number,
  characterListBytes: number,
  friendPointer: number,
  friendBytes: number,
  friendRoot: number,
  featureFlags: number,
) => number;

type CompanionKernelDispatch = (
  messageId: number,
  wParam: number,
  lParam: number,
  cursorData: number,
  cursorWidth: number,
  cursorHeight: number,
) => void;

type LoadedCompanionKernel = Readonly<{
  dispatch: CompanionKernelDispatch;
  cursorEventCount: () => number;
  sha256: string;
}>;

type KernelRegion = Readonly<{ pointer: number; bytes: number }>;
type CompanionKernelRequest = Readonly<{
  memory: WebAssembly.Memory;
  runtimePointer: number;
  featureFlags: number;
  friendRoot?: number;
  regions: Readonly<{
    snapshot: KernelRegion;
    config: KernelRegion;
    cursor: KernelRegion;
    toolbox: KernelRegion;
    party: KernelRegion;
    skillSlots: KernelRegion;
    skillCooldowns: KernelRegion;
    playRegion: KernelRegion;
    characterList?: KernelRegion;
    friends?: KernelRegion;
  }>;
}>;

const signatureModule = new WebAssembly.Module(companionKernelSignatureBytes());

function exactSurface(
  actual: readonly WebAssembly.ModuleImportDescriptor[]
    | readonly WebAssembly.ModuleExportDescriptor[],
  expected: readonly string[],
): boolean {
  const names = actual
    .map((entry) => "module" in entry
      ? `${entry.module}.${entry.name}:${entry.kind}`
      : `${entry.name}:${entry.kind}`)
    .sort();
  return JSON.stringify(names) === JSON.stringify(expected);
}

function hasExactSignatures(exports: WebAssembly.Exports): boolean {
  try {
    new WebAssembly.Instance(signatureModule, { kernel: exports });
    return true;
  } catch {
    return false;
  }
}

function runtimeEnd(request: CompanionKernelRequest): number {
  const sharedRegions = Object.entries(request.regions)
    .filter((entry): entry is [string, KernelRegion] => entry[1] !== undefined)
    .filter(([, region]) => region.bytes > 0)
    .map(([name, region]) => ({
      name,
      pointer: region.pointer,
      size: region.bytes,
      align: 4,
    }));
  validateCompanionOwnedRegions([
    {
      name: "kernel runtime",
      pointer: request.runtimePointer,
      size: COMPANION_KERNEL_RUNTIME_BYTES,
      align: COMPANION_KERNEL_RUNTIME_ALIGN,
    },
    ...sharedRegions,
  ], request.memory.buffer.byteLength);
  return request.runtimePointer + COMPANION_KERNEL_RUNTIME_BYTES;
}

type BoundCompanionKernel = Omit<LoadedCompanionKernel, "sha256">;

/** Deterministic ABI binding kept separate so every positional word is tested. */
function bindCompanionKernel(
  exports: WebAssembly.Exports,
  request: CompanionKernelRequest,
): BoundCompanionKernel {
  const companionAbi = exports.companion_abi as () => number;
  const configBytes = exports.companion_config_bytes as () => number;
  const snapshotBytes = exports.companion_snapshot_bytes as () => number;
  const cursorBytes = exports.companion_cursor_bytes as () => number;
  const toolboxBytes = exports.companion_toolbox_bytes as () => number;
  const partyBytes = exports.companion_party_bytes as () => number;
  const skillSlotBytes = exports.companion_skill_slot_bytes as () => number;
  const skillCooldownBytes = exports.companion_skill_cooldown_bytes as () => number;
  const playRegionBytes = exports.companion_play_region_bytes as () => number;
  const characterListBytes = exports.companion_character_list_bytes as () => number;
  const friendBytes = exports.companion_friend_bytes as () => number;
  const { regions } = request;
  const friends = regions.friends ?? { pointer: 0, bytes: 0 };
  const characterList = regions.characterList ?? { pointer: 0, bytes: 0 };
  if (
    companionAbi() !== COMPANION_ABI.kernel
    || configBytes() !== regions.config.bytes
    || snapshotBytes() !== COMPANION_SNAPSHOT_BYTES
    || cursorBytes() !== COMPANION_CURSOR_BYTES
    || toolboxBytes() !== COMPANION_TOOLBOX_BYTES
    || partyBytes() !== COMPANION_PARTY_BYTES
    || skillSlotBytes() !== COMPANION_SKILL_SLOT_BYTES
    || skillCooldownBytes() !== COMPANION_SKILL_COOLDOWN_BYTES
    || playRegionBytes() !== COMPANION_PLAY_REGION_BYTES
    || characterListBytes() !== COMPANION_CHARACTER_LIST_BYTES
    || friendBytes() !== COMPANION_ABI.friends.bytes
  ) {
    throw new Error("Companion kernel rejected its ABI");
  }
  const init = exports.companion_init as CompanionKernelInit;
  if (init(
    regions.snapshot.pointer,
    regions.snapshot.bytes,
    regions.config.pointer,
    regions.config.bytes,
    regions.cursor.pointer,
    regions.cursor.bytes,
    regions.toolbox.pointer,
    regions.toolbox.bytes,
    regions.party.pointer,
    regions.party.bytes,
    regions.skillSlots.pointer,
    regions.skillSlots.bytes,
    regions.skillCooldowns.pointer,
    regions.skillCooldowns.bytes,
    regions.playRegion.pointer,
    regions.playRegion.bytes,
    characterList.pointer,
    characterList.bytes,
    friends.pointer,
    friends.bytes,
    request.friendRoot ?? 0,
    request.featureFlags,
  ) !== 1) {
    throw new Error("Companion kernel rejected its ABI");
  }
  return Object.freeze({
    dispatch: exports.companion_dispatch as CompanionKernelDispatch,
    cursorEventCount: exports.companion_cursor_event_count as () => number,
  });
}

export async function initializeCompanionKernelBytes(
  kernelBytes: ArrayBuffer,
  request: CompanionKernelRequest,
): Promise<LoadedCompanionKernel> {
  const { memory, runtimePointer } = request;
  const runtimeStackEnd = runtimeEnd(request);
  const kernelSha256 = [...new Uint8Array(
    await crypto.subtle.digest("SHA-256", kernelBytes),
  )]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const kernelModule = await WebAssembly.compile(kernelBytes);
  if (!exactSurface(
    WebAssembly.Module.imports(kernelModule),
    COMPANION_KERNEL_IMPORTS,
  )) {
    throw new Error("Companion kernel import surface is invalid");
  }
  if (!exactSurface(
    WebAssembly.Module.exports(kernelModule),
    COMPANION_KERNEL_EXPORTS,
  )) {
    throw new Error("Companion kernel export surface is invalid");
  }
  const immutableI32 = (value: number) => new WebAssembly.Global(
    { value: "i32", mutable: false },
    value,
  );
  const instance = await WebAssembly.instantiate(kernelModule, {
    env: {
      memory,
      __indirect_function_table: new WebAssembly.Table({
        initial: 0,
        maximum: 0,
        element: "anyfunc",
      }),
      __memory_base: immutableI32(runtimePointer),
      __stack_pointer: new WebAssembly.Global(
        { value: "i32", mutable: true },
        runtimeStackEnd,
      ),
      __table_base: immutableI32(0),
    },
  });
  if (!hasExactSignatures(instance.exports)) {
    throw new Error("Companion kernel export signatures are invalid");
  }
  const bound = bindCompanionKernel(instance.exports, request);
  return Object.freeze({
    ...bound,
    sha256: kernelSha256,
  });
}

export async function installCompanionKernel(
  request: CompanionKernelRequest,
): Promise<LoadedCompanionKernel> {
  const response = await fetch("companion-kernel.wasm");
  if (!response.ok) throw new Error("Companion kernel is unavailable");
  return initializeCompanionKernelBytes(await response.arrayBuffer(), request);
}
