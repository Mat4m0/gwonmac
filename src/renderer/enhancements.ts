import type { EnhancementSelection } from "../shared/contracts.js";
import { createCursorConsumer } from "./enhancement-cursor.js";
import { createTargetReadout } from "./enhancement-readout.js";
import {
  readCompanionSnapshot,
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  COMPANION_SNAPSHOT_ABI,
  COMPANION_SNAPSHOT_BYTES,
} from "./companion-snapshot.js";

const ENHANCEMENT_FEATURE_NATIVE_CURSOR = 1 << 0;
const ENHANCEMENT_FEATURE_TARGET_READOUT = 1 << 1;

/**
 * The five values the installer needs out of the kernel's manifest section.
 * The section is JSON the decoder does not control, so it is read as unknown
 * fields and named a manifest only once every one of them has been checked.
 */
type EnhancementManifest = Readonly<{
  buildId: number;
  programId: number;
  tableSlot: number;
  layoutWords: readonly number[];
  configBytes: number;
}>;

function decodeManifest(module: WebAssembly.Module): EnhancementManifest | null {
  const sections = WebAssembly.Module.customSections(module, "enhancement_manifest");
  if (sections.length !== 1) return null;
  try {
    const value: Record<string, unknown> | null = JSON.parse(
      new TextDecoder().decode(sections[0]),
    );
    if (value === null) return null;
    const { buildId, programId, tableSlot, layoutWords, configBytes } = value;
    if (
      value.snapshotAbi !== COMPANION_SNAPSHOT_ABI
      || value.snapshotBytes !== COMPANION_SNAPSHOT_BYTES
      || value.cursorSnapshotAbi !== COMPANION_CURSOR_ABI
      || value.cursorSnapshotBytes !== COMPANION_CURSOR_BYTES
      || !Number.isSafeInteger(buildId)
      || Number(buildId) <= 0
      || !Number.isSafeInteger(programId)
      || Number(programId) <= 0
      || !Number.isSafeInteger(tableSlot)
      || Number(tableSlot) < 0
      || !Array.isArray(layoutWords)
      || layoutWords.length === 0
      || layoutWords.some(
        (word: unknown) =>
          !Number.isInteger(word)
          || Number(word) < 0
          || Number(word) > 0xffff_ffff,
      )
      || configBytes !== layoutWords.length * Uint32Array.BYTES_PER_ELEMENT
    ) {
      return null;
    }
    return Object.freeze({
      buildId: Number(buildId),
      programId: Number(programId),
      tableSlot: Number(tableSlot),
      layoutWords: layoutWords.map(Number),
      configBytes: Number(configBytes),
    });
  } catch {
    return null;
  }
}

function recordLifecycle(state: CompanionState) {
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

/** The per-frame counters and gauges the observer keeps on the runtime. */
type SnapshotObserverTarget = {
  memory: WebAssembly.Memory;
  snapshotPointer: number;
  snapshotReads: number;
  rejectedSnapshots: number;
  hertz: number;
  lastRenderUs: number;
  renderSamples: number[];
};

function observeSnapshots(
  runtime: SnapshotObserverTarget,
  cursor: ReturnType<typeof createCursorConsumer> | null,
  readout: ReturnType<typeof createTargetReadout> | null,
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
      recordLifecycle(state);
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
    // Outside the measured window: lastRenderUs stays the snapshot read cost.
    cursor?.poll();
    frame = requestAnimationFrame(observe);
  };
  frame = requestAnimationFrame(observe);
  return () => cancelAnimationFrame(frame);
}

