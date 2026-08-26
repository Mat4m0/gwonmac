/**
 * Owns the fixed host allocations used directly by the companion kernel.
 * Feature-specific region installations stay separate; the transaction root
 * combines all descriptors before any pointer reaches the side module.
 */
import { COMPANION_ABI } from "../shared/companion-abi.js";
import {
  COMPANION_KERNEL_RUNTIME_ALIGN,
  COMPANION_KERNEL_RUNTIME_BYTES,
  type CompanionOwnedRegion,
  validateCompanionOwnedRegions,
} from "./companion-owned-regions.js";

const COMPANION_CURSOR_BYTES = COMPANION_ABI.cursor.bytes;
const COMPANION_PARTY_BYTES = COMPANION_ABI.party.bytes;
const COMPANION_SNAPSHOT_BYTES = COMPANION_ABI.snapshot.bytes;
const COMPANION_TOOLBOX_BYTES = COMPANION_ABI.toolbox.bytes;

type KernelRegion = Readonly<{ pointer: number; bytes: number }>;

export type CompanionCoreMemoryNeeds = Readonly<{
  snapshot: boolean;
  cursor: boolean;
  toolbox: boolean;
  commandPayloadBytes: number;
  professionTrace: boolean;
  professionTraceBytes: number;
}>;

type Allocation = Readonly<{
  name: string;
  pointer: number;
  release: "observer" | "callback";
}>;

