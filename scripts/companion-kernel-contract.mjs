import assert from "node:assert/strict";
import { COMPANION_ABI } from "../src/shared/companion-abi.ts";
import {
  COMPANION_KERNEL_EXPORTS,
  COMPANION_KERNEL_IMPORTS,
  companionKernelSignatureBytes,
} from "../src/shared/companion-kernel-contract.ts";
export {
  COMPANION_KERNEL_IMPORTS,
  COMPANION_KERNEL_SIGNATURES,
} from "../src/shared/companion-kernel-contract.ts";

const companionKernelSignatureModule = new WebAssembly.Module(
  companionKernelSignatureBytes(),
);

/**
 * What each nullary export must answer, restated where a human changes it.
 *
 * These lived inline in `verify-companion-kernel.mjs` and went stale: the party
 * work moved the ABI to 7 and the config block to 296 bytes while that script
 * still asserted 6 and 196, because it needs a built artifact and so is not
 * part of `pnpm check`. Here they are inside a module the unit suite already
 * imports, and the seal test ties every byte count back to the decoder that
 * reads the region — so the two halves of each number cannot drift apart again
 * without one test or the other saying so.
 */
export const COMPANION_KERNEL_EXPORT_VALUES = Object.freeze({
  companion_abi: COMPANION_ABI.kernel,
  companion_config_bytes: COMPANION_ABI.config.bytes,
  companion_snapshot_bytes: COMPANION_ABI.snapshot.bytes,
  companion_cursor_bytes: COMPANION_ABI.cursor.bytes,
  companion_toolbox_bytes: COMPANION_ABI.toolbox.bytes,
  companion_party_bytes: COMPANION_ABI.party.bytes,
  companion_skill_slot_bytes: COMPANION_ABI.skillSlots.bytes,
  companion_skill_cooldown_bytes: COMPANION_ABI.skillCooldowns.bytes,
  companion_play_region_bytes: COMPANION_ABI.playRegion.bytes,
  companion_character_list_bytes: COMPANION_ABI.characterList.bytes,
});

export const COMPANION_KERNEL_DYLINK0 = Object.freeze([
  // Memory footprint 2212 bytes (0xa4 0x11 as LEB128). Documented moves:
  //   309 ->  310  the Toolbox observer gained PARTY_OBSERVED, the byte that
  //                separates "you have no heroes" from "nobody read the party";
  //   310 ->  410  Layout grew by the 25 party-detail address words, at 4 bytes
  //                each, so the config block the host copies in got 100 larger;
  //   410 ->  908  party.rs, whose zeroed `[Hero; PARTY_SLOTS]` const is 8 x 60
  //                bytes of data on its own;
  //   908 -> 1222  attribute ranks: `Hero` grew a `[u32; 9]`, so that same
  //                const went from 8 x 60 to 8 x 96 (+288), and Layout took
  //                seven more address words (+28).
  //   1222 -> 1346 map policy, player observation and difficulty add four
  //                layout words plus their closed kernel logic.
  //   1346 -> 1349 the live optional-observer mask adds one u32 static; linker
  //                packing absorbs one byte elsewhere in the data segment.
  //   1349 -> 1345 the unused hero-panel state left production for the source
  //                archive, removing its one u32 static.
  //   1345 -> 1277 two direct AgentLiving profession offsets replace the
  //                larger attribute-to-profession inference tables.
  //   1277 -> 1437 the bounded 40-word account hero profession table lets
  //                Apply reject an incompatible build before roster mutation.
  //   1437 -> 1513 the certified attribute-family fallback keeps player build
  //                capture working when AgentLiving profession bytes are not
  //                populated by the official-client representation.
  //   1513 -> 1437 the client's canonical party profession-state table
  //                replaces both untrustworthy guesses and their lookup data.
  //   1437 -> 2017 two bounded 70-word skill-unlock bitsets (+560), three
  //                certified layout words (+12), and their observation state
  //                (+8) distinguish account unlocks from character learning.
  //   2017 -> 2041 six exact-build Xunlai player-record layout words let the
  //                core snapshot prove access without consulting the party.
  //   2041 -> 2105 the fail-closed skill-key observer adds its publication
  //                state and eight child-frame slots; the 156-byte snapshot
  //                itself remains in host-owned memory outside this footprint.
  //   2105 -> 2153 eight cached slot IDs and their bounded audit state replace
  //                a complete frame-table traversal on every game tick.
  //   2153 -> 2185 cooldown observation adds only cached row identity and
  //                sequence state; its 60-byte record remains host-owned.
  //   2185 -> 2189 cached row size validates identity without a periodic
  //                skillbar-table scan on ordinary ticks.
  //   2189 -> 2197 the independently active play-region publisher adds only
  //                its pointer and sequence; its 28-byte record is host-owned.
  //   2197 -> 2201 cooldown row caching gains a bounded audit-age word so a
  //                later duplicate player row cannot remain hidden indefinitely.
  //   2201 -> 2209 Travel adds one character-key layout word and bounded
  //                play-region publication state; its larger record remains
  //                in host-owned memory outside this footprint.
  //   2209 -> 2212 the Travel unlock observer moves beside its play-region
  //                publisher, keeping feature-specific memory reads together.
  //   2212 -> 2244 the account-character publisher adds its region pointer,
  //                stable-root state, and sequence; its bounded 4632-byte
  //                snapshot remains in host-owned memory.
  // This constant exists so a kernel whose footprint moves cannot ship without
  // someone saying why. One page is still the ceiling, and this remains far
  // under it.
  0x01, 0x05, 0xc4, 0x11, 0x02, 0x00, 0x00,
]);

