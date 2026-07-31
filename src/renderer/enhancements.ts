import type { EnhancementSelection } from "../shared/contracts.js";
import { createCursorConsumer } from "./enhancement-cursor.js";
import { createTargetReadout } from "./enhancement-readout.js";
import { installCursorRefresh } from "./cursor-refresh.js";
import { createToolboxFoundation } from "./toolbox-foundation.js";
import {
  readCompanionSnapshot,
  readCompanionToolbox,
  COMPANION_CURSOR_BYTES,
  COMPANION_SNAPSHOT_BYTES,
  COMPANION_TOOLBOX_BYTES,
} from "./companion-snapshot.js";

const ENHANCEMENT_FEATURE_NATIVE_CURSOR = 1 << 0;
const ENHANCEMENT_FEATURE_TARGET_READOUT = 1 << 1;
const ENHANCEMENT_FEATURE_TOOLBOX_FOUNDATION = 1 << 2;
const ENHANCEMENT_TRANSFORM_ABI = 5;
const COMPANION_ABI = 2;
const CONFIG_WORDS = 39;

/**
 * The five values the installer needs out of the kernel's manifest section.
 * The section is JSON the decoder does not control, so it is read as unknown
 * fields and named a manifest only once every one of them has been checked.
 */
type EnhancementManifest = Readonly<{
  buildId: number;
  programId: number;
  tableSlot: number;
  configWords: readonly number[];
}>;

