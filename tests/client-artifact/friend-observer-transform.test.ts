/** Execute the exact production friend hooks without starting the game or using account data. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyLocalClientBytes } from "../../src/main/certification/local-client-verifier.js";
import { rewriteTemplateSaveWasm } from "../../src/main/certification/template-save-compat.js";
import { transformEnhancementWasm } from "../../src/main/certification/enhancement-transform.js";
import {
  deriveFriendObserverBuild,
  FRIEND_LIFECYCLE_NOTIFICATIONS as N,
  isFriendObserverBuild,
  rewriteFriendObserverWasm,
} from "../../src/main/certification/friend-observer-transform.js";
import { RELEASE_ENHANCEMENT_CAPABILITIES } from "../../src/shared/enhancement-contracts.js";
import { sectionById, splitSections } from "../../src/main/core/wasm-binary.js";
import { observerTransformFixture } from "../fixtures/friend-observer-transform.js";
import { queueFixture } from "../fixtures/native-friend-queue.js";

test("production friend observer preserves native behavior and emits closed lifecycle facts", {
  timeout: 120_000,
}, async (t) => {
  const path = process.env.GW_CLIENT_WASM;
  assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
  const official = new Uint8Array(await readFile(path));
  const capabilities = RELEASE_ENHANCEMENT_CAPABILITIES.tools;
  const verified = verifyLocalClientBytes(official, capabilities);
  assert.ok(verified.templateSaveBuild && verified.enhancementBuild);
  const template = rewriteTemplateSaveWasm(official, verified.templateSaveBuild);
  const input = transformEnhancementWasm(template, verified.enhancementBuild, capabilities);
  const build = deriveFriendObserverBuild(input);
  assert.ok(build);
  assert.equal(isFriendObserverBuild(build, build.certificate.inputSha256), true);
  const output = rewriteFriendObserverWasm(input, build.certificate);
  assert.equal(createHash("sha256").update(output).digest("hex"), build.outputSha256);
  const fixture = () => observerTransformFixture(input, output, build.certificate);
  const REQUEST = 0x700000;
  const CONTEXT = 0x710000;
  const METADATA = 0x720000;
  const EVENT = 0x730000;

  await t.test("the rewrite is deterministic and preserves imports, table, and exports", () => {
    assert.deepEqual(rewriteFriendObserverWasm(input, build.certificate), output);
    for (const id of [2, 4, 7]) {
      assert.deepEqual(sectionById(splitSections(output), id), sectionById(splitSections(input), id));
    }
    assert.equal(deriveFriendObserverBuild(template), null, "an Enhancement predecessor is required");
    assert.equal(deriveFriendObserverBuild(output), null, "already-rewritten roles cannot be installed twice");
    assert.throws(() => rewriteFriendObserverWasm(input, {
      ...build.certificate,
      lifecycle: { ...build.certificate.lifecycle, eventContextPointer: 1 },
    }), /production proof does not reproduce/);
  });

  await t.test("invalidation runs before each native lifecycle entry", async () => {
    for (const role of ["clear", "teardown", "loginStart", "logout"] as const) {
      const f = await fixture();
      const args = role === "teardown" ? [] : role === "loginStart" ? [1, 2, 3] : [7];
      f.call(role, ...args);
      assert.deepEqual(f.events.map(({ kind, name }) => [kind, name]), [
        ["notification", String(N.invalidate)], ["native", role],
      ]);
      assert.deepEqual(f.events[1]!.args, args);
    }
  });

  await t.test("request identity is captured after the native sender records its connection", async () => {
    const f = await fixture();
    f.write(REQUEST + 32, 42);
    f.handlers.set("requestSent", () => { f.write(REQUEST + 28, 7); });
    f.call("requestSent", REQUEST);
    assert.deepEqual(f.notifications()[0]!.args, [4, N.requestSent, 42, 7, 0, 0]);
    assert.equal(f.events[0]!.kind, "native");
  });

  await t.test("only accepted inner login events on the bound queue advance the ordinal", async () => {
    const f = await fixture();
    f.write(build.certificate.lifecycle.eventContextPointer, CONTEXT);
    assert.equal(f.call("queueAppend", CONTEXT + 592, 0, 14, 1, 0, 0), 1);
    assert.deepEqual(f.notifications()[0]!.args, [4, N.completionQueued, 0, 0, 0, 0]);
    f.events.length = 0;
    f.call("queueAppend", CONTEXT + 592, 0, 38, 1, 0, 0);
    f.call("queueAppend", CONTEXT + 596, 0, 14, 1, 0, 0);
    f.handlers.set("queueAppend", () => 0);
    assert.equal(f.call("queueAppend", CONTEXT + 592, 0, 14, 1, 0, 0), 0);
    assert.equal(f.notifications().length, 0);
  });

  await t.test("completion brackets the actual enqueue without reading identity from its payload", async () => {
    const f = await fixture();
    f.write(build.certificate.lifecycle.eventContextPointer, CONTEXT);
    f.write(REQUEST + 32, 42);
    f.write(REQUEST + 28, 7);
    f.write(REQUEST + 24, 0);
    f.handlers.set("loginCompleted", () => {
      f.call("queueAppend", CONTEXT + 592, 0, 14, 1, 0, 0);
    });
    f.call("loginCompleted", REQUEST);
    assert.deepEqual(f.notifications().map(({ args }) => args), [
      [4, N.completionStarted, 42, 7, 1, 0],
      [4, N.completionQueued, 0, 0, 0, 0],
      [4, N.completionFinished, 0, 0, 0, 0],
    ]);
    f.events.length = 0;
    f.write(REQUEST + 24, 7);
    f.call("loginCompleted", REQUEST);
    assert.deepEqual(f.notifications()[0]!.args, [4, N.completionStarted, 42, 7, 0, 0]);
  });

  await t.test("processed means the roster callback returned for inner event 14 in category 36", async () => {
    const f = await fixture();
    f.write(METADATA + 4, 36);
    f.write(EVENT, 14);
    f.call("rosterCallback", METADATA, EVENT);
    assert.deepEqual(f.events.map(({ kind, name }) => [kind, name]), [
      ["native", "rosterCallback"], ["notification", String(N.completionProcessed)],
    ]);
    f.events.length = 0;
    f.write(METADATA + 4, 14);
    f.call("rosterCallback", METADATA, EVENT);
    f.write(METADATA + 4, 36);
    f.write(EVENT, 38);
    f.call("rosterCallback", METADATA, EVENT);
    assert.equal(f.notifications().length, 0);
  });

  await t.test("production hooks follow the real native queue through copied category-36 envelopes", async () => {
    const f = await queueFixture(official, { bytes: output, certificate: build.certificate });
    f.rosterEntry();
    f.completeLogin(0);
    assert.deepEqual(f.observerNotifications, [
      [4, N.completionStarted, 42, 7, 1, 0],
      [4, N.completionQueued, 0, 0, 0, 0],
      [4, N.completionFinished, 0, 0, 0, 0],
    ]);
    assert.equal(f.delivered.length, 0);
    f.drain();
    assert.deepEqual(f.delivered.map(({ id, size }) => ({ id, size })), [
      { id: 38, size: 104 }, { id: 14, size: 352 },
    ]);
    assert.deepEqual(f.observerNotifications.at(-1), [4, N.completionProcessed, 0, 0, 0, 0]);
  });

  await t.test("the real disabled and closed queues never emit an accepted completion notification", async () => {
    for (const [offset, value] of [[20, 4], [592, 1]] as const) {
      const f = await queueFixture(official, { bytes: output, certificate: build.certificate });
      f.write(0x700000 + offset, value);
      f.completeLogin(0);
      f.drain();
      assert.deepEqual(f.observerNotifications.map((args) => args[1]), [
        N.completionStarted, N.completionFinished,
      ]);
      assert.equal(f.delivered.length, 0);
    }
  });

  await t.test("the real disconnect body withdraws before its pointer store and skips absent connections", async () => {
    const f = await fixture();
    const connectionPointer = build.certificate.lifecycle.connectionPointer;
    f.write(connectionPointer, CONTEXT);
    f.write(CONTEXT, 7);
    const observed: number[] = [];
    f.observe(() => { observed.push(f.read(connectionPointer)); });
    f.call("disconnect", 0);
    assert.deepEqual(observed, [CONTEXT]);
    assert.equal(f.read(connectionPointer), 0);
    f.call("disconnect", 0);
    assert.deepEqual(observed, [CONTEXT]);
  });

  await t.test("an uninstalled companion leaves native calls and results intact", async () => {
    const f = await fixture();
    f.hook.value = 0;
    f.call("clear", 7);
    f.handlers.set("queueAppend", () => 19);
    assert.equal(f.call("queueAppend", 0, 0, 14, 1, 0, 0), 19);
    assert.equal(f.notifications().length, 0);
    assert.deepEqual(f.events.map(({ name }) => name), ["clear", "queueAppend"]);
  });
});
