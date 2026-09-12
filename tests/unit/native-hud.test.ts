/** Verifies native HUD joins, atlas reuse and lifecycle without mounting browser overlays. */
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeHudLayer, type NativeHudChannel, type NativeHudItem, type NativeHudLayer } from "../../src/renderer/native-hud-layer.js";
import { createSkillKeyOverlayConsumer } from "../../src/renderer/skill-key-overlay-consumer.js";
import { createSkillCooldownOverlayConsumer } from "../../src/renderer/skill-cooldown-overlay-consumer.js";
import { createEffectTimerOverlayConsumer } from "../../src/renderer/effect-timer-overlay-consumer.js";
import { EMPTY_SKILL_KEY_MODIFIERS } from "../../src/shared/skill-key-bindings.js";
import { skillKeyPlateLayout } from "../../src/renderer/skill-key-artwork.js";
import { NATIVE_HUD_MAGIC, NATIVE_HUD_HEADER as HEADER, NATIVE_HUD_KEYCAP } from "../../src/shared/native-hud.js";

const geometry = {status: "ready" as const, sequence: 2, frameId: 43, viewportWidth: 800, viewportHeight: 600,
  slots: Array.from({length: 8}, (_, n) => ({left: 100 + n * 50, bottom: 20, right: 148 + n * 50, top: 68}))};
function peer() {
  const view = new EventTarget();
  const document = {defaultView: view};
  const parent = {ownerDocument: document} as unknown as HTMLElement;
  const canvas = {getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600})} as HTMLCanvasElement;
  const output = new Map<NativeHudChannel, readonly (NativeHudItem | null)[]>();
  const hud: NativeHudLayer = {update: (channel, items) => { output.set(channel, items); }, dispose() {}};
  return {view, parent, canvas, output, hud};
}
test("skill consumers preserve slot identity, formatting, color and independent enablement", () => {
  const {parent, canvas, output, hud} = peer();
  const keys = createSkillKeyOverlayConsumer(parent, canvas, hud);
  const cooldowns = createSkillCooldownOverlayConsumer(parent, canvas, hud);
  keys.update(geometry); cooldowns.update(geometry);
  keys.setBindings([null, null, null, null, null, null, null, {input: {kind: "keyboard", code: "KeyX"}, modifiers: {...EMPTY_SKILL_KEY_MODIFIERS, command: true, shift: true}}]);
  keys.setEnabled(true);
  assert.equal(output.get("keys")?.[7]?.child, 7);
  assert.equal(output.get("keys")?.[7]?.parent, 43);
  assert.deepEqual(output.get("keys")?.map(item => item?.binding?.input), Array.from({length: 8}, (_, n) => ({kind: "keyboard", code: n === 7 ? "KeyX" : `Digit${n + 1}`})));
  assert.equal(output.get("keys")?.[7]?.binding?.modifiers.command, true);
  assert.equal(output.get("keys")?.[7]?.binding?.modifiers.shift, true);
  assert.equal(output.get("keys")?.filter(Boolean).length, 8);
  cooldowns.sync({kind: "custom", value: "#abcdef"}, true);
  const state = {status: "ready" as const, sequence: 2, generation: 1, gameTimer: 10000, playerAgentId: 7,
    rechargeTimestamps: [12899, 24001, 0, 0, 0, 0, 0, 10400]};
  cooldowns.setCooldownState(state);
  assert.deepEqual(output.get("cooldowns")?.map((item) => item?.text ?? ""), ["2.9", "15", "", "", "", "", "", "0.4"]);
  assert.equal(output.get("cooldowns")?.[0]?.color, "#abcdef");
  const before = output.get("cooldowns"); cooldowns.setCooldownState({...state, sequence: 4, gameTimer: 10000});
  assert.equal(output.get("cooldowns"), before, "unobservable timer changes do not publish labels");
  cooldowns.update({status: "waiting", reason: "memory"}); assert.deepEqual(output.get("cooldowns"), []);
  assert.ok(output.get("keys")?.[7]);
  keys.dispose(); cooldowns.dispose(); assert.deepEqual(output.get("keys"), []);
});
test("effect consumers keep only finite player durations and withdraw on stale geometry", () => {
  const {parent, canvas, output, hud} = peer();
  const consumer = createEffectTimerOverlayConsumer(parent, canvas, hud);
  consumer.setEnabled(true);
  consumer.setGeometry({status: "ready", sequence: 2, generation: 1, frameId: 55, viewportWidth: 800, viewportHeight: 600,
    anchor: {left: 100, bottom: 100, right: 132, top: 132},
    icons: [{skillId: 10, left: 100, bottom: 100, right: 132, top: 132}]});
  consumer.setEffects({status: "ready", sequence: 2, generation: 1, gameTimer: 1000, playerAgentId: 7,
    effects: [{effectId: 1, skillId: 10, attributeLevel: 1, maintainerAgentId: 7, durationMs: 2400, appliedAtGameMs: 0}]});
  assert.equal(output.get("effects")?.[0]?.child, 14); assert.equal(output.get("effects")?.[0]?.text, "1.4");
  assert.equal(output.get("effects")?.[0]?.color, "#c86c65");
  consumer.setGeometry({status: "waiting", reason: "memory"}); assert.deepEqual(output.get("effects"), []);
  consumer.dispose();
});

