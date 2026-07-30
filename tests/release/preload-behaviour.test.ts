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
import type {
  GwNativeApi,
  RendererCommand,
  RendererInit,
} from "../../src/shared/contracts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT = "build/preload/preload.cjs";

// The canonical channels come out of `build/`, the same tree the artifact under
// test comes from, and are typed from the `src/` module `build/` is emitted
// from. The annotation is on the declaration rather than an assertion on the
// call: a dynamic `import()` whose specifier is not a literal resolves to
// `any`, and an untyped `IPC` would let the tables below name a channel that
// does not exist and read `undefined` instead of failing.
const {
  EVENT_CHANNELS,
  IPC,
  RENDERER_INIT_ARGUMENT,
}: typeof import("../../src/shared/contracts.ts") = await import(
  new URL("../../build/shared/contracts.js", import.meta.url).href
);
const source = await readFile(path.join(root, ARTIFACT), "utf8");

/** One recorded `ipcRenderer.invoke` or `.send`. */
interface Recorded {
  channel: string;
  args: unknown[];
}

/** A main→renderer listener the preload registered with `ipcRenderer.on`. */
type IpcListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Loads the built preload into a fresh realm and returns what it exposed
 * alongside everything it asked `ipcRenderer` to do.
 *
 * `argv` is the renderer's own argv, which is where the launch configuration
 * arrives from `webPreferences.additionalArguments`.
 *
 * The vm boundary is untyped — the subject is a JavaScript artifact — so
 * `GwNativeApi` here states the contract this file requires the preload to
 * meet, not something the load proves. The coverage test below executes that
 * requirement against what the artifact really exposed.
 */
function load(argv: string[] = []) {
  const invoked: Recorded[] = [];
  const sent: Recorded[] = [];
  const listeners = new Map<string, IpcListener[]>();
  // Written from inside the `require` shim below, so it is read back through
  // an object rather than through two `let` bindings the checker would see as
  // never assigned.
  const exposed: { worldName?: string; api?: GwNativeApi } = {};
  vm.runInNewContext(source, {
    console,
    process: { argv },
    require(name: string) {
      assert.equal(name, "electron", "the preload requires only electron");
      return {
        contextBridge: {
          exposeInMainWorld(worldName: string, value: GwNativeApi) {
            exposed.worldName = worldName;
            exposed.api = value;
          },
        },
        ipcRenderer: {
          invoke(channel: string, ...args: unknown[]) {
            invoked.push({ channel, args });
            return Promise.resolve(`resolved:${channel}`);
          },
          send(channel: string, ...args: unknown[]) {
            sent.push({ channel, args });
          },
          on(channel: string, handler: IpcListener) {
            listeners.set(channel, [...(listeners.get(channel) ?? []), handler]);
          },
          removeListener(channel: string, handler: IpcListener) {
            listeners.set(
              channel,
              (listeners.get(channel) ?? []).filter((one) => one !== handler),
            );
          },
        },
      };
    },
  });
  assert.equal(
    exposed.worldName,
    "gwNative",
    "the preload exposed the wrong world name",
  );
  assert.ok(exposed.api, "the preload exposed nothing");
  return {
    api: exposed.api,
    invoked,
    sent,
    /** The listeners registered for a channel, in registration order. */
    handlers: (channel: string): IpcListener[] => listeners.get(channel) ?? [],
  };
}

/** Every function the bridge exposes, as dotted paths. */
function methodPaths(value: object, prefix = ""): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(value)) {
    const member: unknown = Reflect.get(value, key);
    const here = prefix ? `${prefix}.${key}` : key;
    if (typeof member === "function") paths.push(here);
    else if (member && typeof member === "object") {
      paths.push(...methodPaths(member, here));
    }
  }
  return paths;
}

/**
 * A capability addressed by dotted path. Reflection is the point of the table
 * below — comparing it against what the bridge really exposes is what makes
 * the coverage assertion evidence — so the walk is by string and the signature
 * is the widest one every capability satisfies.
 */
type Capability = (...args: unknown[]) => unknown;

const isCapability = (value: unknown): value is Capability =>
  typeof value === "function";

function call(api: GwNativeApi, dotted: string): Capability {
  let owner: unknown = api;
  for (const key of dotted.split(".")) {
    if (owner === null || typeof owner !== "object") break;
    owner = Reflect.get(owner, key);
  }
  if (!isCapability(owner)) {
    throw new TypeError(`the bridge exposes no capability at ${dotted}`);
  }
  return owner;
}

