import assert from "node:assert/strict";

export const COMPANION_KERNEL_IMPORTS = Object.freeze([
  "env.__indirect_function_table:table",
  "env.__memory_base:global",
  "env.__stack_pointer:global",
  "env.__table_base:global",
  "env.memory:memory",
]);

// One ABI list for both the build sealer and the deeper reproducibility gate.
// The renderer carries the same list because it independently type-checks the
// instantiated module at the browser boundary; a source invariant compares it.
export const COMPANION_KERNEL_SIGNATURES = Object.freeze([
  { name: "companion_init", typeIndex: 0 },
  { name: "companion_dispatch", typeIndex: 1 },
  { name: "companion_cursor_event_count", typeIndex: 2 },
  { name: "companion_abi", typeIndex: 2 },
  { name: "companion_config_bytes", typeIndex: 2 },
  { name: "companion_snapshot_bytes", typeIndex: 2 },
  { name: "companion_cursor_bytes", typeIndex: 2 },
  { name: "companion_toolbox_bytes", typeIndex: 2 },
  { name: "companion_party_bytes", typeIndex: 2 },
]);

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
  companion_abi: 8,
  companion_config_bytes: 324,
  companion_snapshot_bytes: 64,
  companion_cursor_bytes: 4_160,
  companion_toolbox_bytes: 64,
  companion_party_bytes: 832,
});

export const COMPANION_KERNEL_DYLINK0 = Object.freeze([
  // Memory footprint 1222 bytes (0xc6 0x09 as LEB128). Four documented moves:
  //   309 ->  310  the Toolbox observer gained PARTY_OBSERVED, the byte that
  //                separates "you have no heroes" from "nobody read the party";
  //   310 ->  410  Layout grew by the 25 party-detail address words, at 4 bytes
  //                each, so the config block the host copies in got 100 larger;
  //   410 ->  908  party.rs, whose zeroed `[Hero; PARTY_SLOTS]` const is 8 x 60
  //                bytes of data on its own;
  //   908 -> 1222  attribute ranks: `Hero` grew a `[u32; 9]`, so that same
  //                const went from 8 x 60 to 8 x 96 (+288), and Layout took
  //                seven more address words (+28).
  // This constant exists so a kernel whose footprint moves cannot ship without
  // someone saying why. One page is still the ceiling, and 1222 is a long way
  // under it.
  0x01, 0x05, 0xc6, 0x09, 0x02, 0x00, 0x00,
]);

const EXPECTED_EXPORTS = COMPANION_KERNEL_SIGNATURES
  .map(({ name }) => `${name}:function`)
  .sort();
const WASM_PAGE_BYTES = 65_536;
const TEST_MEMORY_PAGES = 4;
const TEST_MEMORY_BASE = WASM_PAGE_BYTES;
const TEST_SENTINELS = Object.freeze([0xa5, 0x5a]);

/** @param {number} value */
function encodeUleb(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 0x80);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

/** @param {string} value */
function encodeName(value) {
  const bytes = new TextEncoder().encode(value);
  return [...encodeUleb(bytes.byteLength), ...bytes];
}

/** @param {number} parameterCount @param {boolean} returnsI32 */
function i32FunctionType(parameterCount, returnsI32) {
  return [
    0x60,
    ...encodeUleb(parameterCount),
    ...Array.from({ length: parameterCount }, () => 0x7f),
    ...(returnsI32 ? [0x01, 0x7f] : [0x00]),
  ];
}

/** @param {number} id @param {number[]} payload */
function encodeSection(id, payload) {
  return [id, ...encodeUleb(payload.length), ...payload];
}

function makeCompanionSignatureModule() {
  const types = [
    // companion_init: snapshot, config, cursor, toolbox and party regions as
    // pointer/size pairs, plus the feature word. Eleven, not nine, since the
    // party region joined.
    i32FunctionType(11, true),
    i32FunctionType(6, false),
    i32FunctionType(0, true),
  ];
  const typeSection = [...encodeUleb(types.length), ...types.flat()];
  const importSection = [
    ...encodeUleb(COMPANION_KERNEL_SIGNATURES.length),
    ...COMPANION_KERNEL_SIGNATURES.flatMap(({ name, typeIndex }) => [
      ...encodeName("kernel"),
      ...encodeName(name),
      0,
      ...encodeUleb(typeIndex),
    ]),
  ];
  return new WebAssembly.Module(Uint8Array.of(
    0, 97, 115, 109, 1, 0, 0, 0,
    ...encodeSection(1, typeSection),
    ...encodeSection(2, importSection),
  ));
}

const COMPANION_SIGNATURE_MODULE = makeCompanionSignatureModule();

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
      () => new WebAssembly.Instance(COMPANION_SIGNATURE_MODULE, {
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
    EXPECTED_EXPORTS,
    "companion kernel export surface is invalid",
  );
  const dylink = dylinkSections[0];
  assert.ok(dylink, "companion kernel dylink.0 footprint is missing");
  validateInstantiationWrites(module, dylinkMemorySize(dylink));
  return module;
}