test("all HUDs share cached artwork; countdowns, urgency and resize upload only glyph quads", async () => {
  const context = {save() {}, restore() {}, translate() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, roundRect() {}, fill() {}, stroke() {}, fillRect() {}, strokeText() {}, fillText() {},
    createLinearGradient: () => ({addColorStop() {}}), measureText: (text: string) => ({width: text === "1" ? 12 : text === "7" ? 22 : text.length * 28,
      actualBoundingBoxLeft: text === "7" ? -3 : -1,
      actualBoundingBoxRight: text === "1" ? 10 : text === "7" ? 18 : text.length * 26,
      actualBoundingBoxAscent: text === "1" ? 31 : 33, actualBoundingBoxDescent: 0}),
    getImageData: () => ({data: new Uint8ClampedArray(1024 * 1024 * 4)})};
  const canvas = {width: 0, height: 0, getContext: () => context};
  const view = new EventTarget();
  const document = {defaultView: view, createElement(tag: string) { assert.equal(tag, "canvas"); return canvas; }} as unknown as Document;
  const memory = new WebAssembly.Memory({initial: 80});
  let uploads = 0, publications = 0, resets = 0, allocated = 0, freed = 0;
  const labels = new Map<number, number>();
  const positions = new Map<number, number[]>();
  const layer = createNativeHudLayer({memory,
    malloc: () => { allocated++; return 1024; }, free: () => { freed++; },
    gwonmac_hud_reset: () => { resets++; },
    gwonmac_hud_atlas: () => { uploads++; return 1; },
    gwonmac_hud_label: (region: number, bytes: number) => {
      const v = new DataView(memory.buffer, region, bytes);
      assert.equal(v.getUint32(0, true), NATIVE_HUD_MAGIC); assert.equal(v.getUint32(4, true), bytes);
      const count = v.getUint32(20, true); labels.set(v.getUint32(8, true), count);
      const flags = v.getUint32(24, true);
      if (count > (flags ? 1 : 0)) positions.set(v.getUint32(8, true), [0, 4, 8, 12].map(at => v.getFloat32(HEADER + (flags ? 32 : 0) + at, true)));
      for (let at = HEADER; at < bytes; at += 4) { const value = v.getFloat32(at, true); assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${at}: ${value}`); }
      if (flags === NATIVE_HUD_KEYCAP && count >= 1) {
        assert.ok(Math.abs(v.getFloat32(HEADER, true) + v.getFloat32(HEADER + 8, true) - 55 / 56) < 1e-6, "key plate hugs the right corner");
        assert.ok(Math.abs(v.getFloat32(HEADER + 4, true) + v.getFloat32(HEADER + 12, true) - 55 / 56) < 1e-6, "key plate hugs the bottom corner");
      }
      publications++; return 1;
    },
  }, document);
  const item = {parent: 43, child: 0, width: 64, height: 64, text: "15", color: "#abcdef"};
  layer.update("cooldowns", [item]);
  layer.update("keys", [{...item, binding: {input: {kind: "keyboard", code: "Digit1"}, modifiers: EMPTY_SKILL_KEY_MODIFIERS}}]);
  layer.update("effects", [{...item, parent: 55, child: 14, text: "5.1", color: "#eadcc2"}]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(uploads, 1); assert.equal(labels.get(0), 3, "one combined keycap and two-digit timer publication"); assert.equal(labels.get(8), 3);
  for (const size of [24, 32, 48, 64, 96]) {
    layer.update("effects", [{...item, parent: 55, child: 14, width: size, height: size, text: "11", color: "#eadcc2"}]);
    const [, top, , height] = positions.get(8)!;
    assert.ok(top! >= 0 && top! + height! <= .840001, "effect number stays inside artwork above the duration strip at every scale");
  }
  const before = publications;
  layer.update("cooldowns", [item]); assert.equal(publications, before);
  layer.update("cooldowns", [{...item, text: "2.9"}]);
  layer.update("effects", [{...item, parent: 55, child: 14, text: "1.9", color: "#c86c65"}]);
  layer.update("cooldowns", [{...item, text: "2.8", width: 128, height: 128}]);
  assert.equal(uploads, 1);
  layer.update("effects", []); assert.equal(labels.get(8), 0);
  layer.update("effects", [{...item, parent: 55, child: 14, text: "4.2", color: "#e5ad52"}]);
  assert.equal(uploads, 1, "urgency sprites remain cached after expiry");
  const digitPositions: number[][] = [];
  for (const text of ["1", "7", "8", "6", "9"]) {
    layer.update("cooldowns", [{...item, text}]);
    digitPositions.push(positions.get(0)!);
  }
  for (const position of digitPositions) assert.deepEqual(position, digitPositions[0], "proportional font digits share a fixed cell and anchor");
  assert.equal(uploads, 1, "digit changes still reuse the atlas");
  layer.update("cooldowns", []); assert.equal(labels.get(0), 1, "expiry keeps the keycap in its existing composition");
  layer.update("cooldowns", [{...item, text: "9"}]); assert.equal(labels.get(0), 2);
  layer.update("keys", []); assert.equal(labels.get(0), 1, "disabling shortcuts preserves the timer");
  layer.update("keys", [{...item, binding: {input: {kind: "keyboard", code: "Digit1"}, modifiers: EMPTY_SKILL_KEY_MODIFIERS}}]);
  assert.equal(labels.get(0), 2);
  layer.update("cooldowns", [{...item, parent: 99, text: "8"}]);
  assert.equal(labels.get(0), 1, "different icon generations must not be merged");
  view.dispatchEvent(new Event("gw:graphics-context-reset")); assert.equal(uploads, 2);
  layer.dispose(); layer.dispose(); assert.equal(resets, 2); assert.equal(allocated, freed); assert.equal(canvas.width, 0);
  layer.update("keys", []); assert.equal(allocated, freed);
});


test("keycaps retain stock proportions and corner position at every interface scale", () => {
  for (const icon of [28, 35, 48, 56, 64, 84, 112, 168]) {
    for (const artwork of [62, 138, 240]) {
      const layout = skillKeyPlateLayout(icon, icon, artwork);
      assert.equal(layout.inset / icon, 1 / 56);
      assert.ok(Math.abs(layout.width / layout.height - artwork / 64) < 1e-9);
      assert.ok(layout.width + 2 * layout.inset <= icon + 1e-9);
      if (artwork <= 138) assert.ok(Math.abs(layout.height / icon - 17 / 56) < 1e-9);
    }
  }
});


for (const addressBase of [0, 0x80000000]) test(`inactive HUDs allocate nothing and atlas repacks withdraw removed native labels at ${addressBase}`, async () => {
  let canvases = 0, uploads = 0, frees = 0, allocations = 0;
  const memory = new WebAssembly.Memory({initial: addressBase / 65536 + 80});
  const records = new Map<number, number>();
  const context = {save() {}, restore() {}, translate() {}, clearRect() {}, strokeText() {}, fillText() {},
    measureText: () => ({width: 28}), getImageData: () => ({data: new Uint8ClampedArray(1024 * 1024 * 4)})};
  const document = {defaultView: new EventTarget(), createElement() {
    canvases++; return {width: 0, height: 0, getContext: () => context};
  }} as unknown as Document;
  const layer = createNativeHudLayer({memory,
    malloc() { allocations++; return (addressBase + 1024) | 0; },
    free(region: number) { assert.equal(region, addressBase + 1024); frees++; },
    gwonmac_hud_atlas() { uploads++; return 1; },
    gwonmac_hud_reset() { records.clear(); },
    gwonmac_hud_label(region: number) {
      const view = new DataView(memory.buffer, region);
      records.set(view.getUint32(8, true), view.getUint32(20, true)); return 1;
    },
  }, document);
  await Promise.resolve(); await Promise.resolve();
  layer.update("keys", []); layer.update("cooldowns", []); layer.update("effects", []);
  assert.deepEqual({canvases, uploads, allocations}, {canvases: 0, uploads: 0, allocations: 0});
  const item = {parent: 43, child: 0, width: 56, height: 56, text: "15", color: "#abcdef"};
  layer.update("cooldowns", [item, {...item, child: 1, text: "9"}]);
  assert.equal(records.get(1), 1);
  // A new color repacks the atlas in the same update that slot 1 expires.
  layer.update("cooldowns", [{...item, color: "#123456"}, null]);
  assert.equal(uploads, 2);
  assert.equal(records.get(1), 0, "repacking must not forget a previously published slot");
  layer.update("cooldowns", []);
  layer.update("cooldowns", [{...item, color: "#123456"}]);
  assert.equal(uploads, 2, "a short idle gap retains the existing atlas");
  assert.equal(canvases, 1);
  layer.dispose();
  assert.equal(allocations, frees);
});


test("a failed native reset still releases HUD listeners and diagnostic ownership", () => {
  const view = new EventTarget() as EventTarget & {gwNativeHudStats?: unknown};
  const document = {defaultView: view} as unknown as Document;
  let resets = 0;
  const layer = createNativeHudLayer({gwonmac_hud_reset() {
    resets++; throw new Error("graphics context unavailable");
  }}, document);
  assert.equal(typeof view.gwNativeHudStats, "function");
  assert.throws(() => layer.dispose(), /graphics context unavailable/);
  assert.equal(view.gwNativeHudStats, undefined);
  layer.dispose();
  view.dispatchEvent(new Event("gw:graphics-context-reset"));
  assert.equal(resets, 1);
});
