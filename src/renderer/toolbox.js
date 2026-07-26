import { createCursorConsumer } from "./toolbox-cursor.js";
import { createTargetReadout } from "./toolbox-readout.js";
import {
  readToolboxSnapshot,
  TOOLBOX_CURSOR_ABI,
  TOOLBOX_CURSOR_BYTES,
  TOOLBOX_SNAPSHOT_ABI,
  TOOLBOX_SNAPSHOT_BYTES,
} from "./toolbox-snapshot.js";

const TOOLBOX_FEATURE_NATIVE_CURSOR = 1 << 0;
const TOOLBOX_FEATURE_TARGET_READOUT = 1 << 1;

/** @param {WebAssembly.Module} module */
function decodeManifest(module) {
  const sections = WebAssembly.Module.customSections(module, "toolbox_manifest");
  if (sections.length !== 1) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(sections[0]));
    if (
      value?.snapshotAbi !== TOOLBOX_SNAPSHOT_ABI
      || value?.snapshotBytes !== TOOLBOX_SNAPSHOT_BYTES
      || value?.cursorSnapshotAbi !== TOOLBOX_CURSOR_ABI
      || value?.cursorSnapshotBytes !== TOOLBOX_CURSOR_BYTES
      || !Number.isSafeInteger(value?.buildId)
      || value.buildId <= 0
      || !Number.isSafeInteger(value?.programId)
      || value.programId <= 0
      || !Number.isSafeInteger(value?.tableSlot)
      || value.tableSlot < 0
      || !Array.isArray(value?.layoutWords)
      || value.layoutWords.length === 0
      || value.layoutWords.some(
        (/** @type {unknown} */ word) =>
          !Number.isInteger(word)
          || Number(word) < 0
          || Number(word) > 0xffff_ffff,
      )
      || value?.configBytes !== value.layoutWords.length * Uint32Array.BYTES_PER_ELEMENT
    ) {
      return null;
    }
    return Object.freeze(value);
  } catch {
    return null;
  }
}

/** @param {any} state */
function recordLifecycle(state) {
  if (state.status === "ready") {
    window.gwAutomation?.set(
      state.instanceType === 1 ? "game.explorable" : "game.outpost",
    );
  } else if (state.reason === "loading") {
    window.gwAutomation?.set("game.loading");
  } else if (state.status === "unsupported") {
    window.gwAutomation?.set("toolbox.unsupported");
  }
}

/**
 * @param {any} runtime
 * @param {{ poll: () => void } | null} cursor
 * @param {{ update: (state: any) => void } | null} readout
 * @param {boolean} observeState
 */