export async function installEnhancements(
  instance: WebAssembly.Instance,
  module: WebAssembly.Module,
  selection: EnhancementSelection,
  automation = false,
) {
  // Automation may force the core observation snapshot for live development
  // scenarios. It does not turn on either player-facing surface, and packaged
  // builds cannot set it. The two shipped tools remain independently selected.
  const observeState = selection.targetReadout || automation;
  const featureFlags =
    (selection.nativeCursor ? ENHANCEMENT_FEATURE_NATIVE_CURSOR : 0)
    | (observeState ? ENHANCEMENT_FEATURE_TARGET_READOUT : 0);
  if (featureFlags === 0) return null;

  const manifest = decodeManifest(module);
  const exports = instance?.exports;
  if (
    !manifest
    || !(exports?.memory instanceof WebAssembly.Memory)
    || !(exports?.__indirect_function_table instanceof WebAssembly.Table)
    || typeof exports?.malloc !== "function"
    || typeof exports?.free !== "function"
    || typeof exports?.enhancement_tick_original !== "function"
    || !(exports?.enhancement_hook_slot instanceof WebAssembly.Global)
  ) {
    window.gwCompanionState = Object.freeze({ status: "unsupported" });
    recordLifecycle(window.gwCompanionState);
    return null;
  }

  const table = exports.__indirect_function_table;
  const hookSlot = exports.enhancement_hook_slot;
  // The guard above proves `free` is callable, but WebAssembly exports are typed
  // as the bare `Function`, so the kernel's ABI has to be named here or the five
  // call sites below stop checking what they pass.
  const free = exports.free as (pointer: number) => void;
  if (table.get(manifest.tableSlot) !== null) {
    throw new Error(`Enhancement table slot ${manifest.tableSlot} is occupied`);
  }

  let snapshotPointer = 0;
  let configPointer = 0;
  let cursorPointer = 0;
  let stopObserver = () => {};
  let disposeCursor = () => {};
  let disposeReadout = () => {};
  try {
    if (observeState) {
      snapshotPointer = Number(exports.malloc(COMPANION_SNAPSHOT_BYTES));
    }
    configPointer = Number(exports.malloc(manifest.configBytes));
    if (selection.nativeCursor) {
      cursorPointer = Number(exports.malloc(COMPANION_CURSOR_BYTES));
    }
    if (
      !configPointer
      || (observeState && !snapshotPointer)
      || (selection.nativeCursor && !cursorPointer)
    ) {
      throw new Error("Companion allocation failed");
    }
    new Uint32Array(
      exports.memory.buffer,
      configPointer,
      manifest.layoutWords.length,
    ).set(manifest.layoutWords);

    const response = await fetch("companion-kernel.wasm");
    if (!response.ok) throw new Error("Companion kernel is unavailable");
    const kernel = await WebAssembly.instantiate(await response.arrayBuffer(), {
      env: { memory: exports.memory },
      game: { enhancement_tick_original: exports.enhancement_tick_original },
    });
    const kernelInit = kernel.instance.exports.companion_init;
    if (
      typeof kernelInit !== "function"
      || kernelInit.length !== 7
      || typeof kernel.instance.exports.companion_tick !== "function"
      || kernelInit(
        snapshotPointer,
        observeState ? COMPANION_SNAPSHOT_BYTES : 0,
        configPointer,
        manifest.configBytes,
        cursorPointer,
        selection.nativeCursor ? COMPANION_CURSOR_BYTES : 0,
        featureFlags,
      ) !== 1
    ) {
      throw new Error("Companion kernel rejected its ABI");
    }

    let cursor: ReturnType<typeof createCursorConsumer> | null = null;
    if (selection.nativeCursor) {
      const element = document.getElementById("canvas");
      if (!element) throw new Error("Enhancement cursor target is missing");
      cursor = createCursorConsumer({
        element,
        memory: exports.memory,
        cursorPointer,
        // The empty string hands the canvas back to the stylesheet theme.
        fallback: "",
      });
      disposeCursor = cursor.dispose;
    }
    const readout = selection.targetReadout
      ? createTargetReadout(document.body)
      : null;
    if (readout) disposeReadout = readout.dispose;

    table.set(manifest.tableSlot, kernel.instance.exports.companion_tick);
    const runtime = {
      status: "installed",
      buildId: manifest.buildId,
      programId: manifest.programId,
      memory: exports.memory,
      snapshotPointer,
      configPointer,
      tableSlot: manifest.tableSlot,
      hertz: 0,
      lastRenderUs: 0,
      renderSamples: [],
      snapshotReads: 0,
      rejectedSnapshots: 0,
      // Presentation state only: no pixels and no pointer leave this module.
      get cursor() {
        return cursor?.state ?? null;
      },
      // The rendered line, so a live run can read the feature without a
      // screenshot. Text only: the readout owns its own element.
      get readout() {
        return readout?.state ?? null;
      },
      installation: (window.gwCompanionInstallations ?? 0) + 1,
      setHookEnabledForBenchmark(enabled: boolean) {
        hookSlot.value = enabled
          ? manifest.tableSlot + 1
          : 0;
      },
    };
    window.gwCompanionInstallations = runtime.installation;
    window.gwCompanionRuntime = runtime;
    stopObserver = observeSnapshots(runtime, cursor, readout, observeState);
    hookSlot.value = manifest.tableSlot + 1;

    const teardown = () => {
      hookSlot.value = 0;
      stopObserver();
      disposeCursor();
      disposeReadout();
      if (table.get(manifest.tableSlot) === kernel.instance.exports.companion_tick) {
        table.set(manifest.tableSlot, null);
      }
      if (cursorPointer) free(cursorPointer);
      free(configPointer);
      if (snapshotPointer) free(snapshotPointer);
      window.gwCompanionRuntime = null;
    };
    window.addEventListener("pagehide", teardown, { once: true });
    console.info(`[enhancement] installed for client build ${manifest.buildId}`);
    return runtime;
  } catch (error) {
    hookSlot.value = 0;
    stopObserver();
    disposeCursor();
    disposeReadout();
    if (cursorPointer) free(cursorPointer);
    if (configPointer) free(configPointer);
    if (snapshotPointer) free(snapshotPointer);
    window.gwCompanionState = Object.freeze({
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
