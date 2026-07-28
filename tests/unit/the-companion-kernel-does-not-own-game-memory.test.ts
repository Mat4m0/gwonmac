import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { inspectCompanionKernel } from
  "../../src/renderer/companion-kernel-relocation.ts";

describe("the companion kernel does not own a fixed part of game memory", () => {
  it("relocates its complete data image before instantiation", async () => {
    const source = await readFile("build/renderer/companion-kernel.wasm");
    const kernel = inspectCompanionKernel(source);
    const memory = new WebAssembly.Memory({ initial: 64 });
    const oldImage = new Uint8Array(memory.buffer, 0x10_0000, 4096);
    oldImage.fill(0xa5);

    const relocated = kernel.relocate(0x20_0000);
    const module = await WebAssembly.compile(relocated.buffer as ArrayBuffer);
    const game = Object.fromEntries(
      WebAssembly.Module.imports(module)
        .filter((entry) => entry.module === "game")
        .map((entry) => [entry.name, () => 0]),
    );
    const instance = await WebAssembly.instantiate(module, {
      env: {
        memory,
        enhancement_kernel_state: () => 0x30_0000,
      },
      game,
    });

    assert.ok(
      oldImage.every((byte) => byte === 0xa5),
      "instantiation overwrote the client's existing 1 MiB region",
    );
    assert.ok(
      (instance.exports.companion_state_size as () => number)() > 0,
      "the relocated kernel did not retain its exported state contract",
    );
  });
});