function releaseAllocations(
  allocations: readonly Allocation[],
  free: (pointer: number) => void,
  message: string,
): void {
  const failures: unknown[] = [];
  for (const allocation of allocations) {
    try {
      free(allocation.pointer);
    } catch (cause) {
      failures.push(new Error(`Failed to free ${allocation.name}`, { cause }));
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, message);
}

export function allocateCompanionCoreMemory(input: Readonly<{
  memory: WebAssembly.Memory;
  malloc(bytes: number): unknown;
  free(pointer: number): void;
  configWords: readonly number[];
  needs: CompanionCoreMemoryNeeds;
}>) {
  const { memory, malloc, free, configWords, needs } = input;
  if (
    configWords.length === 0
    || !Number.isSafeInteger(needs.commandPayloadBytes)
    || needs.commandPayloadBytes < 0
    || (needs.professionTrace && (
      needs.commandPayloadBytes === 0
      || !Number.isSafeInteger(needs.professionTraceBytes)
      || needs.professionTraceBytes <= 0
    ))
  ) {
    throw new Error("Companion core memory request is invalid");
  }

  const allocated: Allocation[] = [];
  const allocatedPointers = new Set<number>();
  const take = (
    name: string,
    bytes: number,
    release: Allocation["release"],
  ): number => {
    const pointer = Number(malloc(bytes));
    if (!Number.isSafeInteger(pointer) || pointer <= 0) {
      throw new Error(`Companion ${name} allocation failed`);
    }
    if (allocatedPointers.has(pointer)) {
      throw new Error(`Companion ${name} allocation reused a live pointer`);
    }
    allocatedPointers.add(pointer);
    allocated.push({ name, pointer, release });
    return pointer;
  };
  try {
    const runtimeAllocation = take(
      "runtime",
      COMPANION_KERNEL_RUNTIME_BYTES + COMPANION_KERNEL_RUNTIME_ALIGN - 1,
      "callback",
    );
    const runtimePointer = Math.ceil(
      runtimeAllocation / COMPANION_KERNEL_RUNTIME_ALIGN,
    ) * COMPANION_KERNEL_RUNTIME_ALIGN;
    const snapshotPointer = needs.snapshot
      ? take("snapshot", COMPANION_SNAPSHOT_BYTES, "observer")
      : 0;
    const configBytes = configWords.length * Uint32Array.BYTES_PER_ELEMENT;
    const configPointer = take("config", configBytes, "callback");
    const cursorPointer = needs.cursor
      ? take("cursor", COMPANION_CURSOR_BYTES, "observer")
      : 0;
    const toolboxPointer = needs.toolbox
      ? take("Toolbox", COMPANION_TOOLBOX_BYTES, "observer")
      : 0;
    const partyPointer = needs.toolbox
      ? take("party", COMPANION_PARTY_BYTES, "observer")
      : 0;
    const commandPayloadPointer = needs.commandPayloadBytes > 0
      ? take("command payload", needs.commandPayloadBytes, "callback")
      : 0;
    const professionTracePointer = needs.professionTrace
      ? take("profession trace", needs.professionTraceBytes, "observer")
      : 0;

    const region = (
      name: string,
      pointer: number,
      size: number,
      align = 4,
    ): CompanionOwnedRegion => Object.freeze({ name, pointer, size, align });
    const regions = Object.freeze([
      region(
        "runtime",
        runtimePointer,
        COMPANION_KERNEL_RUNTIME_BYTES,
        COMPANION_KERNEL_RUNTIME_ALIGN,
      ),
      ...(needs.snapshot
        ? [region("snapshot", snapshotPointer, COMPANION_SNAPSHOT_BYTES)]
        : []),
      region("config", configPointer, configBytes),
      ...(needs.cursor
        ? [region("cursor", cursorPointer, COMPANION_CURSOR_BYTES)]
        : []),
      ...(needs.toolbox
        ? [
            region("toolbox", toolboxPointer, COMPANION_TOOLBOX_BYTES),
            region("party", partyPointer, COMPANION_PARTY_BYTES),
          ]
        : []),
      ...(needs.commandPayloadBytes > 0
        ? [region(
            "command payload",
            commandPayloadPointer,
            needs.commandPayloadBytes,
          )]
        : []),
      ...(needs.professionTrace
        ? [region(
            "profession trace",
            professionTracePointer,
            needs.professionTraceBytes,
          )]
        : []),
    ]);
    validateCompanionOwnedRegions(regions, memory.buffer.byteLength);
    const kernelRegion = (pointer: number, bytes: number): KernelRegion =>
      Object.freeze({ pointer, bytes });
    let initialized = false;
    let observerReleased = false;
    let callbackReleased = false;
    return Object.freeze({
      runtimePointer,
      snapshot: kernelRegion(
        snapshotPointer,
        needs.snapshot ? COMPANION_SNAPSHOT_BYTES : 0,
      ),
      config: kernelRegion(configPointer, configBytes),
      cursor: kernelRegion(
        cursorPointer,
        needs.cursor ? COMPANION_CURSOR_BYTES : 0,
      ),
      toolbox: kernelRegion(
        toolboxPointer,
        needs.toolbox ? COMPANION_TOOLBOX_BYTES : 0,
      ),
      party: kernelRegion(
        partyPointer,
        needs.toolbox ? COMPANION_PARTY_BYTES : 0,
      ),
      commandPayloadPointer,
      professionTracePointer,
      regions,
      initialize() {
        if (observerReleased || callbackReleased) {
          throw new Error("Companion core memory has been released");
        }
        if (initialized) return;
        new Uint8Array(
          memory.buffer,
          runtimePointer,
          COMPANION_KERNEL_RUNTIME_BYTES,
        ).fill(0);
        new Uint32Array(memory.buffer, configPointer, configWords.length)
          .set(configWords);
        initialized = true;
      },
      releaseObserverMemory() {
        if (observerReleased) return;
        observerReleased = true;
        releaseAllocations(
          allocated.filter(({ release }) => release === "observer").reverse(),
          free,
          "Companion observer memory release failed",
        );
      },
      releaseCallbackMemory() {
        if (callbackReleased) return;
        callbackReleased = true;
        releaseAllocations(
          allocated.filter(({ release }) => release === "callback").reverse(),
          free,
          "Companion callback memory release failed",
        );
      },
    });
  } catch (cause) {
    try {
      releaseAllocations(
        [...allocated].reverse(),
        free,
        "Companion partial allocation rollback failed",
      );
    } catch (rollback) {
      throw new AggregateError(
        [cause, rollback],
        "Companion core memory allocation and rollback failed",
        { cause: rollback },
      );
    }
    throw cause;
  }
}
