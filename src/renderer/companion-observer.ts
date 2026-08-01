/**
 * The per-frame read of the companion kernel's shared memory, and the only
 * place that decides how often it happens.
 *
 * One direction only: the kernel writes, this reads, and nothing here writes
 * back into the module. A snapshot that fails its own validity check is counted
 * and skipped rather than partly believed, so a torn or stale write costs one
 * frame of readout and never a wrong number on screen.
 *
 * The consumers — cursor, readout, toolbox — are passed in and any of them may
 * be absent, because which ones exist was decided when the module was derived
 * and is not something to rediscover per frame.
 */
import {
  type CompanionToolboxState,
  readChangedCompanionToolbox,
  readCompanionSnapshot,
  sameCompanionToolboxState,
} from "./companion-snapshot.js";

type SnapshotObserverTarget = {
  memory: WebAssembly.Memory;
  snapshotPointer: number;
  toolboxPointer: number;
  snapshotReads: number;
  rejectedSnapshots: number;
  hertz: number;
  lastRenderUs: number;
  renderSamples: number[];
};

type StateConsumer = {
  update(state: CompanionState): void;
};

type ToolboxConsumer = {
  update(state: CompanionToolboxState): void;
};

export function recordCompanionLifecycle(state: CompanionState) {
  if (state.status === "ready") {
    window.gwAutomation?.set(
      state.instanceType === 1 ? "game.explorable" : "game.outpost",
    );
  } else if (state.reason === "loading") {
    window.gwAutomation?.set("game.loading");
  } else if (state.status === "unsupported") {
    window.gwAutomation?.set("enhancement.unsupported");
  }
}

export function observeCompanion(
  runtime: SnapshotObserverTarget,
  cursor: { poll(): void } | null,
  readout: StateConsumer | null,
  toolbox: ToolboxConsumer | null,
  observeState: boolean,
  publishState: boolean,
) {
  let frame = 0;
  let cadenceAt = performance.now();
  let cadenceTick = 0;
  let previousToolbox: CompanionToolboxState | null = null;
  let toolboxSequence: number | null = null;
  let publishedState: CompanionState | null = null;
  const observe = () => {
    if (observeState) {
      const started = performance.now();
      const state = readCompanionSnapshot(
        runtime.memory.buffer,
        runtime.snapshotPointer,
      );
      recordCompanionLifecycle(state);
      runtime.snapshotReads += 1;
      if (
        ("reason" in state && state.reason === "writing")
        || ("reason" in state && state.reason === "snapshot")
      ) {
        runtime.rejectedSnapshots += 1;
      }
      if (publishState) {
        publishedState = state;
        window.gwCompanionState = state;
      }
      const now = performance.now();
      if (state.status === "ready" && now - cadenceAt >= 1_000) {
        runtime.hertz =
          ((state.tickCount - cadenceTick) * 1_000) / (now - cadenceAt);
        cadenceAt = now;
        cadenceTick = state.tickCount;
      }
      runtime.lastRenderUs = (performance.now() - started) * 1_000;
      runtime.renderSamples.push(runtime.lastRenderUs);
      if (runtime.renderSamples.length > 240) runtime.renderSamples.shift();
      readout?.update(state);
    }
    if (toolbox) {
      const change = readChangedCompanionToolbox(
        runtime.memory.buffer,
        runtime.toolboxPointer,
        toolboxSequence,
      );
      if (change.changed) {
        toolboxSequence = change.sequence;
        if (!sameCompanionToolboxState(previousToolbox, change.state)) {
          previousToolbox = change.state;
          toolbox.update(change.state);
        }
      }
    }
    // Outside the measured window: lastRenderUs stays the snapshot read cost.
    cursor?.poll();
    frame = requestAnimationFrame(observe);
  };
  frame = requestAnimationFrame(observe);
  return () => {
    cancelAnimationFrame(frame);
    if (publishedState !== null && window.gwCompanionState === publishedState) {
      delete window.gwCompanionState;
    }
  };
}
