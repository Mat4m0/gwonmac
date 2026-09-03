/** Malformed and unrelated input must never become friend observation authority. */
import assert from "node:assert/strict";
import test from "node:test";
import { inspectFriendTable } from "../../src/main/certification/friend-table-evidence.js";
import { WASM_HEADER } from "../../src/main/core/wasm-binary.js";

test("friend evidence refuses malformed and unrelated modules without throwing", () => {
  for (const bytes of [new Uint8Array(), Uint8Array.of(0, 97, 115), WASM_HEADER]) {
    const result = inspectFriendTable(bytes);
    assert.equal(result.status, "unavailable");
    assert.equal(result.runtimeAuthority, false);
    assert.deepEqual(result.candidates, []);
    assert.ok(result.unresolved.length > 0);
    assert.match(result.inputSha256, /^[a-f0-9]{64}$/);
  }
});
