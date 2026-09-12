/** Live Maps toggles cannot leak an overlay during asynchronous installation. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCartographyLifecycle } from "../../src/renderer/cartography-lifecycle.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test("Maps loads once, disposes on disable, and reinstalls on enable", async () => {
  let installs = 0;
  let disposals = 0;
  const host = createCartographyLifecycle(async () => { installs++; return () => { disposals++; }; }, error => assert.fail(String(error)));
  host.update(false);
  assert.equal(installs, 0);
  host.update(true);
  host.update(true);
  await tick();
  assert.equal(installs, 1);
  host.update(false);
  assert.equal(disposals, 1);
  host.update(true);
  await tick();
  assert.equal(installs, 2);
  host.dispose();
  host.update(true);
  assert.equal(disposals, 2);
  assert.equal(installs, 2);
});

test("disposes a late installation and serializes rapid toggles", async () => {
  let finish!: (cleanup: () => void) => void;
  let installs = 0;
  let disposals = 0;
  const host = createCartographyLifecycle(() => {
    installs++;
    return new Promise(resolve => { finish = resolve; });
  }, error => assert.fail(String(error)));
  host.update(true);
  host.update(false);
  host.update(true);
  assert.equal(installs, 1);
  host.dispose();
  finish(() => { disposals++; });
  await tick();
  assert.equal(disposals, 1);
});

test("a failed optional installation reports failure without retrying forever", async () => {
  const failures: unknown[] = [];
  const host = createCartographyLifecycle(async () => { throw new Error("unavailable"); }, error => failures.push(error));
  host.update(true);
  await tick();
  assert.equal(failures.length, 1);
  host.dispose();
});


test("failed Maps constructors release earlier native surfaces and detached painters", async (t) => {
  const {installCartographySpike} = await import("../../src/renderer/cartography-spike/index.js");
  const {CARTOGRAPHY_CONTEXT_GLOBALS, CARTOGRAPHY_CONTEXT_SCALARS,
    EXPLORATION_SPIKE_GLOBALS, EXPLORATION_SPIKE_SCALARS,
    WORLD_MAP_ANCHOR_SPIKE_GLOBALS, WORLD_MAP_ANCHOR_SPIKE_SCALARS} = await import("../../src/shared/cartography-spike.js");
  t.mock.method(console, "error", () => {});
  for (const failAt of ["native", "overlay"]) {
    const view = new EventTarget();
    const add = t.mock.method(view, "addEventListener");
    const remove = t.mock.method(view, "removeEventListener");
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {configurable: true, value: view});
    try {
      const canvases: {width: number; height: number}[] = [];
      let hides = 0;
      const exports = Object.fromEntries([
        ...CARTOGRAPHY_CONTEXT_SCALARS, ...EXPLORATION_SPIKE_SCALARS, ...WORLD_MAP_ANCHOR_SPIKE_SCALARS,
      ].map(name => [name, new WebAssembly.Global({value: "i32"})]));
      Object.assign(exports, {
        [CARTOGRAPHY_CONTEXT_GLOBALS.observe]: () => {},
        [EXPLORATION_SPIKE_GLOBALS.observe]: () => {},
        [EXPLORATION_SPIKE_GLOBALS.readWord]: () => 0,
        [WORLD_MAP_ANCHOR_SPIKE_GLOBALS.observe]: () => {},
        gwonmac_compass_ranges_hide: () => { hides++; },
        gwonmac_mission_graphics_publish: () => 0,
        gwonmac_mission_graphics_hide: () => {},
        gwonmac_mission_graphics_serial: new WebAssembly.Global({value: "i32"}),
      });
      const document = {defaultView: view, createElement(tag: string) {
        if (tag !== "canvas" || failAt === "native" && canvases.length === 1) throw new Error("canvas allocation failed");
        const canvas = {width: 128, height: 128, getContext: () => ({})};
        canvases.push(canvas); return canvas;
      }};
      // Deliberately incomplete DOM peer: construction fails before any game observation.
      await assert.rejects(installCartographySpike({exports,
        parent: {ownerDocument: document} as unknown as HTMLElement, canvas: {} as HTMLCanvasElement,
        settings: () => { throw new Error("must not read settings"); },
        persist: async () => { throw new Error("must not save"); },
        exportEvidence: async () => { throw new Error("must not export"); },
        getMapKnowledge: async () => [], recordMapKnowledge: async () => [],
      }), /canvas allocation failed/);
      assert.equal(hides, 1, "an earlier native range owner is released on either failure");
      assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
      assert.equal(add.mock.callCount(), remove.mock.callCount(), "no graphics-reset listener survives refusal");
      assert.equal(window.gwExplorationSpike, undefined);
      assert.equal(window.gwWorldMapAnchorSpike, undefined);
    } finally {
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  }
});