const PACKET = new Uint8Array([1, 2, 3, 4]);

/** A request/response capability, with the arguments a caller really passes. */
interface Invocation {
  path: string;
  args: unknown[];
  channel: string;
}

// Every request/response capability, with the arguments a caller really passes.
// Nothing here is optional: the coverage assertion below fails if a method the
// preload exposes is missing from this table or from SUBSCRIPTIONS.
const INVOCATIONS: Invocation[] = [
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
  { path: "steam.getToken", args: [true], channel: IPC.steamToken },
  {
    path: "steam.store",
    args: ["0123456789abcdef0123456789abcdef", 1_800_000_000_000],
    channel: IPC.steamStore,
  },
  { path: "steam.clear", args: [], channel: IPC.steamClear },
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
  { path: "app.reveal", args: ["gameData"], channel: IPC.appRevealPath },
  { path: "app.requestQuit", args: [], channel: IPC.appRequestQuit },
  { path: "client.retry", args: [], channel: IPC.clientRetry },
  {
    path: "client.healthy",
    args: [{ generation: 7, fingerprint: "a".repeat(64) }],
    channel: IPC.clientHealthy,
  },
  { path: "client.session", args: [], channel: IPC.clientSession },
  { path: "appUpdates.getState", args: [], channel: IPC.appUpdatesGetState },
  { path: "appUpdates.check", args: [], channel: IPC.appUpdatesCheck },
  {
    path: "appUpdates.restartAndInstall",
    args: [],
    channel: IPC.appUpdatesRestartAndInstall,
  },
];

/** The main→renderer streams, which subscribe instead of invoking. */
interface Subscription {
  path: string;
  channel: string;
  /**
   * Named through the contract rather than walked by `path`, so a renamed
   * stream fails `tsc` here as well as at run time. `path` stays because it is
   * what the coverage assertion compares against the exposed surface.
   */
  subscribe: (
    api: GwNativeApi,
    listener: (value: unknown) => void,
  ) => () => void;
}

const SUBSCRIPTIONS: Subscription[] = [
  {
    path: "progress.onChange",
    channel: IPC.progressEvent,
    subscribe: (api, listener) => api.progress.onChange(listener),
  },
  {
    path: "progress.onPrefetch",
    channel: IPC.prefetchEvent,
    subscribe: (api, listener) => api.progress.onPrefetch(listener),
  },
  {
    path: "sockets.onEvent",
    channel: IPC.socketEvent,
    subscribe: (api, listener) => api.sockets.onEvent(listener),
  },
  {
    path: "appUpdates.onState",
    channel: IPC.appUpdatesState,
    subscribe: (api, listener) => api.appUpdates.onState(listener),
  },
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
    .filter(([key]) => !EVENT_CHANNELS.some((event) => event === key))
    .map(([, channel]) => channel);
  assert.deepEqual(
    [...new Set(INVOCATIONS.map((one) => one.channel))].sort(),
    invokeChannels.sort(),
  );
});

test("an oversized or shapeless packet is refused in the renderer, without IPC", async () => {
  const { api, invoked } = load();
  const MAX = 4 * 1024 * 1024;
  // Addressed reflectively on purpose. The guard exists for a renderer that
  // ignores `send(socketId: number, data: Uint8Array)`, so the payloads it has
  // to refuse cannot be passed through the typed capability.
  const send = call(api, "sockets.send");
  for (const payload of [
    undefined,
    null,
    "not a view",
    { byteLength: "0" },
    new Uint8Array(MAX + 1),
  ]) {
    await assert.rejects(
      async () => send(1, payload),
      // The rejection is built inside the vm's realm, so it is not an
      // `instanceof` of this realm's `TypeError`; the name is what crosses.
      { name: "TypeError", message: /invalid socket payload/u },
    );
  }
  // The type argument keeps `invoked` a list of records afterwards: a bare
  // `deepEqual` against `[]` is an assertion signature, so it would narrow the
  // binding to `never[]` and the ceiling check below would have nothing to read.
  assert.deepEqual<Recorded[]>(
    invoked,
    [],
    "a refused packet still crossed the bridge",
  );

  // The ceiling itself, not one byte below it.
  await api.sockets.send(1, new Uint8Array(MAX));
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0]?.channel, IPC.socketSend);
});

