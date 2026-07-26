// The one release test that executes production code: it loads the *built*
// preload — build/preload/preload.cjs, the file a packaged app actually runs —
// in a vm with a recording `ipcRenderer` and calls every capability it exposes.
//
// This is what replaced the source scans P5.16 deleted. The old release suite
// searched the preload's text for all 32 channel strings, which proved a copy
// existed and nothing about what the preload did with it. Here the channels are
// read from the canonical `IPC`, every exposed method is called, and the set of
// channels actually invoked is compared against the set of channels main is
// required to answer — so a capability wired to the wrong channel, or a channel
// no renderer can reach, fails.
//
// The generator is proved separately, over altered contracts, in
// tests/unit/the-preload-is-generated-from-the-canonical-channels.test.ts. This
// file's subject is the artifact.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT = "build/preload/preload.cjs";

const { EVENT_CHANNELS, IPC, RENDERER_INIT_ARGUMENT } = await import(
  new URL("../../build/shared/contracts.js", import.meta.url)
);
const source = await readFile(path.join(root, ARTIFACT), "utf8");

/**
 * Loads the built preload into a fresh realm and returns what it exposed
 * alongside everything it asked `ipcRenderer` to do.
 *
 * @param {string[]} [argv] the renderer's own argv, which is where the launch
 *   configuration arrives from `webPreferences.additionalArguments`.
 */
function load(argv = []) {
  const invoked = [];
  const sent = [];
  const listeners = new Map();
  let exposedAs;
  let api;
  vm.runInNewContext(source, {
    console,
    process: { argv },
    require(name) {
      assert.equal(name, "electron", "the preload requires only electron");
      return {
        contextBridge: {
          exposeInMainWorld(worldName, value) {
            exposedAs = worldName;
            api = value;
          },
        },
        ipcRenderer: {
          invoke(channel, ...args) {
            invoked.push({ channel, args });
            return Promise.resolve(`resolved:${channel}`);
          },
          send(channel, ...args) {
            sent.push({ channel, args });
          },
          on(channel, handler) {
            listeners.set(channel, [...(listeners.get(channel) ?? []), handler]);
          },
          removeListener(channel, handler) {
            listeners.set(
              channel,
              (listeners.get(channel) ?? []).filter((one) => one !== handler),
            );
          },
        },
      };
    },
  });
  assert.equal(exposedAs, "gwNative", "the preload exposed the wrong world name");
  assert.ok(api, "the preload exposed nothing");
  return { api, invoked, sent, listeners };
}

/** Every function the bridge exposes, as dotted paths. */
function methodPaths(value, prefix = "") {
  const paths = [];
  for (const [key, member] of Object.entries(value)) {
    const here = prefix ? `${prefix}.${key}` : key;
    if (typeof member === "function") paths.push(here);
    else if (member && typeof member === "object") {
      paths.push(...methodPaths(member, here));
    }
  }
  return paths;
}

const call = (api, dotted) =>
  dotted.split(".").reduce((owner, key) => owner[key], api);

const PACKET = new Uint8Array([1, 2, 3, 4]);

// Every request/response capability, with the arguments a caller really passes.
// Nothing here is optional: the coverage assertion below fails if a method the
// preload exposes is missing from this table or from SUBSCRIPTIONS.
const INVOCATIONS = [
  { path: "progress.current", args: [], channel: IPC.progressCurrent },
  { path: "snapshot.metadata", args: [], channel: IPC.snapshotMetadata },
  { path: "dns.resolve", args: ["geodc.arenanetworks.com"], channel: IPC.dnsResolve },
  { path: "sockets.connect", args: ["10.0.0.1:6112"], channel: IPC.socketConnect },
  { path: "sockets.send", args: [7, PACKET], channel: IPC.socketSend },
  { path: "sockets.close", args: [7], channel: IPC.socketClose },
  { path: "settings.get", args: [], channel: IPC.settingsGet },
  { path: "settings.set", args: [{ renderScale: 2 }], channel: IPC.settingsSet },
  { path: "settings.reset", args: [], channel: IPC.settingsReset },
  { path: "credentials.load", args: [], channel: IPC.credentialsLoad },
  {
    path: "credentials.save",
    args: [{ username: "u", password: "p" }],
    channel: IPC.credentialsSave,
  },
  { path: "credentials.clear", args: [], channel: IPC.credentialsClear },
  { path: "cache.info", args: [], channel: IPC.cacheInfo },
  { path: "cache.clearAndRestart", args: [], channel: IPC.cacheClear },
  { path: "cache.downloadAll", args: [], channel: IPC.cacheDownloadAll },
  { path: "cache.stopDownload", args: [], channel: IPC.cacheStopDownload },
  { path: "gameStorage.resetAndRestart", args: [], channel: IPC.gameStorageReset },
  { path: "diagnostics.clockSync", args: [1_234], channel: IPC.diagnosticsClockSync },
  {
    path: "diagnostics.recordClockOffset",
    args: [-40, 900],
    channel: IPC.diagnosticsClockResult,
  },
  {
    path: "diagnostics.recordGraphics",
    args: [{ renderer: "Apple M1" }],
    channel: IPC.diagnosticsGraphics,
  },
  {
    path: "diagnostics.recordRendererMetrics",
    args: [{ rafCount: 60 }],
    channel: IPC.diagnosticsRendererMetrics,
  },
  {
    path: "diagnostics.recordRendererFrames",
    args: [{ frames: [] }],
    channel: IPC.diagnosticsRendererFrames,
  },
  {
    path: "diagnostics.recordRendererMilestone",
    args: ["renderer.loaded", 5_000, { detail: 1 }],
    channel: IPC.diagnosticsRendererMilestone,
  },
  { path: "diagnostics.current", args: [], channel: IPC.diagnosticsCurrent },
  { path: "app.openExternal", args: ["support"], channel: IPC.appOpenExternal },
  { path: "app.requestQuit", args: [], channel: IPC.appRequestQuit },
  { path: "client.retry", args: [], channel: IPC.clientRetry },
  {
    path: "client.healthy",
    args: [{ generation: 7, fingerprint: "a".repeat(64) }],
    channel: IPC.clientHealthy,
  },
  { path: "client.session", args: [], channel: IPC.clientSession },
  { path: "releaseNotice.check", args: [], channel: IPC.releaseNoticeCheck },
];

