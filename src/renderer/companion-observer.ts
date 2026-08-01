import {
  readCompanionSnapshot,
  readCompanionToolbox,
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

type ToolboxState = ReturnType<typeof readCompanionToolbox>;
type ToolboxConsumer = {
  update(state: ToolboxState): void;
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
) {
  let frame = 0;
  let cadenceAt = performance.now();
  let cadenceTick = 0;
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
      window.gwCompanionState = state;
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
      toolbox.update(readCompanionToolbox(
        runtime.memory.buffer,
        runtime.toolboxPointer,
      ));
    }
    // Outside the measured window: lastRenderUs stays the snapshot read cost.
    cursor?.poll();
    frame = requestAnimationFrame(observe);
  };
  frame = requestAnimationFrame(observe);
  return () => cancelAnimationFrame(frame);
}