test("a packet view crosses the bridge as it was handed over", async () => {
  // The preload adds no copy: compacting a WASM heap view is the renderer's job
  // and is proved in tests/unit/socket-host.test.ts. What is proved here is that
  // nothing between that compaction and Electron's own structured clone
  // substitutes a different object.
  const { api, invoked } = load();
  await api.sockets.send(3, PACKET);
  assert.equal(invoked[0]?.args[1], PACKET);
});

test("subscriptions are independent, and unsubscribing is idempotent", () => {
  const { api, invoked, handlers } = load();
  for (const { path: dotted, channel, subscribe } of SUBSCRIPTIONS) {
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const stopA = subscribe(api, (value) => receivedA.push(value));
    const stopB = subscribe(api, (value) => receivedB.push(value));
    // No subscribe/unsubscribe command: main broadcasts, the preload filters.
    assert.deepEqual(invoked, [], `${dotted} asked main to start the stream`);
    assert.equal(handlers(channel).length, 2);

    const emit = (value: unknown) => {
      for (const handler of [...handlers(channel)]) handler({}, value);
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
    assert.deepEqual(handlers(channel), [], `${dotted} leaked a listener`);
    assert.deepEqual(invoked, []);
  }
});

test("the sender event never reaches the subscriber", () => {
  // `IpcRendererEvent` carries `sender` and `ports`. Passing it on would hand
  // the page a live ipcRenderer through the frozen bridge.
  const { api, handlers } = load();
  const seen: unknown[][] = [];
  api.progress.onChange((...args: unknown[]) => seen.push(args));
  const event = { sender: "the whole ipcRenderer", ports: [] };
  const [deliver] = handlers(IPC.progressEvent);
  assert.ok(deliver, "the preload subscribed to no progress channel");
  deliver(event, { phase: "image", received: 1 });
  assert.deepEqual(seen, [[{ phase: "image", received: 1 }]]);
});

test("a renderer command is acknowledged once its handler has settled", async () => {
  const { api, sent, handlers } = load();
  let release: (() => void) | undefined;
  const handled: RendererCommand[] = [];
  api.commands.handle((command) => {
    handled.push(command);
    return new Promise<void>((resolve) => {
      release = () => resolve();
    });
  });
  assert.equal(handlers(IPC.rendererCommand).length, 1);

  const [deliver] = handlers(IPC.rendererCommand);
  assert.ok(deliver, "the preload registered no renderer-command listener");
  deliver({}, 11, { name: "flushCapture" });
  // A macrotask, not a microtask: draining the whole queue is what makes the
  // next assertion evidence rather than a race the preload happens to win.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(handled, [{ name: "flushCapture" }]);
  // Main's quit path awaits this acknowledgement so a capture flush finishes
  // inside the capture window. Sending it early would defeat the wait.
  assert.deepEqual(sent, [], "the command was acknowledged before it was handled");

  assert.ok(release, "the preload never invoked the command handler");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [
    { channel: IPC.rendererCommandDone, args: [11, "completed"] },
  ]);
});

test("a handler that throws reports failure instead of false completion", async () => {
  const { api, sent, handlers } = load();
  api.commands.handle(() => {
    throw new Error("the renderer is having a bad day");
  });
  const [deliver] = handlers(IPC.rendererCommand);
  assert.ok(deliver, "the preload registered no renderer-command listener");
  deliver({}, 12, { name: "flushCapture" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [
    { channel: IPC.rendererCommandDone, args: [12, "failed"] },
  ]);
});

test("the renderer command transport accepts exactly one handler", () => {
  const { api, handlers } = load();
  api.commands.handle(() => undefined);
  assert.throws(
    () => api.commands.handle(() => undefined),
    /already registered/,
  );
  assert.equal(handlers(IPC.rendererCommand).length, 1);
});

test("the launch configuration is read from argv, and defaults to production", () => {
  // A renderer that cannot read its argument gets no Enhancement and no trace,
  // rather than a developer posture nobody asked for.
  const plainInit = (value: RendererInit) => ({
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
  for (const key of Object.keys(api)) {
    assert.equal(
      Object.isFrozen(Reflect.get(api, key)),
      true,
      `${key} is not frozen`,
    );
  }
  // Two of those values are constants rather than namespaces of functions —
  // the launch configuration and the derived client's dirfd markers — and they
  // are frozen by the same loop.
  assert.equal(Object.isFrozen(api.init), true);
  assert.equal(Object.isFrozen(api.wasmBridgeMarkers), true);
});
