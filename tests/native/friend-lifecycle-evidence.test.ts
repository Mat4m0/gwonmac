/** Function-local lifecycle evidence from native WASM and synthetic account data. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  nativeFixture, ROOT, OWN_STATUS, REQUEST, CONNECTION, SOCKET, ALIAS, UUID,
  CHARACTER, ARRAY, RECORD, LOGIN_REPLY,
} from "../fixtures/native-friends.js";

test("native friend lifecycle experiments distinguish local state from session proof", async (t) => {
  const path = process.env.GW_CLIENT_WASM;
  assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
  const input = new Uint8Array(await readFile(path));

  await t.test("roster entries require a matching request that is still pending", async () => {
    const f = await nativeFixture(input);
    f.call("rosterEntry", 41, 1, UUID, ALIAS);
    assert.equal(f.events.length, 0);
    f.call("rosterEntry", 42, 1, UUID, ALIAS);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0]?.id, 38);
    assert.equal(f.call("completeRequest", 42, 0), 1);
    assert.equal(f.read(REQUEST + 20), 1);
    f.call("rosterEntry", 42, 1, UUID, ALIAS);
    assert.equal(f.events.length, 1, "completed requests reject later roster entries");
  });

  await t.test("the entry callback alone does not validate the request's connection", async () => {
    const f = await nativeFixture(input);
    f.write(SOCKET, 8); // A replacement connection; the request still belongs to ID 7.
    f.call("rosterEntry", 42, 1, UUID, ALIAS);
    assert.equal(f.events.length, 1, "upstream dispatch/cleanup must supply this missing guarantee");
  });

  await t.test("the native request pump aborts a pending request on connection replacement", async () => {
    const f = await nativeFixture(input);
    f.call("pumpRequest", REQUEST);
    assert.deepEqual(f.completions, [], "same-connection pending requests remain pending");
    f.write(SOCKET, 8);
    f.call("pumpRequest", REQUEST);
    assert.deepEqual(f.completions, [{ requestId: 42, error: 7 }]);
    f.call("rosterEntry", 42, 1, UUID, ALIAS);
    assert.equal(f.events.length, 0, "unlinked requests reject later entries");
  });

  await t.test("the native request pump aborts a pending request when disconnected", async () => {
    const f = await nativeFixture(input);
    f.write(CONNECTION, 0);
    f.call("pumpRequest", REQUEST);
    assert.deepEqual(f.completions, [{ requestId: 42, error: 7 }]);
  });

  await t.test("a completion already accepted is not rechecked against the connection by the pump", async () => {
    const f = await nativeFixture(input);
    assert.equal(f.call("completeRequest", 42, 0), 1);
    f.write(SOCKET, 8);
    f.call("pumpRequest", REQUEST);
    assert.deepEqual(f.completions, [{ requestId: 42, error: 0 }]);
  });

  await t.test("status and location callbacks do not establish an authenticated session", async () => {
    const f = await nativeFixture(input);
    f.write(CONNECTION, 0);
    f.call("statusEvent", 1, UUID, ALIAS, CHARACTER);
    f.call("locationEvent", ALIAS, 133, 0, 0, 0);
    assert.deepEqual(f.events.map((event) => event.id), [44, 40]);
  });

  await t.test("own status changes locally even when the status request cannot be sent", async () => {
    const f = await nativeFixture(input);
    f.write(CONNECTION, 0);
    f.call("setOwnStatus", 1);
    assert.equal(f.read(OWN_STATUS), 1);
    assert.deepEqual(f.statusRequests, []);
    f.write(CONNECTION, SOCKET);
    f.call("setOwnStatus", 0);
    assert.equal(f.read(OWN_STATUS), 0);
    assert.deepEqual(f.statusRequests, [0]);
  });

  await t.test("logout clears the auth flag while retaining connection and friend storage", async () => {
    const f = await nativeFixture(input);
    f.call("logout", 0);
    assert.deepEqual(f.outbound, [[13, 0]]);
    assert.equal(f.read(CONNECTION), SOCKET);
    assert.equal(f.read(SOCKET + 28) & 4, 0);
    assert.equal(f.call("authenticated"), 0);
    assert.equal(f.read(ARRAY + 4), RECORD);
    assert.equal(f.read(RECORD + 108), 133);
  });

  await t.test("a later login reply can restore the flag without changing the connection or roster", async () => {
    const f = await nativeFixture(input);
    const observed = () => [
      f.call("authenticated"), f.read(CONNECTION), f.read(SOCKET),
      f.read(ROOT), f.read(ROOT + 8), f.read(ARRAY + 4), f.read(RECORD + 108),
    ];
    const before = observed();
    f.call("logout", 0);
    assert.equal(f.call("authenticated"), 0);
    f.write(REQUEST + 12, 1); // Native login request kind.
    f.write(REQUEST + 32, 43);
    f.write(LOGIN_REPLY + 4, 43);
    f.write(LOGIN_REPLY + 32, 23); // Synthetic account UUID, no private input.
    f.write(LOGIN_REPLY + 48, 29); // Synthetic character UUID.
    f.call("loginReply", LOGIN_REPLY, SOCKET);
    assert.equal(f.call("authenticated"), 1);
    assert.deepEqual(observed(), before,
      "these sampled values alone do not record the intervening transition");
  });

  await t.test("friend status changes do not clear the last reported location", async () => {
    const f = await nativeFixture(input);
    f.call("setFriendStatus", ROOT, 1, 0);
    assert.equal(f.read(RECORD + 4), 0);
    assert.equal(f.read(RECORD + 108), 133);
    f.call("setFriendStatus", ROOT, 1, 1);
    assert.equal(f.read(RECORD + 108), 133);
    f.call("setFriendLocation", ROOT, 1, 55);
    assert.equal(f.read(RECORD + 108), 55);
  });

  await t.test("clearing an already empty table preserves its allocated slots", async () => {
    const f = await nativeFixture(input);
    f.write(ARRAY + 4, 0);
    f.call("clear", ROOT);
    assert.equal(f.read(ROOT), ARRAY);
    assert.equal(f.read(ROOT + 8), 2);
    assert.equal(f.read(OWN_STATUS), 4);
  });
});