/** The main→renderer streams, which subscribe instead of invoking. */
const SUBSCRIPTIONS = [
  { path: "progress.onChange", channel: IPC.progressEvent },
  { path: "progress.onPrefetch", channel: IPC.prefetchEvent },
  { path: "sockets.onEvent", channel: IPC.socketEvent },
];

test("every exposed capability is exercised by this file", () => {
  const { api } = load();
  assert.deepEqual(
    methodPaths(api).sort(),
    [
      "commands.handle",
      ...INVOCATIONS.map((one) => one.path),
      ...SUBSCRIPTIONS.map((one) => one.path),
    ].sort(),
    "a capability was added to or removed from the preload without a test here",
  );
});

test("each capability invokes the channel the contracts name, with its arguments", async () => {
  const { api, invoked } = load();
  for (const { path: dotted, args, channel } of INVOCATIONS) {
    const settled = await call(api, dotted)(...args);
    assert.deepEqual(
      invoked.at(-1),
      { channel, args },
      `${dotted} did not forward its arguments to ${channel}`,
    );
    // The bridge returns main's answer unchanged; it neither unwraps nor
    // re-wraps it. `cache.downloadAll` in particular carries a failure code as
    // a value, because Electron flattens an `invoke` rejection to its message.
    assert.equal(settled, `resolved:${channel}`, `${dotted} lost main's answer`);
  }
  assert.equal(invoked.length, INVOCATIONS.length, "a capability invoked twice");
});

test("the renderer can reach every channel main is required to answer", () => {
  // What the deleted 32-channel source scan was reaching for, executed. The
  // channels with an `ipcMain.handle` handler are exactly the channels some
  // exposed capability calls: nothing main answers is unreachable, and nothing
  // the preload calls is unanswered.
  const invokeChannels = Object.entries(IPC)
    .filter(([key]) => !EVENT_CHANNELS.includes(key))
    .map(([, channel]) => channel);
  assert.deepEqual(
    [...new Set(INVOCATIONS.map((one) => one.channel))].sort(),
    invokeChannels.sort(),
  );
});

test("an oversized or shapeless packet is refused in the renderer, without IPC", async () => {
  const { api, invoked } = load();
  const MAX = 4 * 1024 * 1024;
  for (const payload of [
    undefined,
    null,
    "not a view",
    { byteLength: "0" },
    new Uint8Array(MAX + 1),
  ]) {
    await assert.rejects(
      () => api.sockets.send(1, payload),
      (error) =>
        error.name === "TypeError" && /invalid socket payload/.test(error.message),
    );
  }
  assert.deepEqual(invoked, [], "a refused packet still crossed the bridge");

  // The ceiling itself, not one byte below it.
  await api.sockets.send(1, new Uint8Array(MAX));
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0].channel, IPC.socketSend);
});

test("a packet view crosses the bridge as it was handed over", async () => {
  // The preload adds no copy: compacting a WASM heap view is the renderer's job
  // and is proved in tests/unit/socket-host.test.ts. What is proved here is that
  // nothing between that compaction and Electron's own structured clone
  // substitutes a different object.
  const { api, invoked } = load();
  await api.sockets.send(3, PACKET);
  assert.equal(invoked[0].args[1], PACKET);
});

