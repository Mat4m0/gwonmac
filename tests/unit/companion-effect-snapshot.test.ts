import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPANION_ABI } from "../../src/shared/companion-abi.js";
import {
  formatEffectTimer,
  readCompanionEffectIcons,
  readCompanionPlayerEffects,
  remainingEffectMs,
} from "../../src/renderer/companion-effect-snapshot.js";
import { projectEffectTimerLabels } from "../../src/renderer/effect-timer-overlay-consumer.js";

type EffectRecord = Readonly<{
  effectId: number;
  skillId: number;
  attributeLevel: number;
  maintainerAgentId: number;
  durationMs: number;
  appliedAtGameMs: number;
}>;

function effectSnapshot(
  records: readonly EffectRecord[],
  options: Readonly<{
    flags?: number;
    sequence?: number;
    playerAgentId?: number;
  }> = {},
) {
  const buffer = new ArrayBuffer(COMPANION_ABI.playerEffects.bytes);
  const view = new DataView(buffer);
  view.setUint32(0, 0x4645_5747, true);
  view.setUint16(4, COMPANION_ABI.playerEffects.abi, true);
  view.setUint16(6, COMPANION_ABI.playerEffects.bytes, true);
  view.setUint32(8, options.sequence ?? 2, true);
  view.setUint32(12, options.flags ?? 1, true);
  view.setUint32(16, 4, true);
  view.setUint32(20, 12_000, true);
  view.setUint32(24, records.length, true);
  view.setUint32(28, options.playerAgentId ?? 7, true);
  records.forEach((record, index) => {
    const at = 36 + index * 24;
    view.setUint32(at, record.effectId, true);
    view.setUint32(at + 4, record.skillId, true);
    view.setUint32(at + 8, record.attributeLevel, true);
    view.setUint32(at + 12, record.maintainerAgentId, true);
    view.setUint32(at + 16, record.durationMs, true);
    view.setUint32(at + 20, record.appliedAtGameMs, true);
  });
  return buffer;
}

const FINITE = Object.freeze({
  effectId: 9,
  skillId: 123,
  attributeLevel: 12,
  maintainerAgentId: 7,
  durationMs: 10_000,
  appliedAtGameMs: 5_000,
});

describe("controlled-player effect snapshots", () => {
  it("preserves finite, indefinite, and duplicate instances", () => {
    const state = readCompanionPlayerEffects(effectSnapshot([
      FINITE,
      { ...FINITE, effectId: 10, durationMs: 0 },
    ]), 0);
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.deepEqual(state.effects.map(({ effectId, skillId, durationMs }) =>
      ({ effectId, skillId, durationMs })), [
      { effectId: 9, skillId: 123, durationMs: 10_000 },
      { effectId: 10, skillId: 123, durationMs: 0 },
    ]);
  });

  it("refuses torn, loading, malformed, and overflowed snapshots", () => {
    assert.deepEqual(
      readCompanionPlayerEffects(effectSnapshot([], { sequence: 3 }), 0),
      { status: "waiting", reason: "writing" },
    );
    assert.deepEqual(readCompanionPlayerEffects(effectSnapshot([], {
      flags: 2,
      playerAgentId: 0,
    }), 0), { status: "waiting", reason: "loading" });
    assert.deepEqual(readCompanionPlayerEffects(effectSnapshot([
      { ...FINITE, effectId: 0 },
    ]), 0), { status: "waiting", reason: "corrupt" });
    const overflow = effectSnapshot([]);
    new DataView(overflow).setUint32(24, 65, true);
    assert.deepEqual(
      readCompanionPlayerEffects(overflow, 0),
      { status: "waiting", reason: "corrupt" },
    );
  });

  it("uses unsigned timer deltas across wrap and formats upward", () => {
    assert.equal(remainingEffectMs(200, 0xffff_ff00, 1_000), 544);
    assert.equal(remainingEffectMs(8_000, 5_000, 3_000), 0);
    assert.equal(remainingEffectMs(8_000, 5_000, 0), null);
    assert.equal(formatEffectTimer(99_001), "2m");
    assert.equal(formatEffectTimer(99_000), "99");
    assert.equal(formatEffectTimer(3_001), "4");
    assert.equal(formatEffectTimer(3_000), "3");
    assert.equal(formatEffectTimer(2_999), "3.0");
    assert.equal(formatEffectTimer(2_001), "2.1");
    assert.equal(formatEffectTimer(1), "0.1");
  });
});