const WASM_PAGE_BYTES = 65_536;
const TEST_MEMORY_PAGES = 4;
const TEST_MEMORY_BASE = WASM_PAGE_BYTES;
const TEST_SENTINELS = Object.freeze([0xa5, 0x5a]);

/** @param {Uint8Array} binary */
function sectionIds(binary) {
  let offset = 8;
  const readUleb = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      assert.ok(offset < binary.byteLength, "truncated kernel section");
      const byte = binary[offset++]
        ?? assert.fail("truncated kernel section byte");
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      assert.ok(shift <= 35, "oversized kernel section length");
    }
  };
  const ids = [];
  while (offset < binary.byteLength) {
    const id = binary[offset++] ?? assert.fail("missing kernel section id");
    const size = readUleb();
    ids.push(id);
    offset += size;
    assert.ok(offset <= binary.byteLength, "kernel section exceeds binary");
  }
  return ids;
}

/** @param {readonly number[]} dylink */
function dylinkMemorySize(dylink) {
  let offset = 0;
  const readUleb = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      assert.ok(offset < dylink.length, "truncated dylink.0 footprint");
      const byte = dylink[offset++]
        ?? assert.fail("truncated dylink.0 byte");
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      assert.ok(shift <= 35, "oversized dylink.0 value");
    }
  };
  assert.equal(readUleb(), 1, "dylink.0 memory subsection is missing");
  const subsectionBytes = readUleb();
  const subsectionEnd = offset + subsectionBytes;
  const memorySize = readUleb();
  readUleb();
  readUleb();
  readUleb();
  assert.equal(offset, subsectionEnd, "dylink.0 memory subsection is malformed");
  assert.equal(offset, dylink.length, "unexpected dylink.0 subsection");
  return memorySize;
}

/** @param {WebAssembly.Module} module @param {number} memorySize */
function validateInstantiationWrites(module, memorySize) {
  assert.ok(
    memorySize <= WASM_PAGE_BYTES,
    "companion kernel dylink.0 footprint exceeds one page",
  );
  /** @param {number} value */
  const immutableI32 = (value) => new WebAssembly.Global(
    { value: "i32", mutable: false },
    value,
  );
  const allowedEnd = TEST_MEMORY_BASE + memorySize;
  for (const sentinel of TEST_SENTINELS) {
    const memory = new WebAssembly.Memory({ initial: TEST_MEMORY_PAGES });
    const entireMemory = new Uint8Array(memory.buffer);
    entireMemory.fill(sentinel);
    const before = entireMemory.slice();
    const instance = new WebAssembly.Instance(module, {
      env: {
        memory,
        __indirect_function_table: new WebAssembly.Table({
          initial: 0,
          maximum: 0,
          element: "anyfunc",
        }),
        __memory_base: immutableI32(TEST_MEMORY_BASE),
        __stack_pointer: new WebAssembly.Global(
          { value: "i32", mutable: true },
          TEST_MEMORY_BASE + WASM_PAGE_BYTES,
        ),
        __table_base: immutableI32(0),
      },
    });
    assert.doesNotThrow(
      () => new WebAssembly.Instance(companionKernelSignatureModule, {
        kernel: instance.exports,
      }),
      "companion kernel exports have invalid function types",
    );
    for (let index = 0; index < entireMemory.byteLength; index += 1) {
      if (entireMemory[index] === before[index]) continue;
      assert.ok(
        index >= TEST_MEMORY_BASE && index < allowedEnd,
        "companion kernel active data writes outside its dylink.0 footprint",
      );
    }
  }
}

/**
 * Validate everything needed before the candidate can enter build/renderer.
 * The browser repeats the exact function-type check independently before it
 * enables the hook; this build gate prevents publishing the wrong type first.
 *
 * @param {Uint8Array} binary
 * @returns {WebAssembly.Module}
 */
export function validateCompanionKernelContract(binary) {
  const wasm = new Uint8Array(binary);
  assert.equal(
    WebAssembly.validate(wasm),
    true,
    "companion kernel is invalid WebAssembly",
  );
  assert.equal(
    sectionIds(binary).includes(8),
    false,
    "companion kernel must not contain a start function",
  );
  const module = new WebAssembly.Module(wasm);
  const dylinkSections = WebAssembly.Module.customSections(module, "dylink.0")
    .map((section) => [
      ...new Uint8Array(section),
    ]);
  assert.deepEqual(
    dylinkSections,
    [COMPANION_KERNEL_DYLINK0],
    "companion kernel dylink.0 footprint is invalid",
  );
  assert.deepEqual(
    WebAssembly.Module.imports(module)
      .map((entry) => `${entry.module}.${entry.name}:${entry.kind}`)
      .sort(),
    COMPANION_KERNEL_IMPORTS,
    "companion kernel import surface is invalid",
  );
  assert.deepEqual(
    WebAssembly.Module.exports(module)
      .map((entry) => `${entry.name}:${entry.kind}`)
      .sort(),
    COMPANION_KERNEL_EXPORTS,
    "companion kernel export surface is invalid",
  );
  const dylink = dylinkSections[0];
  assert.ok(dylink, "companion kernel dylink.0 footprint is missing");
  validateInstantiationWrites(module, dylinkMemorySize(dylink));
  return module;
}
