import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allocateCompanionCoreMemory } from "../../src/renderer/companion-core-memory-installation.ts";
import {
  COMPANION_KERNEL_RUNTIME_BYTES,
  validateCompanionOwnedRegions,
} from "../../src/renderer/companion-owned-regions.ts";

const CONFIG = Object.freeze([0x1122_3344, 0xaabb_ccdd, 7]);

function allocator(options: Readonly<{
  failAt?: number;
  throwingFree?: number;
}> = {}) {
  let next = 8;
  const allocations: { pointer: number; bytes: number }[] = [];
  const frees: number[] = [];
  return {
    allocations,
    frees,
    malloc(bytes: number) {
      if (allocations.length === options.failAt) return 0;
      const pointer = next;
      allocations.push({ pointer, bytes });
      next = Math.ceil((pointer + bytes) / 8) * 8;
      return pointer;
    },
    free(pointer: number) {
      frees.push(pointer);
      if (pointer === options.throwingFree) throw new Error("free refused");
    },
  };
}

function allocate(
  heap = new WebAssembly.Memory({ initial: 8 }),
  fake = allocator(),
) {
  const core = allocateCompanionCoreMemory({
    memory: heap,
    malloc: fake.malloc,
    free: fake.free,
    configWords: CONFIG,
    needs: {
      snapshot: true,
      cursor: true,
      toolbox: true,
      commandPayloadBytes: 128,
      professionTrace: true,
    },
  });
  core.initialize();
  return {
    fake,
    heap,
    core,
  };
}