function decodeManifest(module: WebAssembly.Module): EnhancementManifest | null {
  const sections = WebAssembly.Module.customSections(module, "enhancement_manifest");
  if (sections.length !== 1) return null;
  try {
    const value: Record<string, unknown> | null = JSON.parse(
      new TextDecoder().decode(sections[0]),
    );
    if (value === null) return null;
    const { buildId, programId, tableSlot, configWords } = value;
    const hooks = value.hooks as Record<string, unknown> | null;
    const messages = value.messages as Record<string, unknown> | null;
    const tick = hooks?.tick as Record<string, unknown> | null;
    const cursor = hooks?.cursor as Record<string, unknown> | null;
    const ui = hooks?.ui as Record<string, unknown> | null;
    if (
      value.transformAbi !== ENHANCEMENT_TRANSFORM_ABI
      || !Number.isSafeInteger(buildId)
      || Number(buildId) <= 0
      || !Number.isSafeInteger(programId)
      || Number(programId) <= 0
      || !Number.isSafeInteger(tableSlot)
      || Number(tableSlot) < 0
      || !Array.isArray(configWords)
      || configWords.length !== CONFIG_WORDS
      || configWords.some(
        (word: unknown) =>
          !Number.isInteger(word)
          || Number(word) < 0
          || Number(word) > 0xffff_ffff,
      )
      || !tick
      || !cursor
      || !ui
      || JSON.stringify(tick.params) !== JSON.stringify(["i32"])
      || JSON.stringify(cursor.params)
        !== JSON.stringify(["i32", "i32", "i32", "i32", "i32"])
      || JSON.stringify(ui.params) !== JSON.stringify(["i32", "i32", "i32"])
      || !messages
      || ![messages.playerChat, messages.hideHeroPanel, messages.showHeroPanel]
        .every((message) =>
          Number.isInteger(message)
          && Number(message) > 0
          && Number(message) <= 0xffff_ffff)
      || configWords[36] !== messages.playerChat
      || configWords[37] !== messages.hideHeroPanel
      || configWords[38] !== messages.showHeroPanel
    ) {
      return null;
    }
    return Object.freeze({
      buildId: Number(buildId),
      programId: Number(programId),
      tableSlot: Number(tableSlot),
      configWords: configWords.map(Number),
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
  toolboxPointer: number;
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
  toolbox: ReturnType<typeof createToolboxFoundation> | null,
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
    if (toolbox) {
      const state = readCompanionToolbox(
        runtime.memory.buffer,
        runtime.toolboxPointer,
      );
      toolbox.update(state);
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
  const foundation = automation;
  const observeState = selection.targetReadout || foundation;
  const featureFlags =
    (selection.nativeCursor ? ENHANCEMENT_FEATURE_NATIVE_CURSOR : 0)
    | (observeState ? ENHANCEMENT_FEATURE_TARGET_READOUT : 0)
    | (foundation ? ENHANCEMENT_FEATURE_TOOLBOX_FOUNDATION : 0);
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
    || typeof exports?.enhancement_cursor_original !== "function"
    || typeof exports?.enhancement_ui_original !== "function"
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
  let toolboxPointer = 0;
  let stopObserver = () => {};
  let disposeCursor = () => {};
  let disposeReadout = () => {};
  let disposeToolbox = () => {};
  let disposeCursorRefresh = () => {};
  let installedCallback: CallableFunction | null = null;
  try {
    if (observeState) {
      snapshotPointer = Number(exports.malloc(COMPANION_SNAPSHOT_BYTES));
    }
    const configBytes = manifest.configWords.length * Uint32Array.BYTES_PER_ELEMENT;
    configPointer = Number(exports.malloc(configBytes));
    if (selection.nativeCursor) {
      cursorPointer = Number(exports.malloc(COMPANION_CURSOR_BYTES));
    }
    if (foundation) {
      toolboxPointer = Number(exports.malloc(COMPANION_TOOLBOX_BYTES));
    }
    if (
      !configPointer
      || (observeState && !snapshotPointer)
      || (selection.nativeCursor && !cursorPointer)
      || (foundation && !toolboxPointer)
    ) {
      throw new Error("Companion allocation failed");
    }
    new Uint32Array(
      exports.memory.buffer,
      configPointer,
      manifest.configWords.length,
    ).set(manifest.configWords);

    const response = await fetch("companion-kernel.wasm");
    if (!response.ok) throw new Error("Companion kernel is unavailable");
    const kernelModule = await WebAssembly.compile(await response.arrayBuffer());
    const expectedImports = [
      "env.memory:memory",
      "game.enhancement_cursor_original:function",
      "game.enhancement_tick_original:function",
      "game.enhancement_ui_original:function",
    ];
    const imports = WebAssembly.Module.imports(kernelModule)
      .map((entry) => `${entry.module}.${entry.name}:${entry.kind}`)
      .sort();
    if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
      throw new Error("Companion kernel import surface is invalid");
    }
    const kernel = await WebAssembly.instantiate(kernelModule, {
      env: { memory: exports.memory },
      game: {
        enhancement_tick_original: exports.enhancement_tick_original,
        enhancement_cursor_original: exports.enhancement_cursor_original,
        enhancement_ui_original: exports.enhancement_ui_original,
      },
    });
    const kernelInit = kernel.exports.companion_init;
    const kernelDispatch = kernel.exports.companion_dispatch;
    const setFirstHeroPanel = kernel.exports.companion_set_first_hero_panel;
    const cursorEventCount = kernel.exports.companion_cursor_event_count;
    const kernelAbi = kernel.exports.companion_abi;
    const kernelConfigBytes = kernel.exports.companion_config_bytes;
    const kernelSnapshotBytes = kernel.exports.companion_snapshot_bytes;
    const kernelCursorBytes = kernel.exports.companion_cursor_bytes;
    const kernelToolboxBytes = kernel.exports.companion_toolbox_bytes;
    if (
      typeof kernelInit !== "function"
      || kernelInit.length !== 9
      || typeof kernelDispatch !== "function"
      || kernelDispatch.length !== 6
      || typeof setFirstHeroPanel !== "function"
      || setFirstHeroPanel.length !== 1
      || typeof cursorEventCount !== "function"
      || cursorEventCount.length !== 0
      || typeof kernelAbi !== "function"
      || typeof kernelConfigBytes !== "function"
      || typeof kernelSnapshotBytes !== "function"
      || typeof kernelCursorBytes !== "function"
      || typeof kernelToolboxBytes !== "function"
      || kernelAbi() !== COMPANION_ABI
      || kernelConfigBytes() !== configBytes
      || kernelSnapshotBytes() !== COMPANION_SNAPSHOT_BYTES
      || kernelCursorBytes() !== COMPANION_CURSOR_BYTES
      || kernelToolboxBytes() !== COMPANION_TOOLBOX_BYTES
      || kernelInit(
        snapshotPointer,
        observeState ? COMPANION_SNAPSHOT_BYTES : 0,
        configPointer,
        configBytes,
        cursorPointer,
        selection.nativeCursor ? COMPANION_CURSOR_BYTES : 0,
        toolboxPointer,
        foundation ? COMPANION_TOOLBOX_BYTES : 0,
        featureFlags,
      ) !== 1
    ) {
      throw new Error("Companion kernel rejected its ABI");
    }

    let cursor: ReturnType<typeof createCursorConsumer> | null = null;
    if (selection.nativeCursor) {
      const element = document.getElementById("canvas");
      if (!(element instanceof HTMLCanvasElement)) {
        throw new Error("Enhancement cursor target is missing");
      }
      cursor = createCursorConsumer({
        element,
        memory: exports.memory,
        cursorPointer,
        // The empty string hands the canvas back to the stylesheet theme.
        fallback: "",
      });
      disposeCursor = cursor.dispose;
      disposeCursorRefresh = installCursorRefresh(
        element,
        () => Number(cursorEventCount()) >>> 0,
        () => {
          if (window.gwCompanionRuntime) {
            const current = Number(window.gwCompanionRuntime.cursorRefreshes) || 0;
            window.gwCompanionRuntime.cursorRefreshes = current + 1;
          }
        },
      );
    }
    const readout = selection.targetReadout
      ? createTargetReadout(document.body)
      : null;
    if (readout) disposeReadout = readout.dispose;

    const toolbox = foundation
      ? createToolboxFoundation(
          document.body,
          (shown) => Number(setFirstHeroPanel(shown ? 1 : 0)) >>> 0,
        )
      : null;
    if (toolbox) disposeToolbox = toolbox.dispose;

    table.set(manifest.tableSlot, kernelDispatch);
    installedCallback = kernelDispatch;
    const runtime = {
      status: "installed",
      buildId: manifest.buildId,
      programId: manifest.programId,
      memory: exports.memory,
      snapshotPointer,
      toolboxPointer,
      configPointer,
      tableSlot: manifest.tableSlot,
      hertz: 0,
      lastRenderUs: 0,
      renderSamples: [],
      snapshotReads: 0,
      rejectedSnapshots: 0,
      cursorRefreshes: 0,
      // Presentation state only: no pixels and no pointer leave this module.
      get cursor() {
        return cursor?.state ?? null;
      },
      // The rendered line, so a live run can read the feature without a
      // screenshot. Text only: the readout owns its own element.
      get readout() {
        return readout?.state ?? null;
      },
      get toolbox() {
        return toolbox?.state ?? null;
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
    stopObserver = observeSnapshots(
      runtime,
      cursor,
      readout,
      toolbox,
      observeState,
    );
    hookSlot.value = manifest.tableSlot + 1;

    const teardown = () => {
      hookSlot.value = 0;
      stopObserver();
      disposeCursorRefresh();
      disposeCursor();
      disposeReadout();
      disposeToolbox();
      if (table.get(manifest.tableSlot) === installedCallback) {
        table.set(manifest.tableSlot, null);
      }
      if (toolboxPointer) free(toolboxPointer);
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
    disposeCursorRefresh();
    disposeCursor();
    disposeReadout();
    disposeToolbox();
    if (
      installedCallback !== null
      && table.get(manifest.tableSlot) === installedCallback
    ) {
      table.set(manifest.tableSlot, null);
    }
    if (toolboxPointer) free(toolboxPointer);
    if (cursorPointer) free(cursorPointer);
    if (configPointer) free(configPointer);
    if (snapshotPointer) free(snapshotPointer);
    window.gwCompanionRuntime = null;
    window.gwCompanionState = Object.freeze({
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
