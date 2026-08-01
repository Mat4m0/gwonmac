import type { EnhancementSelection } from "../shared/contracts.js";
import { createCursorConsumer } from "./enhancement-cursor.js";
import { createTargetReadout } from "./enhancement-readout.js";
import { installCursorRefresh } from "./cursor-refresh.js";
import { createToolboxFoundation } from "./toolbox-foundation.js";
import {
  COMPANION_CURSOR_BYTES,
  COMPANION_SNAPSHOT_BYTES,
  COMPANION_TOOLBOX_BYTES,
} from "./companion-snapshot.js";
import {
  observeCompanion,
  recordCompanionLifecycle,
} from "./companion-observer.js";
import { decodeEnhancementManifest } from "./enhancement-manifest.js";

const ENHANCEMENT_FEATURE_NATIVE_CURSOR = 1 << 0;
const ENHANCEMENT_FEATURE_TARGET_READOUT = 1 << 1;
const ENHANCEMENT_FEATURE_TOOLBOX_FOUNDATION = 1 << 2;
const COMPANION_ABI = 5;
const COMPANION_RUNTIME_BYTES = 65_536;
// A Wasm import is the platform's exact function-type check. JavaScript
// `Function.length` cannot distinguish i32 from f32/f64, which matters because
// the game reaches this export through call_indirect.
const DISPATCH_SIGNATURE_MODULE = new WebAssembly.Module(Uint8Array.of(
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x0a, 0x01, 0x60, 0x06,
  0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x00,
  0x02, 0x13, 0x01, 0x06,
  0x6b, 0x65, 0x72, 0x6e, 0x65, 0x6c,
  0x08, 0x64, 0x69, 0x73, 0x70, 0x61, 0x74, 0x63, 0x68,
  0x00, 0x00,
));