describe("companion core memory installation", () => {
  it("owns aligned runtime, exact config, and explicit kernel regions", () => {
    const heap = new WebAssembly.Memory({ initial: 8 });
    new Uint8Array(heap.buffer).fill(0xa5);
    const { core, fake } = allocate(heap);

    assert.equal(core.runtimePointer, 16);
    assert.equal(
      new Uint8Array(
        heap.buffer,
        core.runtimePointer,
        COMPANION_KERNEL_RUNTIME_BYTES,
      ).every((byte) => byte === 0),
      true,
    );
    assert.deepEqual(
      [...new Uint32Array(heap.buffer, core.config.pointer, CONFIG.length)],
      CONFIG,
    );
    assert.deepEqual(core.regions.map(({ name }) => name), [
      "runtime",
      "snapshot",
      "config",
      "cursor",
      "toolbox",
      "party",
      "command payload",
      "profession trace",
    ]);
    assert.equal(core.runtimePointer, fake.allocations[0]!.pointer + 8);
    assert.equal(core.commandPayloadPointer, fake.allocations[6]!.pointer);
    assert.equal(core.professionTracePointer, fake.allocations[7]!.pointer);
  });

  it("allocates no observer or command memory when it is not needed", () => {
    const fake = allocator();
    const core = allocateCompanionCoreMemory({
      memory: new WebAssembly.Memory({ initial: 8 }),
      malloc: fake.malloc,
      free: fake.free,
      configWords: CONFIG,
      needs: {
        snapshot: false,
        cursor: false,
        toolbox: false,
        commandPayloadBytes: 0,
        professionTrace: false,
      },
    });
    core.initialize();

    assert.deepEqual(core.regions.map(({ name }) => name), ["runtime", "config"]);
    assert.deepEqual(fake.allocations.map(({ bytes }) => bytes), [
      COMPANION_KERNEL_RUNTIME_BYTES + 15,
      CONFIG.length * Uint32Array.BYTES_PER_ELEMENT,
    ]);
    assert.deepEqual(core.snapshot, { pointer: 0, bytes: 0 });
    assert.deepEqual(core.cursor, { pointer: 0, bytes: 0 });
    assert.deepEqual(core.toolbox, { pointer: 0, bytes: 0 });
    assert.deepEqual(core.party, { pointer: 0, bytes: 0 });
    core.releaseObserverMemory();
    assert.deepEqual(fake.frees, []);
  });

  it("rolls back every partial allocation in reverse order", () => {
    for (let failAt = 0; failAt < 8; failAt += 1) {
      const fake = allocator({ failAt });
      assert.throws(
        () => allocateCompanionCoreMemory({
          memory: new WebAssembly.Memory({ initial: 8 }),
          malloc: fake.malloc,
          free: fake.free,
          configWords: CONFIG,
          needs: {
            snapshot: true,
            cursor: true,
            toolbox: true,
            commandPayloadBytes: 128,
            professionTrace: true,
          },
        }),
        /allocation failed/,
      );
      assert.deepEqual(
        fake.frees,
        fake.allocations.map(({ pointer }) => pointer).reverse(),
        `allocation ${failAt}`,
      );
    }
  });

  it("rolls back when the completed layout does not fit memory", () => {
    const fake = allocator();
    assert.throws(
      () => allocateCompanionCoreMemory({
        memory: new WebAssembly.Memory({ initial: 1 }),
        malloc: fake.malloc,
        free: fake.free,
        configWords: CONFIG,
        needs: {
          snapshot: true,
          cursor: true,
          toolbox: true,
          commandPayloadBytes: 128,
          professionTrace: true,
        },
      }),
      /ends past the heap/,
    );
    assert.deepEqual(
      fake.frees,
      fake.allocations.map(({ pointer }) => pointer).reverse(),
    );
  });

  it("does not write runtime or config bytes before explicit initialization", () => {
    const heap = new WebAssembly.Memory({ initial: 8 });
    new Uint8Array(heap.buffer).fill(0xa5);
    const fake = allocator();
    const core = allocateCompanionCoreMemory({
      memory: heap,
      malloc: fake.malloc,
      free: fake.free,
      configWords: CONFIG,
      needs: {
        snapshot: false,
        cursor: false,
        toolbox: false,
        commandPayloadBytes: 0,
        professionTrace: false,
      },
    });

    assert.equal(
      new Uint8Array(heap.buffer, core.runtimePointer, 16)
        .every((byte) => byte === 0xa5),
      true,
    );
    assert.equal(
      new Uint8Array(heap.buffer, core.config.pointer, core.config.bytes)
        .every((byte) => byte === 0xa5),
      true,
    );
    core.initialize();
    assert.equal(
      new Uint8Array(heap.buffer, core.runtimePointer, 16)
        .every((byte) => byte === 0),
      true,
    );
    assert.deepEqual(
      [...new Uint32Array(heap.buffer, core.config.pointer, CONFIG.length)],
      CONFIG,
    );
  });

  it("rolls back a reused allocation pointer exactly once", () => {
    const frees: number[] = [];
    let calls = 0;
    assert.throws(
      () => allocateCompanionCoreMemory({
        memory: new WebAssembly.Memory({ initial: 8 }),
        malloc: () => {
          calls += 1;
          return 8;
        },
        free: (pointer) => frees.push(pointer),
        configWords: CONFIG,
        needs: {
          snapshot: true,
          cursor: false,
          toolbox: false,
          commandPayloadBytes: 0,
          professionTrace: false,
        },
      }),
      /reused a live pointer/,
    );
    assert.equal(calls, 2);
    assert.deepEqual(frees, [8]);
  });

  it("reports both allocation and rollback failures", () => {
    const baseline = allocator();
    allocate(new WebAssembly.Memory({ initial: 8 }), baseline);
    const refused = baseline.allocations[1]!.pointer;
    const fake = allocator({ failAt: 3, throwingFree: refused });

    assert.throws(
      () => allocateCompanionCoreMemory({
        memory: new WebAssembly.Memory({ initial: 8 }),
        malloc: fake.malloc,
        free: fake.free,
        configWords: CONFIG,
        needs: {
          snapshot: true,
          cursor: true,
          toolbox: true,
          commandPayloadBytes: 128,
          professionTrace: true,
        },
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.match(String(error.errors[0]), /cursor allocation failed/);
        assert.match(String(error.errors[1]), /partial allocation rollback failed/);
        assert.ok(error.errors[1] instanceof AggregateError);
        assert.match(
          String(error.errors[1].errors[0]),
          /Failed to free snapshot/,
        );
        return true;
      },
    );
    assert.equal(fake.frees.length, 3);
  });

  it("releases the observer and callback safety groups once", () => {
    const { core, fake } = allocate();
    const pointers = fake.allocations.map(({ pointer }) => pointer);

    core.releaseObserverMemory();
    core.releaseObserverMemory();
    assert.deepEqual(fake.frees, [
      pointers[7], pointers[5], pointers[4], pointers[3], pointers[1],
    ]);

    core.releaseCallbackMemory();
    core.releaseCallbackMemory();
    assert.deepEqual(fake.frees, [
      pointers[7], pointers[5], pointers[4], pointers[3], pointers[1],
      pointers[6], pointers[2], pointers[0],
    ]);
    assert.notEqual(core.runtimePointer, pointers[0]);
  });

  it("cannot initialize after either release group runs", () => {
    for (const release of ["observer", "callback"] as const) {
      for (const initializedBeforeRelease of [false, true]) {
        const fake = allocator();
        const core = allocateCompanionCoreMemory({
          memory: new WebAssembly.Memory({ initial: 8 }),
          malloc: fake.malloc,
          free: fake.free,
          configWords: CONFIG,
          needs: {
            snapshot: true,
            cursor: false,
            toolbox: false,
            commandPayloadBytes: 0,
            professionTrace: false,
          },
        });
        if (initializedBeforeRelease) core.initialize();
        if (release === "observer") core.releaseObserverMemory();
        else core.releaseCallbackMemory();
        assert.throws(
          () => core.initialize(),
          /core memory has been released/,
          `${release}, initialized: ${initializedBeforeRelease}`,
        );
      }
    }
  });

  it("continues a release after one free refuses", () => {
    const first = allocator();
    allocate(new WebAssembly.Memory({ initial: 8 }), first);
    const refused = first.allocations[4]!.pointer;
    const fake = allocator({ throwingFree: refused });
    const { core } = allocate(new WebAssembly.Memory({ initial: 8 }), fake);

    assert.throws(
      () => core.releaseObserverMemory(),
      /observer memory release failed/,
    );
    assert.equal(fake.frees.length, 5);
    core.releaseObserverMemory();
    assert.equal(fake.frees.length, 5);
  });

  it("composes with child-region overlap validation", () => {
    const { core, heap } = allocate();
    assert.throws(
      () => validateCompanionOwnedRegions([
        ...core.regions,
        {
          name: "child",
          pointer: core.config.pointer,
          size: 4,
          align: 4,
        },
      ], heap.buffer.byteLength),
      /config\/child allocations overlap/,
    );
  });
});
