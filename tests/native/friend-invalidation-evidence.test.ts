/** Test private invalidation at native transitions without granting roster readiness. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { concat } from "../../src/main/core/wasm-binary.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  nativeFixture, ROOT, REQUEST, CONNECTION, SOCKET, ARRAY, RECORD, LOGIN_REPLY,
} from "../fixtures/native-friends.js";

test("private native invalidation preserves transitions between observer ticks", async (t) => {
  const path = process.env.GW_CLIENT_WASM;
  assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
  const input = new Uint8Array(await readFile(path));

  await t.test("the inspected sites cover every direct store overlapping the active connection pointer", () => {
    const evidence = wasmEvidence(input);
    assert.ok(evidence);
    const widths = [4, 8, 4, 8, 1, 2, 1, 2, 4];
    const decoded = evidence.decodeFunctions([]);
    const writers = decoded.flatMap((fn) => {
      const sites = fn.memorySites.filter((site) => {
        const width = widths[site.opcode - 0x36];
        return width !== undefined && site.value < CONNECTION + 4 && site.value + width > CONNECTION;
      });
      return sites.length ? [{ functionIndex: fn.functionIndex, stores: sites.map((site) => site.value) }] : [];
    });
    assert.deepEqual(writers, [
      { functionIndex: 10236, stores: [CONNECTION, CONNECTION, CONNECTION] },
      { functionIndex: 10240, stores: [CONNECTION] },
      { functionIndex: 10278, stores: [CONNECTION] },
    ]);
    assert.equal(decoded.some((fn) => fn.constantSites.some((site) => site.value === CONNECTION)), false,
      "this input does not materialize the exact pointer address as an i32 constant");
  });

  await t.test("logout and login remain detectable when sampled state returns to its old values", async () => {
    const f = await nativeFixture(input, true);
    const sampled = () => [f.call("authenticated"), f.read(CONNECTION), f.read(SOCKET), f.read(RECORD + 108)];
    const before = sampled();
    const selectedGeneration = f.generation();
    f.call("logout", 0);
    f.call("loginStart", 0, 0, 0);
    assert.equal(f.loginRequestCount(), 1);
    assert.deepEqual(f.invalidationAt.login, [selectedGeneration + 2]);
    f.write(REQUEST + 12, 1);
    f.write(REQUEST + 32, 43);
    f.write(LOGIN_REPLY + 4, 43);
    f.write(LOGIN_REPLY + 32, 23);
    f.write(LOGIN_REPLY + 48, 29);
    f.call("loginReply", LOGIN_REPLY, SOCKET);
    assert.deepEqual(sampled(), before);
    assert.equal(f.generation(), selectedGeneration + 2);
  });

  await t.test("table clear invalidates selection even when the same slot is repopulated", async () => {
    const f = await nativeFixture(input, true);
    const selectedGeneration = f.generation();
    f.write(ARRAY + 4, 0);
    f.call("clear", ROOT);
    f.write(ARRAY + 4, RECORD);
    assert.equal(f.read(ARRAY + 4), RECORD);
    assert.notEqual(f.generation(), selectedGeneration);
  });

  await t.test("an active connection removal invalidates only when the native store executes", async () => {
    const f = await nativeFixture(input, true);
    f.call("disconnect", 0);
    assert.equal(f.read(CONNECTION), 0);
    assert.equal(f.generation(), 2);
    f.call("disconnect", 0);
    assert.equal(f.generation(), 2, "the absent-connection path does not issue another invalidation");
  });

  await t.test("connection-event dispatch leaves ordinary data alone and catches a close", async () => {
    const f = await nativeFixture(input, true);
    const connectionSlot = 0x770000;
    f.write(connectionSlot, SOCKET);
    f.call("connectionEvent", 4, 0, 0, 0, connectionSlot);
    assert.equal(f.generation(), 1);
    f.call("connectionEvent", 2, 0, 0, 0, connectionSlot);
    assert.equal(f.read(CONNECTION), 0);
    assert.equal(f.generation(), 2);
    assert.equal(f.disconnectNoticeCount(), 1);
    assert.deepEqual(f.invalidationAt.disconnect, [2]);
  });

  await t.test("a connection destructor invalidates before releasing native storage", async () => {
    const f = await nativeFixture(input, true);
    const connectionSlot = 0x770000;
    f.write(connectionSlot, SOCKET);
    f.call("connectionEvent", 3, 0, 0, 0, connectionSlot);
    assert.equal(f.read(CONNECTION), 0);
    assert.deepEqual(f.invalidationAt.free, [2]);
  });

  await t.test("failed data dispatch invalidates before the disconnect notice", async () => {
    const f = await nativeFixture(input, true);
    const connectionSlot = 0x770000;
    f.write(connectionSlot, SOCKET);
    f.failDataDispatch();
    f.call("connectionEvent", 4, 0, 0, 0, connectionSlot);
    assert.equal(f.read(CONNECTION), 0);
    assert.deepEqual(f.invalidationAt.disconnect, [2]);
  });

  await t.test("connection replacement cannot inherit a selection from the old connection", async () => {
    const f = await nativeFixture(input, true);
    f.call("disconnect", 0);
    f.write(SOCKET, 8);
    f.write(SOCKET + 28, 0);
    f.call("connected", LOGIN_REPLY, SOCKET);
    assert.equal(f.read(CONNECTION), SOCKET);
    assert.equal(f.read(SOCKET), 8);
    assert.equal(f.generation(), 3);
    assert.equal(f.call("authenticated"), 0, "a new connection alone does not establish readiness");
  });

  await t.test("teardown invalidates accepted state", async () => {
    const f = await nativeFixture(input, true);
    f.write(ARRAY + 4, 0);
    const before = f.generation();
    f.call("teardown");
    assert.ok(f.generation() > before);
    assert.deepEqual(f.invalidationAt.teardown, [before + 1]);
  });

  await t.test("generation exhaustion stays terminal instead of recycling an old selection", async () => {
    const f = await nativeFixture(input, true);
    f.epoch.value = -1;
    f.call("logout", 0);
    assert.equal(f.generation(), 0);
    f.call("loginStart", 0, 0, 0);
    assert.equal(f.generation(), 0);
  });

  await t.test("instrumentation preserves native results, memory writes, and modeled side effects", async () => {
    const native = await nativeFixture(input);
    const instrumented = await nativeFixture(input, true);
    const snapshot = (f: typeof native) => ({
      memory: createHash("sha256").update(new Uint8Array(f.memory.buffer)).digest("hex"),
      events: f.events,
      statusRequests: f.statusRequests,
      outbound: f.outbound,
      completions: f.completions,
      loginRequests: f.loginRequestCount(),
      disconnectNotices: f.disconnectNoticeCount(),
    });
    for (const fixture of [native, instrumented]) {
      fixture.write(ARRAY + 4, 0);
      fixture.write(0x770000, SOCKET);
    }
    const operations: readonly [Parameters<typeof native.call>[0], ...number[]][] = [
      ["clear", ROOT], ["logout", 0], ["loginStart", 0, 0, 0],
      ["connectionEvent", 4, 0, 0, 0, 0x770000],
      ["connectionEvent", 2, 0, 0, 0, 0x770000],
      ["connected", LOGIN_REPLY, SOCKET], ["teardown"],
    ];
    for (const [name, ...args] of operations) {
      assert.equal(instrumented.call(name, ...args), native.call(name, ...args));
      assert.deepEqual(snapshot(instrumented), snapshot(native), name);
    }
    assert.equal(native.generation(), 1);
    assert.ok(instrumented.generation() > 1);
  });

  await t.test("the exact-client experiment refuses an unreviewed module", async () => {
    const otherInput = new Uint8Array(concat(input, Uint8Array.of(0, 1, 0)));
    assert.equal(WebAssembly.validate(otherInput), true);
    await assert.rejects(nativeFixture(otherInput, true), /reinspect native roles/);
  });
});