function observeSnapshots(runtime, cursor, readout, observeState) {
  let frame = 0;
  let cadenceAt = performance.now();
  let cadenceTick = 0;
  const observe = () => {
    if (observeState) {
      const started = performance.now();
      const state = readToolboxSnapshot(
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
      window.gwToolboxState = state;
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

/**
 * @param {WebAssembly.Instance} instance
 * @param {WebAssembly.Module} module
 * @param {import("../shared/contracts.js").ToolboxSelection} selection
 * @param {boolean} automation Development-only observation override.
 */
export async function installToolbox(
  instance,
  module,
  selection,
  automation = false,
) {
  // Automation may force the core observation snapshot for live development
  // scenarios. It does not turn on either player-facing surface, and packaged
  // builds cannot set it. The two shipped tools remain independently selected.
  const observeState = selection.targetReadout || automation;
  const featureFlags =
    (selection.nativeCursor ? TOOLBOX_FEATURE_NATIVE_CURSOR : 0)
    | (observeState ? TOOLBOX_FEATURE_TARGET_READOUT : 0);
  if (featureFlags === 0) return null;

  const manifest = decodeManifest(module);
  const exports = instance?.exports;
  if (
    !manifest
    || !(exports?.memory instanceof WebAssembly.Memory)
    || !(exports?.__indirect_function_table instanceof WebAssembly.Table)
    || typeof exports?.malloc !== "function"
    || typeof exports?.free !== "function"
    || typeof exports?.toolbox_tick_original !== "function"
    || !(exports?.toolbox_hook_slot instanceof WebAssembly.Global)
  ) {
    window.gwToolboxState = Object.freeze({ status: "unsupported" });
    recordLifecycle(window.gwToolboxState);
    return null;
  }

  const table = exports.__indirect_function_table;
  const hookSlot = /** @type {WebAssembly.Global} */ (
    exports.toolbox_hook_slot
  );
  const free = /** @type {(pointer: number) => void} */ (exports.free);
  if (table.get(manifest.tableSlot) !== null) {
    throw new Error(`Toolbox table slot ${manifest.tableSlot} is occupied`);
  }

  let snapshotPointer = 0;
  let configPointer = 0;
  let cursorPointer = 0;
  let stopObserver = () => {};
  let disposeCursor = () => {};
  let disposeReadout = () => {};
  try {
    if (observeState) {
      snapshotPointer = Number(exports.malloc(TOOLBOX_SNAPSHOT_BYTES));
    }
    configPointer = Number(exports.malloc(manifest.configBytes));
    if (selection.nativeCursor) {
      cursorPointer = Number(exports.malloc(TOOLBOX_CURSOR_BYTES));
    }
    if (
      !configPointer
      || (observeState && !snapshotPointer)
      || (selection.nativeCursor && !cursorPointer)
    ) {
      throw new Error("Toolbox allocation failed");
    }
    new Uint32Array(
      exports.memory.buffer,
      configPointer,
      manifest.layoutWords.length,
    ).set(manifest.layoutWords);

    const response = await fetch("toolbox-kernel.wasm");
    if (!response.ok) throw new Error("Toolbox kernel is unavailable");
    const kernel = await WebAssembly.instantiate(await response.arrayBuffer(), {
      env: { memory: exports.memory },
      game: { toolbox_tick_original: exports.toolbox_tick_original },
    });
    const kernelInit = kernel.instance.exports.toolbox_init;
    if (
      typeof kernelInit !== "function"
      || kernelInit.length !== 7
      || typeof kernel.instance.exports.toolbox_tick !== "function"
      || kernelInit(
        snapshotPointer,
        observeState ? TOOLBOX_SNAPSHOT_BYTES : 0,
        configPointer,
        manifest.configBytes,
        cursorPointer,
        selection.nativeCursor ? TOOLBOX_CURSOR_BYTES : 0,
        featureFlags,
      ) !== 1
    ) {
      throw new Error("Toolbox kernel rejected its ABI");
    }

    let cursor = null;
    if (selection.nativeCursor) {
      const element = document.getElementById("canvas");
      if (!element) throw new Error("Toolbox cursor target is missing");
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

    table.set(manifest.tableSlot, kernel.instance.exports.toolbox_tick);
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
      installation: (window.gwToolboxInstallations ?? 0) + 1,
      /** @param {boolean} enabled */
      setHookEnabledForBenchmark(enabled) {
        hookSlot.value = enabled
          ? manifest.tableSlot + 1
          : 0;
      },
    };
    window.gwToolboxInstallations = runtime.installation;
    window.gwToolboxRuntime = runtime;
    stopObserver = observeSnapshots(runtime, cursor, readout, observeState);
    hookSlot.value = manifest.tableSlot + 1;

    const teardown = () => {
      hookSlot.value = 0;
      stopObserver();
      disposeCursor();
      disposeReadout();
      if (table.get(manifest.tableSlot) === kernel.instance.exports.toolbox_tick) {
        table.set(manifest.tableSlot, null);
      }
      if (cursorPointer) free(cursorPointer);
      free(configPointer);
      if (snapshotPointer) free(snapshotPointer);
      window.gwToolboxRuntime = null;
    };
    window.addEventListener("pagehide", teardown, { once: true });
    console.info(`[toolbox] installed for client build ${manifest.buildId}`);
    return runtime;
  } catch (error) {
    hookSlot.value = 0;
    stopObserver();
    disposeCursor();
    disposeReadout();
    if (cursorPointer) free(cursorPointer);
    if (configPointer) free(configPointer);
    if (snapshotPointer) free(snapshotPointer);
    window.gwToolboxState = Object.freeze({
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
