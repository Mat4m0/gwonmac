import assert from "node:assert/strict";
import {
  CARTOGRAPHY_REACHABILITY_ABI,
  CARTOGRAPHY_REACHABILITY_EXPORTS,
  CARTOGRAPHY_REACHABILITY_IMPORTS,
  CARTOGRAPHY_REACHABILITY_REGION_BYTES,
  cartographyReachabilitySignatureBytes,
} from "../src/shared/cartography-reachability-kernel-contract.ts";

const signatureModule = new WebAssembly.Module(
  cartographyReachabilitySignatureBytes(),
);

/** @param {Uint8Array} binary */
export function validateCartographyReachabilityKernelContract(binary) {
  const bytes = new Uint8Array(binary);
  assert.equal(WebAssembly.validate(bytes), true, "reachability kernel is invalid Wasm");
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(
    WebAssembly.Module.customSections(module, "dylink.0")
      .map((value) => [...new Uint8Array(value)]),
    [[1, 4, 8, 2, 0, 0]],
    "reachability kernel private footprint changed",
  );
  assert.deepEqual(
    WebAssembly.Module.imports(module)
      .map((entry) => `${entry.module}.${entry.name}:${entry.kind}`).sort(),
    CARTOGRAPHY_REACHABILITY_IMPORTS,
    "reachability kernel import surface is invalid",
  );
  assert.deepEqual(
    WebAssembly.Module.exports(module)
      .map((entry) => `${entry.name}:${entry.kind}`).sort(),
    CARTOGRAPHY_REACHABILITY_EXPORTS,
    "reachability kernel export surface is invalid",
  );
  const memory = new WebAssembly.Memory({ initial: 2 });
  /** @param {number} value */
  const immutable = (value) => new WebAssembly.Global(
    { value: "i32", mutable: false }, value,
  );
  const instance = new WebAssembly.Instance(module, {
    env: {
      memory,
      __memory_base: immutable(65_536),
      __stack_pointer: new WebAssembly.Global(
        { value: "i32", mutable: true }, 131_072,
      ),
      __table_base: immutable(0),
    },
  });
  assert.doesNotThrow(() => new WebAssembly.Instance(signatureModule, {
    kernel: instance.exports,
  }), "reachability kernel signatures are invalid");
  const abi = /** @type {() => number} */ (
    instance.exports.cartography_reachability_abi
  );
  const regionBytes = /** @type {() => number} */ (
    instance.exports.cartography_reachability_region_bytes
  );
  assert.equal(abi(), CARTOGRAPHY_REACHABILITY_ABI);
  assert.equal(
    regionBytes(),
    CARTOGRAPHY_REACHABILITY_REGION_BYTES,
  );
  return module;
}
