import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("preload shares progress transport while keeping renderer listeners independent", async () => {
  const listeners = new Map();
  const invokes = [];
  let api;
  const ipcRenderer = {
    invoke(channel) {
      invokes.push(channel);
      return Promise.resolve();
    },
    on(channel, handler) {
      const current = listeners.get(channel) ?? [];
      current.push(handler);
      listeners.set(channel, current);
    },
    removeListener(channel, handler) {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((candidate) => candidate !== handler),
      );
    },
  };
  const source = await readFile(
    path.join(root, "src/preload/preload.cjs"),
    "utf8",
  );
  vm.runInNewContext(source, {
    atob: globalThis.atob,
    console,
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, "gwNative");
            api = value;
          },
        },
        ipcRenderer,
      };
    },
    Set,
    Uint8Array,
  });

  const receivedA = [];
  const receivedB = [];
  const unsubscribeA = api.progress.onChange((value) => receivedA.push(value));
  const unsubscribeB = api.progress.onChange((value) => receivedB.push(value));
  assert.equal(
    invokes.filter((channel) => channel === "gw:progress:subscribe").length,
    1,
  );

  for (const handler of listeners.get("gw:progress:event")) {
    handler({}, { phase: "image", received: 1 });
  }
  assert.equal(receivedA.length, 1);
  assert.equal(receivedB.length, 1);

  unsubscribeA();
  assert.equal(
    invokes.filter((channel) => channel === "gw:progress:unsubscribe").length,
    0,
  );
  for (const handler of listeners.get("gw:progress:event")) {
    handler({}, { phase: "image", received: 2 });
  }
  assert.equal(receivedA.length, 1);
  assert.equal(receivedB.length, 2);

  unsubscribeB();
  assert.equal(
    invokes.filter((channel) => channel === "gw:progress:unsubscribe").length,
    1,
  );
  assert.equal(listeners.get("gw:progress:event").length, 0);
});