test("subscriptions are independent, and unsubscribing is idempotent", () => {
  const { api, invoked, listeners } = load();
  for (const { path: dotted, channel } of SUBSCRIPTIONS) {
    const receivedA = [];
    const receivedB = [];
    const stopA = call(api, dotted)((value) => receivedA.push(value));
    const stopB = call(api, dotted)((value) => receivedB.push(value));
    // No subscribe/unsubscribe command: main broadcasts, the preload filters.
    assert.deepEqual(invoked, [], `${dotted} asked main to start the stream`);
    assert.equal(listeners.get(channel).length, 2);

    const emit = (value) => {
      for (const handler of [...listeners.get(channel)]) handler({}, value);
    };
    emit("first");
    assert.deepEqual([receivedA, receivedB], [["first"], ["first"]]);

    stopA();
    stopA();
    emit("second");
    assert.deepEqual(
      [receivedA, receivedB],
      [["first"], ["first", "second"]],
      `${dotted} unsubscribed the wrong listener`,
    );

    stopB();
    assert.deepEqual(listeners.get(channel), [], `${dotted} leaked a listener`);
    assert.deepEqual(invoked, []);
  }
});

test("the sender event never reaches the subscriber", () => {
  // `IpcRendererEvent` carries `sender` and `ports`. Passing it on would hand
  // the page a live ipcRenderer through the frozen bridge.
  const { api, listeners } = load();
  const seen = [];
  api.progress.onChange((...args) => seen.push(args));
  const event = { sender: "the whole ipcRenderer", ports: [] };
  listeners.get(IPC.progressEvent)[0](event, { phase: "image", received: 1 });
  assert.deepEqual(seen, [[{ phase: "image", received: 1 }]]);
});

test("a renderer command is acknowledged once its handler has settled", async () => {
  const { api, sent, listeners } = load();
  let release;
  const handled = [];
  api.commands.handle((command) => {
    handled.push(command);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  assert.equal(listeners.get(IPC.rendererCommand).length, 1);

  listeners.get(IPC.rendererCommand)[0]({}, 11, { name: "flushCapture" });
  // A macrotask, not a microtask: draining the whole queue is what makes the
  // next assertion evidence rather than a race the preload happens to win.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(handled, [{ name: "flushCapture" }]);
  // Main's quit path awaits this acknowledgement so a capture flush finishes
  // inside the capture window. Sending it early would defeat the wait.
  assert.deepEqual(sent, [], "the command was acknowledged before it was handled");

  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [
    { channel: IPC.rendererCommandDone, args: [11, "completed"] },
  ]);
});

test("a handler that throws reports failure instead of false completion", async () => {
  const { api, sent, listeners } = load();
  api.commands.handle(() => {
    throw new Error("the renderer is having a bad day");
  });
  listeners.get(IPC.rendererCommand)[0]({}, 12, { name: "flushCapture" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [
    { channel: IPC.rendererCommandDone, args: [12, "failed"] },
  ]);
});

test("the renderer command transport accepts exactly one handler", () => {
  const { api, listeners } = load();
  api.commands.handle(() => undefined);
  assert.throws(
    () => api.commands.handle(() => undefined),
    /already registered/,
  );
  assert.equal(listeners.get(IPC.rendererCommand).length, 1);
});

test("the launch configuration is read from argv, and defaults to production", () => {
  // A renderer that cannot read its argument gets no Enhancement and no trace,
  // rather than a developer posture nobody asked for.
  const plainInit = (value) => ({
    ...value,
    enhancementSelection: { ...value.enhancementSelection },
  });
  assert.deepEqual(plainInit(load().api.init), {
    enhancementAutomation: false,
    enhancementSelection: { nativeCursor: false, targetReadout: false },
    templateFsTrace: false,
  });
  assert.deepEqual(
    plainInit(
      load([
        "--irrelevant",
        RENDERER_INIT_ARGUMENT +
          JSON.stringify({
            enhancementSelection: {
              nativeCursor: true,
              targetReadout: false,
            },
            templateFsTrace: true,
          }),
      ]).api.init,
    ),
    {
      enhancementAutomation: false,
      enhancementSelection: { nativeCursor: true, targetReadout: false },
      templateFsTrace: true,
    },
  );
  // Anything that is not the exact boolean `true`, and anything unparseable,
  // is off.
  for (const malformed of [
    '{"enhancementSelection":{"nativeCursor":"yes"}',
    '{"enhancementSelection":{"nativeCursor":1}}',
  ]) {
    assert.deepEqual(
      plainInit(load([RENDERER_INIT_ARGUMENT + malformed]).api.init),
      {
        enhancementAutomation: false,
        enhancementSelection: { nativeCursor: false, targetReadout: false },
        templateFsTrace: false,
      },
      malformed,
    );
  }
});

test("the bridge and every namespace it exposes are frozen", () => {
  const { api } = load();
  assert.equal(Object.isFrozen(api), true);
  for (const [key, value] of Object.entries(api)) {
    assert.equal(Object.isFrozen(value), true, `${key} is not frozen`);
  }
  // Two of those values are constants rather than namespaces of functions —
  // the launch configuration and the derived client's dirfd markers — and they
  // are frozen by the same loop.
  assert.equal(Object.isFrozen(api.init), true);
  assert.equal(Object.isFrozen(api.wasmBridgeMarkers), true);
});
