/** Malformed and unrelated input must never become friend observation authority. */
import assert from "node:assert/strict";
import test from "node:test";
import { inspectFriendLifecycle } from "../../src/main/certification/friend-lifecycle-evidence.js";
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

test("friend lifecycle evidence refuses malformed and unrelated modules", () => {
  for (const bytes of [new Uint8Array(), Uint8Array.of(0, 97, 115), WASM_HEADER]) {
    const result = inspectFriendLifecycle(bytes);
    assert.equal(result.status, "unavailable");
    assert.equal(result.runtimeAuthority, false);
    assert.equal(result.candidate, null);
    assert.ok(result.unresolved.length > 0);
    assert.match(result.inputSha256, /^[a-f0-9]{64}$/);
  }
});
