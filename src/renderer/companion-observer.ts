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
  type CompanionPartyState,
  type CompanionSnapshot,
  type CompanionToolboxState,
  type PublishedCompanionState,
  readChangedCompanionParty,
  readChangedCompanionToolbox,
  readCompanionSnapshot,
  sameCompanionToolboxState,
} from "./companion-snapshot.js";

type SnapshotObserverTarget = {
  memory: WebAssembly.Memory;
  snapshotPointer: number;
  toolboxPointer: number;
  partyPointer: number;
  snapshotReads: number;
  rejectedSnapshots: number;
  hertz: number;
  lastRenderUs: number;
  renderSamples: number[];
};

type StateConsumer = {
  update(state: CompanionSnapshot): void;
};

/**
 * The two party regions arrive as one projection.
 *
 * They are separate records because one is a per-change scalar summary and the
 * other is half a kilobyte of roster, but a consumer that had to correlate two
 * feeds would eventually draw a roster from one publication beside a count
 * from another. Merging here, at the only place that reads either, means the
 * interface never sees them disagree.
 */
type ToolboxConsumer = {
  update(state: CompanionToolboxState & {
    party?: CompanionPartyState;
  }): void;
};

export function recordCompanionLifecycle(state: PublishedCompanionState) {
  if (state.status === "ready") {
    window.gwAutomation?.set(
      state.instanceType === 1 ? "game.explorable" : "game.outpost",
    );
  } else if ("reason" in state && state.reason === "loading") {
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
  let previousParty: CompanionPartyState | null = null;
  let partySequence: number | null = null;
  let publishedState: PublishedCompanionState | null = null;
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
      // Both regions are watched, because each carries facts the other does
      // not. The toolbox summary moves when a hero joins or the panel opens;
      // the roster moves when a skill on a bar changes, which is invisible in
      // every scalar the summary holds. Watching only the summary is why the
      // panel — and capture with it — kept serving the bar from before an edit.
      const change = readChangedCompanionToolbox(
        runtime.memory.buffer,
        runtime.toolboxPointer,
        toolboxSequence,
      );
      if (change.changed) toolboxSequence = change.sequence;
      const partyChange = readChangedCompanionParty(
        runtime.memory.buffer,
        runtime.partyPointer,
        partySequence,
      );
      if (partyChange.changed) partySequence = partyChange.sequence;

      const state = change.changed ? change.state : previousToolbox;
      const party = partyChange.changed ? partyChange.state : previousParty;
      // The kernel publishes the roster only when it differs, so a moved party
      // sequence *is* a change and needs no second comparison here. The toolbox
      // region has no such promise and keeps its own.
      if (
        state !== null
        && (partyChange.changed || !sameCompanionToolboxState(previousToolbox, state))
      ) {
        previousToolbox = state;
        previousParty = party;
        // Absent, rather than present and undefined: the field means "the
        // roster region was read", and a key holding nothing says the opposite.
        toolbox.update(party === null ? state : { ...state, party });
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