function iconSnapshot() {
  const buffer = new ArrayBuffer(COMPANION_ABI.effectIcons.bytes);
  const view = new DataView(buffer);
  view.setUint32(0, 0x4945_5747, true);
  view.setUint16(4, COMPANION_ABI.effectIcons.abi, true);
  view.setUint16(6, COMPANION_ABI.effectIcons.bytes, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 3, true);
  view.setUint32(20, 27, true);
  view.setUint32(24, 1, true);
  view.setFloat32(36, 800, true);
  view.setFloat32(40, 600, true);
  view.setUint32(44, 123, true);
  view.setFloat32(48, 100, true);
  view.setFloat32(52, -12, true);
  view.setFloat32(56, 148, true);
  view.setFloat32(60, 36, true);
  return buffer;
}

describe("native effect icon geometry", () => {
  it("accepts a visible rectangle clipped by the viewport edge", () => {
    const state = readCompanionEffectIcons(iconSnapshot(), 0);
    assert.equal(state.status, "ready");
    if (state.status !== "ready") return;
    assert.deepEqual(state.icons[0], {
      skillId: 123,
      left: 100,
      bottom: -12,
      right: 148,
      top: 36,
    });
  });

  it("projects the longest finite duplicate without a stack count", () => {
    const geometry = readCompanionEffectIcons(iconSnapshot(), 0);
    const effects = readCompanionPlayerEffects(effectSnapshot([
      { ...FINITE, durationMs: 10_000, appliedAtGameMs: 5_000 },
      { ...FINITE, effectId: 10, durationMs: 20_000, appliedAtGameMs: 5_000 },
      { ...FINITE, effectId: 11, durationMs: 0 },
    ]), 0);
    const canvas = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 1_600, height: 1_200 }),
    } as HTMLCanvasElement;
    const labels = projectEffectTimerLabels(effects, geometry, canvas);
    assert.deepEqual(labels, [{
      skillId: 123,
      x: 210,
      y: 1_148,
      width: 96,
      height: 96,
      text: "13",
      urgency: "normal",
    }]);
  });

  it("hides hour-long placeholders by original duration, preserving ordinary timers", () => {
    const geometry = readCompanionEffectIcons(iconSnapshot(), 0);
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLCanvasElement;
    for (const durationMs of [3_600_000, 10_000_000]) {
      const effects = readCompanionPlayerEffects(effectSnapshot([
        { ...FINITE, durationMs, appliedAtGameMs: 0 },
      ]), 0);
      assert.deepEqual(projectEffectTimerLabels(effects, geometry, canvas), []);
    }
    for (const durationMs of [62_000, 3_599_999]) {
      const effects = readCompanionPlayerEffects(effectSnapshot([
        { ...FINITE, durationMs, appliedAtGameMs: 5_000 },
        { ...FINITE, effectId: 10, durationMs: 10_000_000 },
      ]), 0);
      assert.equal(projectEffectTimerLabels(effects, geometry, canvas)?.length, 1);
    }
  });

  it("withdraws labels for indefinite-only and unavailable inputs", () => {
    const geometry = readCompanionEffectIcons(iconSnapshot(), 0);
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLCanvasElement;
    const indefinite = readCompanionPlayerEffects(effectSnapshot([
      { ...FINITE, durationMs: 0 },
    ]), 0);
    assert.deepEqual(projectEffectTimerLabels(indefinite, geometry, canvas), []);
    assert.equal(projectEffectTimerLabels(
      { status: "waiting", reason: "stale" },
      geometry,
      canvas,
    ), null);
  });

  it("rejects non-ready geometry that retains published frame state", () => {
    const buffer = iconSnapshot();
    const view = new DataView(buffer);
    view.setUint32(12, 0, true);
    view.setUint32(28, 4, true);
    assert.deepEqual(readCompanionEffectIcons(buffer, 0), {
      status: "waiting",
      reason: "corrupt",
    });
  });
});