function hasExactDispatchSignature(dispatch: CallableFunction): boolean {
  try {
    new WebAssembly.Instance(DISPATCH_SIGNATURE_MODULE, {
      kernel: { dispatch },
    });
    return true;
  } catch {
    return false;
  }
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

  const manifest = decodeEnhancementManifest(module);
  const exports = instance?.exports;
  if (
    !manifest
    || !(exports?.memory instanceof WebAssembly.Memory)
    || !(exports?.__indirect_function_table instanceof WebAssembly.Table)
    || typeof exports?.malloc !== "function"
    || typeof exports?.free !== "function"
    || !(exports?.enhancement_hook_slot instanceof WebAssembly.Global)
  ) {
    window.gwCompanionState = Object.freeze({ status: "unsupported" });
    recordCompanionLifecycle(window.gwCompanionState);
    return null;
  }

  const table = exports.__indirect_function_table;
  const hookSlot = exports.enhancement_hook_slot;
  // The guard above proves `free` is callable, but WebAssembly exports are typed
  // as the bare `Function`, so the kernel's ABI has to be named here or the five
  // call sites below stop checking what they pass.
  const free = exports.free as (pointer: number) => void;
  if (manifest.tableSlot >= table.length) {
    throw new Error(`Enhancement table slot ${manifest.tableSlot} is out of bounds`);
  }
  if (table.get(manifest.tableSlot) !== null) {
    throw new Error(`Enhancement table slot ${manifest.tableSlot} is occupied`);
  }
  if (hookSlot.value !== 0) {
    throw new Error("Enhancement hook is already enabled");
  }
  try {
    // Assignment is the WebAssembly API's only mutability test for a Global.
    hookSlot.value = 0;
  } catch {
    throw new Error("Enhancement hook global is immutable");
  }

  let snapshotPointer = 0;
  let configPointer = 0;
  let cursorPointer = 0;
  let toolboxPointer = 0;
  let runtimePointer = 0;
  let stopObserver = () => {};
  let disposeCursor = () => {};
  let disposeReadout = () => {};
  let disposeToolbox = () => {};
  let disposeCursorRefresh = () => {};
  let installedCallback: CallableFunction | null = null;
  let installedRuntime: object | null = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    // Disable dispatch before releasing any callback-owned state.
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
    if (runtimePointer) free(runtimePointer);
    if (window.gwCompanionRuntime === installedRuntime) {
      window.gwCompanionRuntime = null;
    }
  };
  try {
    runtimePointer = Number(exports.malloc(COMPANION_RUNTIME_BYTES));
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
      !runtimePointer
      || !configPointer
      || (observeState && !snapshotPointer)
      || (selection.nativeCursor && !cursorPointer)
      || (foundation && !toolboxPointer)
    ) {
      throw new Error("Companion allocation failed");
    }
    const ownedRegions = [
      { name: "runtime", pointer: runtimePointer, size: COMPANION_RUNTIME_BYTES, align: 16 },
      ...(observeState
        ? [{ name: "snapshot", pointer: snapshotPointer, size: COMPANION_SNAPSHOT_BYTES, align: 4 }]
        : []),
      { name: "config", pointer: configPointer, size: configBytes, align: 4 },
      ...(selection.nativeCursor
        ? [{ name: "cursor", pointer: cursorPointer, size: COMPANION_CURSOR_BYTES, align: 4 }]
        : []),
      ...(foundation
        ? [{ name: "toolbox", pointer: toolboxPointer, size: COMPANION_TOOLBOX_BYTES, align: 4 }]
        : []),
    ];
    for (const region of ownedRegions) {
      const end = region.pointer + region.size;
      if (
        !Number.isSafeInteger(region.pointer)
        || region.pointer <= 0
        || region.pointer % region.align !== 0
        || !Number.isSafeInteger(end)
        || end > exports.memory.buffer.byteLength
        || end > 0x7fff_ffff
      ) {
        throw new Error(`Companion ${region.name} allocation is invalid`);
      }
    }
    for (let left = 0; left < ownedRegions.length; left += 1) {
      const a = ownedRegions[left]!;
      for (let right = left + 1; right < ownedRegions.length; right += 1) {
        const b = ownedRegions[right]!;
        if (a.pointer < b.pointer + b.size && b.pointer < a.pointer + a.size) {
          throw new Error(`Companion ${a.name}/${b.name} allocations overlap`);
        }
      }
    }
    const runtimeEnd = runtimePointer + COMPANION_RUNTIME_BYTES;
    // A side module is normally loaded by Emscripten's dynamic linker, which
    // supplies zeroed BSS. We are the loader here, so establish that invariant
    // for this whole private block before its active data segment is applied.
    new Uint8Array(
      exports.memory.buffer,
      runtimePointer,
      COMPANION_RUNTIME_BYTES,
    ).fill(0);
    new Uint32Array(
      exports.memory.buffer,
      configPointer,
      manifest.configWords.length,
    ).set(manifest.configWords);

    const response = await fetch("companion-kernel.wasm");
    if (!response.ok) throw new Error("Companion kernel is unavailable");
    const kernelBytes = await response.arrayBuffer();
    const kernelSha256 = [...new Uint8Array(
      await crypto.subtle.digest("SHA-256", kernelBytes),
    )].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const kernelModule = await WebAssembly.compile(kernelBytes);
    const expectedImports = [
      "env.__indirect_function_table:table",
      "env.__memory_base:global",
      "env.__stack_pointer:global",
      "env.__table_base:global",
      "env.memory:memory",
    ];
    const imports = WebAssembly.Module.imports(kernelModule)
      .map((entry) => `${entry.module}.${entry.name}:${entry.kind}`)
      .sort();
    if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
      throw new Error("Companion kernel import surface is invalid");
    }
    const immutableI32 = (value: number) => new WebAssembly.Global(
      { value: "i32", mutable: false },
      value,
    );
    const kernel = await WebAssembly.instantiate(kernelModule, {
      env: {
        memory: exports.memory,
        __indirect_function_table: new WebAssembly.Table({
          initial: 0,
          maximum: 0,
          element: "anyfunc",
        }),
        __memory_base: immutableI32(runtimePointer),
        __stack_pointer: new WebAssembly.Global(
          { value: "i32", mutable: true },
          runtimeEnd,
        ),
        __table_base: immutableI32(0),
      },
    });
    const kernelInit = kernel.exports.companion_init;
    const kernelDispatch = kernel.exports.companion_dispatch;
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
      || !hasExactDispatchSignature(kernelDispatch)
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
      ? createToolboxFoundation(document.body)
      : null;
    if (toolbox) disposeToolbox = toolbox.dispose;

    table.set(manifest.tableSlot, kernelDispatch);
    installedCallback = kernelDispatch;
    const runtime = {
      status: "installed",
      buildId: manifest.buildId,
      programId: manifest.programId,
      companionAbi: COMPANION_ABI,
      kernelSha256,
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
        if (cleaned || table.get(manifest.tableSlot) !== installedCallback) {
          throw new Error("Enhancement installation is no longer active");
        }
        hookSlot.value = enabled
          ? manifest.tableSlot + 1
          : 0;
      },
    };
    installedRuntime = runtime;
    window.gwCompanionInstallations = runtime.installation;
    window.gwCompanionRuntime = runtime;
    stopObserver = observeCompanion(
      runtime,
      cursor,
      readout,
      toolbox,
      observeState,
    );
    hookSlot.value = manifest.tableSlot + 1;

    window.addEventListener("pagehide", cleanup, { once: true });
    console.info(
      `[enhancement] installed for client build ${manifest.buildId}; ` +
      `companion ABI ${COMPANION_ABI} ${kernelSha256.slice(0, 12)}`,
    );
    return runtime;
  } catch (error) {
    cleanup();
    window.gwCompanionState = Object.freeze({
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
