/**
 * Installs the companion kernel into the running client: verifies the exports
 * it needs, allocates its shared memory, hands it the manifest's config, and
 * starts the observer.
 *
 * All or nothing. Every precondition is checked before anything is allocated,
 * and any failure afterwards releases everything this installation took before
 * rethrowing, so there is no state where some hooks are live and others are
 * not. A module that carries no decodable manifest, or that lacks an export the
 * kernel needs, gets no kernel at all rather than a partial one.
 *
 * What a failed installation costs the launch is the harness's decision, not
 * this module's.
 */
import {
  enhancementCapabilityProfile,
  type EnhancementCapabilities,
  type EnhancementProgram,
} from "../shared/enhancement-contracts.js";
import { createCursorConsumer } from "./enhancement-cursor.js";
import { createTargetReadout } from "./enhancement-readout.js";
import {
  createHiddenCursorRetry,
  installCursorRefresh,
  type HiddenCursorRetry,
} from "./cursor-refresh.js";
import { createToolboxLifecycle } from "./toolbox-foundation.js";
import {
  COMPANION_CURSOR_BYTES,
  COMPANION_SNAPSHOT_BYTES,
  COMPANION_TOOLBOX_BYTES,
  COMPANION_PARTY_BYTES,
  type CompanionSnapshot,
} from "./companion-snapshot.js";
import {
  COMPANION_SKILL_COOLDOWN_BYTES,
  COMPANION_SKILL_SLOT_BYTES,
} from "./companion-skill-snapshot.js";
import { createSkillOverlaysInstallation } from "./skill-overlays-installation.js";
import { validateCompanionOwnedRegions } from "./companion-owned-regions.js";
import {
  observeCompanion,
  recordCompanionLifecycle,
} from "./companion-observer.js";
import { decodeEnhancementManifest } from "./enhancement-manifest.js";
import type {
  RendererMilestone,
  RendererMilestoneFields,
} from "../shared/diagnostics.js";
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import type {
  EnhancementCommandEnqueue,
} from "./enhancement-team-commands.js";
import type { StorageInstallation } from "./enhancement-storage-installation.js";
import type { TravelInstallation } from "./enhancement-travel-installation.js";
import { travelGameState } from "../shared/travel-command.js";
import {
  COMPANION_ABI as COMPANION_DESCRIPTOR,
  COMPANION_DISPATCH_KINDS,
  COMPANION_FEATURE_BITS,
} from "../shared/companion-abi.js";
import {
  COMPANION_KERNEL_EXPORTS,
  COMPANION_KERNEL_IMPORTS,
  companionKernelSignatureBytes,
} from "../shared/companion-kernel-contract.js";
import {
  enhancementRuntimePolicy,
  runtimePlayRegion,
  type RuntimePlayRegion,
} from "./enhancement-runtime-policy.js";
import {
  createProfessionCommandTrace,
  PROFESSION_COMMAND_TRACE_BYTES,
  type ProfessionCommandTraceReader,
} from "./profession-command-trace.js";

const COMPANION_ABI = COMPANION_DESCRIPTOR.kernel;
const COMPANION_RUNTIME_BYTES = 65_536;
/**
 * The side module's `__memory_base` must be 16-byte aligned: the wasm linker
 * places the module's data segments at fixed offsets *from* this base, so a
 * misaligned base misaligns every aligned datum inside it.
 *
 * Emscripten's allocator only promises 8. Asking `malloc` for the alignment we
 * need and refusing what it returns is a launch that fails on where the heap
 * happened to land -- observed live: pointer 11,518,200, which is 8-aligned and
 * not 16. So the block is over-allocated by the alignment and the base is
 * rounded up inside it; the raw pointer is what has to be freed.
 */
const COMPANION_RUNTIME_ALIGN = 16;
const companionKernelSignatureModule = new WebAssembly.Module(
  companionKernelSignatureBytes(),
);

// A Wasm import is the platform's exact function-type check. JavaScript
// reflection cannot distinguish i32 from f32/f64 or void from i32.
function hasExactCompanionSignatures(exports: WebAssembly.Exports): boolean {
  try {
    new WebAssembly.Instance(companionKernelSignatureModule, {
      kernel: exports,
    });
    return true;
  } catch {
    return false;
  }
}

let companionInstallations = 0;

/**
 * The renderer half of the Enhancement crash story: whether the hook was live
 * when a later wasm.abort fires. Best-effort by design — telemetry must never
 * fail an installation.
 */
const recordMilestone = (
  name: RendererMilestone,
  fields?: RendererMilestoneFields,
) => {
  void window.gwNative.diagnostics
    .recordRendererMilestone(name, performance.now() * 1000, fields)
    .catch(() => {});
};

function percentile95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}
export async function installCertifiedCompanion(
  instance: WebAssembly.Instance,
  module: WebAssembly.Module,
  capabilities: EnhancementCapabilities,
  program: EnhancementProgram = "none",
) {
  // Program selection is independent from automation permission. Packaged
  // launches always receive `none`; developer observers request their scalar
  // projection explicitly without implicitly mounting the Toolbox overlay.
  const foundation = capabilities.partyObservation;
  const skills = createSkillOverlaysInstallation(capabilities);
  const skillSlotGeometry = skills.geometry;
  const skillCooldowns = skills.cooldowns;
  const observeState = capabilities.targetObservation || capabilities.xunlaiAction;
  const publishObserverState = program === "target-observer";
  const featureFlags =
    (capabilities.nativeCursor ? COMPANION_FEATURE_BITS.nativeCursor : 0)
    | (observeState ? COMPANION_FEATURE_BITS.gameSnapshot : 0)
    | (foundation ? COMPANION_FEATURE_BITS.toolboxFoundation : 0)
    | (capabilities.targetObservation ? COMPANION_FEATURE_BITS.targetObservation : 0)
    | skills.certifiedFeatureFlags;
  if (featureFlags === 0) return null;

  const manifest = decodeEnhancementManifest(module, capabilities);
  const exports = instance?.exports;
  if (
    !manifest
    || !(exports?.memory instanceof WebAssembly.Memory)
    || !(exports?.__indirect_function_table instanceof WebAssembly.Table)
    || typeof exports?.malloc !== "function"
    || typeof exports?.free !== "function"
    || !(exports?.enhancement_hook_slot instanceof WebAssembly.Global)
  ) {
    const state = Object.freeze({ status: "unsupported" } as const);
    recordCompanionLifecycle(state);
    if (publishObserverState) window.gwCompanionState = state;
    recordMilestone("enhancement.installFailed");
    return null;
  }

  const table = exports.__indirect_function_table;
  const hookSlot = exports.enhancement_hook_slot;
  const memory = exports.memory;
  // Present only in the module derived for the commands capability, because
  // the transform emits it only there. A profile without it has no call to a
  // packet builder anywhere in its bytes, so this is a real absence rather
  // than a disabled feature.
  const commandEnqueue = capabilities.teamApply
    ? (typeof exports.enhancement_command === "function"
        ? exports.enhancement_command as EnhancementCommandEnqueue
        : null)
    : null;
  const professionTraceReader = capabilities.teamApply
    ? (typeof exports?.enhancement_profession_trace === "function"
        ? exports.enhancement_profession_trace as ProfessionCommandTraceReader
        : null)
    : null;
  if (capabilities.teamApply && commandEnqueue === null) {
    throw new Error("the commands profile derived a module with no command queue");
  }
  if (capabilities.teamApply && professionTraceReader === null) {
    throw new Error("the commands profile derived a module with no profession trace");
  }
  // Keep the command implementation out of Core-only sessions altogether.
  // The derived module and its JavaScript boundary arrive as one capability.
  const teamCommands = capabilities.teamApply
    ? await import("./enhancement-team-commands.js")
    : null;
  const storageInstallation: StorageInstallation | null = capabilities.xunlaiAction
    ? (await import("./enhancement-storage-installation.js"))
        .createStorageInstallation(exports, true, window.gwNative.init.development)
    : null;
  const travelInstallation: TravelInstallation | null = capabilities.travelAction
    ? (await import("./enhancement-travel-installation.js"))
        .createTravelInstallation(exports, true)
    : null;
  const configureTradeToggle = capabilities.chatAliases
    ? (typeof exports.enhancement_configure_trade_toggle === "function"
        ? exports.enhancement_configure_trade_toggle as (enabled: number) => number
        : null)
    : null;
  const takeTradeToggle = capabilities.chatAliases
    ? (typeof exports.enhancement_take_trade_toggle === "function"
        ? exports.enhancement_take_trade_toggle as () => number
        : null)
    : null;
  if (capabilities.chatAliases && (!configureTradeToggle || !takeTradeToggle)) {
    throw new Error("the aliases profile derived a module with no Trade Chat toggle");
  }
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
  let partyPointer = 0;
  let payloadPointer = 0;
  let professionTracePointer = 0;
  // What malloc returned, which is what free must be given. The aligned base
  // used by the module lives inside it and is not a valid argument to free.
  let runtimeAllocation = 0;
  let stopObserver = () => {};
  let disposeCursor = () => {};
  let disposeReadout = () => {};
  let disposeToolbox = () => {};
  let disposeToolSettings = () => {};
  let disposeCursorRefresh = () => {};
  let professionTrace: ReturnType<typeof createProfessionCommandTrace> | null = null;
  let installedCallback: CallableFunction | null = null;
  let installedCursorState: NonNullable<typeof window.gwCursorState> | null = null;
  let installedRuntime: object | null = null;
  let cleaned = false;
  let telemetryInstalled = false;
  const cleanup = (): readonly Error[] => {
    if (cleaned) return [];
    // Disabling dispatch is the safety barrier. If it fails, releasing memory
    // or callback-owned state could leave the live game calling freed data.
    try {
      hookSlot.value = 0;
    } catch (cause) {
      return [new Error("Companion cleanup could not disable dispatch", { cause })];
    }
    cleaned = true;
    const failures: Error[] = [];
    const attempt = (stage: string, release: () => void): boolean => {
      try {
        release();
        return true;
      } catch (cause) {
        failures.push(new Error(`Companion cleanup failed during ${stage}`, { cause }));
        return false;
      }
    };
    const cursorStateWithdrawn = attempt("cursor state withdrawal", () => {
      if (
        installedCursorState !== null
        && window.gwCursorState === installedCursorState
      ) {
        delete window.gwCursorState;
      }
    });
    const observerStopped = attempt("observer disposal", stopObserver);
    if (observerStopped) {
      attempt("cursor refresh disposal", disposeCursorRefresh);
      attempt("cursor disposal", disposeCursor);
      attempt("target readout disposal", disposeReadout);
      attempt("Toolbox disposal", disposeToolbox);
      attempt("skill overlay disposal", skills.disposePresentation);
      attempt("skill-slot feed disposal", skillSlotGeometry.dispose);
      attempt("skill cooldown feed disposal", skillCooldowns.dispose);
    }
    attempt("Tools settings listener disposal", disposeToolSettings);
    attempt("Trade alias disable", () => { configureTradeToggle?.(0); });
    if (observerStopped) {
      attempt("profession trace disposal", () => professionTrace?.dispose());
    }
    const callbackWithdrawn = attempt("callback withdrawal", () => {
      if (
        installedCallback !== null
        && table.get(manifest.tableSlot) === installedCallback
      ) {
        table.set(manifest.tableSlot, null);
      }
    });
    if (callbackWithdrawn) {
      if (observerStopped) {
        attempt("Toolbox allocation release", () => {
          if (toolboxPointer) free(toolboxPointer);
        });
        attempt("party allocation release", () => {
          if (partyPointer) free(partyPointer);
        });
        attempt("skill-slot allocation release", () => skillSlotGeometry.release(free));
        attempt("skill cooldown allocation release", () => skillCooldowns.release(free));
      }
      attempt("command payload release", () => {
        if (payloadPointer) free(payloadPointer);
      });
      attempt("storage disposal", () => storageInstallation?.dispose(free));
      attempt("Travel disposal", () => travelInstallation?.dispose(free));
      if (observerStopped) {
        attempt("profession trace allocation release", () => {
          if (professionTracePointer) free(professionTracePointer);
        });
        attempt("cursor allocation release", () => {
          if (cursorPointer) free(cursorPointer);
        });
      }
      attempt("configuration allocation release", () => {
        if (configPointer) free(configPointer);
      });
      if (observerStopped) {
        attempt("snapshot allocation release", () => {
          if (snapshotPointer) free(snapshotPointer);
        });
      }
      attempt("runtime allocation release", () => {
        if (runtimeAllocation) free(runtimeAllocation);
      });
    }
    const runtimeWithdrawn = attempt("runtime withdrawal", () => {
      if (window.gwCompanionRuntime === installedRuntime) {
        window.gwCompanionRuntime = null;
      }
    });
    // Only a completed installation records a withdrawal; a rollback after a
    // failed install records enhancement.installFailed instead.
    if (
      telemetryInstalled
      && observerStopped
      && cursorStateWithdrawn
      && callbackWithdrawn
      && runtimeWithdrawn
      && failures.length === 0
    ) {
      telemetryInstalled = false;
      attempt("uninstall telemetry", () => {
        recordMilestone("enhancement.uninstalled", {
          installation: companionInstallations,
        });
      });
    }
    return failures;
  };
  const cleanupAfterPageHide = () => {
    const failures = cleanup();
    if (failures.length > 0) {
      try {
        console.error(
          "companion cleanup failed",
          new AggregateError(failures, "Companion cleanup was incomplete"),
        );
      } catch {
        // A hostile console must not turn page teardown into another failure.
      }
    }
  };
  try {
    runtimeAllocation = Number(
      exports.malloc(COMPANION_RUNTIME_BYTES + COMPANION_RUNTIME_ALIGN - 1),
    );
    // Rounded with arithmetic rather than a bitmask: pointers reach past what
    // a 32-bit bitwise operation can represent as the heap grows.
    const runtimePointer = runtimeAllocation === 0
      ? 0
      : Math.ceil(runtimeAllocation / COMPANION_RUNTIME_ALIGN)
        * COMPANION_RUNTIME_ALIGN;
    if (observeState) {
      snapshotPointer = Number(exports.malloc(COMPANION_SNAPSHOT_BYTES));
    }
    const configBytes = manifest.configWords.length * Uint32Array.BYTES_PER_ELEMENT;
    configPointer = Number(exports.malloc(configBytes));
    if (capabilities.nativeCursor) {
      cursorPointer = Number(exports.malloc(COMPANION_CURSOR_BYTES));
    }
    if (foundation) {
      toolboxPointer = Number(exports.malloc(COMPANION_TOOLBOX_BYTES));
      partyPointer = Number(exports.malloc(COMPANION_PARTY_BYTES));
    }
    skillSlotGeometry.allocate(exports.malloc as (bytes: number) => unknown);
    skillCooldowns.allocate(exports.malloc as (bytes: number) => unknown);
    if (capabilities.teamApply) {
      payloadPointer = Number(
        exports.malloc(teamCommands!.TEAM_COMMAND_PAYLOAD_BYTES),
      );
      if (window.gwNative.init.development) {
        professionTracePointer = Number(
          exports.malloc(PROFESSION_COMMAND_TRACE_BYTES),
        );
      }
    }
    storageInstallation?.allocate(exports.malloc as (bytes: number) => unknown);
    travelInstallation?.allocate(exports.malloc as (bytes: number) => unknown);
    if (
      !runtimeAllocation
      || !configPointer
      || (observeState && !snapshotPointer)
      || (capabilities.nativeCursor && !cursorPointer)
      || (foundation && !toolboxPointer)
      || (foundation && !partyPointer)
      || !skillSlotGeometry.allocated
      || !skillCooldowns.allocated
      || (capabilities.teamApply && !payloadPointer)
      || (storageInstallation !== null && !storageInstallation.region().pointer)
      || (travelInstallation !== null && !travelInstallation.region().pointer)
      || (
        capabilities.teamApply
        && window.gwNative.init.development
        && !professionTracePointer
      )
    ) {
      throw new Error("Companion allocation failed");
    }
    const ownedRegions = [
      {
        name: "runtime",
        pointer: runtimePointer,
        size: COMPANION_RUNTIME_BYTES,
        align: COMPANION_RUNTIME_ALIGN,
      },
      ...(observeState
        ? [{ name: "snapshot", pointer: snapshotPointer, size: COMPANION_SNAPSHOT_BYTES, align: 4 }]
        : []),
      { name: "config", pointer: configPointer, size: configBytes, align: 4 },
      ...(capabilities.nativeCursor
        ? [{ name: "cursor", pointer: cursorPointer, size: COMPANION_CURSOR_BYTES, align: 4 }]
        : []),
      ...(foundation
        ? [
            { name: "toolbox", pointer: toolboxPointer, size: COMPANION_TOOLBOX_BYTES, align: 4 },
            { name: "party", pointer: partyPointer, size: COMPANION_PARTY_BYTES, align: 4 },
          ]
        : []),
      ...(skillSlotGeometry.region === null ? [] : [skillSlotGeometry.region]),
      ...(skillCooldowns.region === null ? [] : [skillCooldowns.region]),
      ...(capabilities.teamApply
        ? [
            {
              name: "command payload",
              pointer: payloadPointer,
              size: teamCommands!.TEAM_COMMAND_PAYLOAD_BYTES,
              align: 4,
            },
            ...(professionTracePointer
              ? [{
                  name: "profession trace",
                  pointer: professionTracePointer,
                  size: PROFESSION_COMMAND_TRACE_BYTES,
                  align: 4,
                }]
              : []),
          ]
        : []),
      ...(storageInstallation === null ? [] : [storageInstallation.region()]),
      ...(travelInstallation === null ? [] : [travelInstallation.region()]),
    ];
    validateCompanionOwnedRegions(ownedRegions, memory.buffer.byteLength);
    const runtimeEnd = runtimePointer + COMPANION_RUNTIME_BYTES;
    // A side module is normally loaded by Emscripten's dynamic linker, which
    // supplies zeroed BSS. We are the loader here, so establish that invariant
    // for this whole private block before its active data segment is applied.
    new Uint8Array(
      memory.buffer,
      runtimePointer,
      COMPANION_RUNTIME_BYTES,
    ).fill(0);
    new Uint32Array(
      memory.buffer,
      configPointer,
      manifest.configWords.length,
    ).set(manifest.configWords);
    storageInstallation?.initialize(memory);
    travelInstallation?.initialize();

    const response = await fetch("companion-kernel.wasm");
    if (!response.ok) throw new Error("Companion kernel is unavailable");
    const kernelBytes = await response.arrayBuffer();
    const kernelSha256 = [...new Uint8Array(
      await crypto.subtle.digest("SHA-256", kernelBytes),
    )].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const kernelModule = await WebAssembly.compile(kernelBytes);
    const imports = WebAssembly.Module.imports(kernelModule)
      .map((entry) => `${entry.module}.${entry.name}:${entry.kind}`)
      .sort();
    if (JSON.stringify(imports) !== JSON.stringify(COMPANION_KERNEL_IMPORTS)) {
      throw new Error("Companion kernel import surface is invalid");
    }
    const kernelExports = WebAssembly.Module.exports(kernelModule)
      .map((entry) => `${entry.name}:${entry.kind}`)
      .sort();
    if (JSON.stringify(kernelExports) !== JSON.stringify(COMPANION_KERNEL_EXPORTS)) {
      throw new Error("Companion kernel export surface is invalid");
    }
    const immutableI32 = (value: number) => new WebAssembly.Global(
      { value: "i32", mutable: false },
      value,
    );
    const kernel = await WebAssembly.instantiate(kernelModule, {
      env: {
        memory,
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
    if (!hasExactCompanionSignatures(kernel.exports)) {
      throw new Error("Companion kernel export signatures are invalid");
    }
    type KernelInit = (
      snapshotPointer: number,
      snapshotBytes: number,
      configPointer: number,
      configBytes: number,
      cursorPointer: number,
      cursorBytes: number,
      toolboxPointer: number,
      toolboxBytes: number,
      partyPointer: number,
      partyBytes: number,
      skillSlotPointer: number,
      skillKeyBytes: number,
      skillCooldownPointer: number,
      skillCooldownBytes: number,
      featureFlags: number,
    ) => number;
    type KernelDispatch = (
      messageId: number,
      wParam: number,
      lParam: number,
      cursorData: number,
      cursorWidth: number,
      cursorHeight: number,
    ) => void;
    type KernelScalar = () => number;
    const kernelInit = kernel.exports.companion_init as KernelInit;
    const kernelDispatch = kernel.exports.companion_dispatch as KernelDispatch;
    const cursorEventCount = kernel.exports.companion_cursor_event_count as KernelScalar;
    const kernelAbi = kernel.exports.companion_abi as KernelScalar;
    const kernelConfigBytes = kernel.exports.companion_config_bytes as KernelScalar;
    const kernelSnapshotBytes = kernel.exports.companion_snapshot_bytes as KernelScalar;
    const kernelCursorBytes = kernel.exports.companion_cursor_bytes as KernelScalar;
    const kernelToolboxBytes = kernel.exports.companion_toolbox_bytes as KernelScalar;
    const kernelPartyBytes = kernel.exports.companion_party_bytes as KernelScalar;
    const kernelSkillSlotBytes = kernel.exports.companion_skill_slot_bytes as KernelScalar;
    const kernelSkillCooldownBytes =
      kernel.exports.companion_skill_cooldown_bytes as KernelScalar;
    if (
      kernelAbi() !== COMPANION_ABI
      || kernelConfigBytes() !== configBytes
      || kernelSnapshotBytes() !== COMPANION_SNAPSHOT_BYTES
      || kernelCursorBytes() !== COMPANION_CURSOR_BYTES
      || kernelToolboxBytes() !== COMPANION_TOOLBOX_BYTES
      || kernelPartyBytes() !== COMPANION_PARTY_BYTES
      || kernelSkillSlotBytes() !== COMPANION_SKILL_SLOT_BYTES
      || kernelSkillCooldownBytes() !== COMPANION_SKILL_COOLDOWN_BYTES
      || kernelInit(
        snapshotPointer,
        observeState ? COMPANION_SNAPSHOT_BYTES : 0,
        configPointer,
        configBytes,
        cursorPointer,
        capabilities.nativeCursor ? COMPANION_CURSOR_BYTES : 0,
        toolboxPointer,
        foundation ? COMPANION_TOOLBOX_BYTES : 0,
        partyPointer,
        foundation ? COMPANION_PARTY_BYTES : 0,
        skillSlotGeometry.pointer,
        skillSlotGeometry.bytes,
        skillCooldowns.pointer,
        skillCooldowns.bytes,
        featureFlags,
      ) !== 1
    ) {
      throw new Error("Companion kernel rejected its ABI");
    }

    let cursorRefreshes = 0;
    let hiddenRetry: HiddenCursorRetry | null = null;
    let cursor: ReturnType<typeof createCursorConsumer> | null = null;
    if (capabilities.nativeCursor) {
      const element = document.getElementById("canvas");
      if (!(element instanceof HTMLCanvasElement)) {
        throw new Error("Enhancement cursor target is missing");
      }
      const refresh = installCursorRefresh(
        element,
        () => Number(cursorEventCount()) >>> 0,
        () => {
          cursorRefreshes += 1;
        },
      );
      disposeCursorRefresh = refresh.dispose;
      const retry = createHiddenCursorRetry(refresh.retest);
      hiddenRetry = retry;
      cursor = createCursorConsumer({
        element,
        memory,
        cursorPointer,
        // The empty string hands the canvas back to the stylesheet theme.
        fallback: "",
        // Hold the last art through a click-armed transition: the hide is a
        // wait for the server, not an instruction. `!expired` rather than an
        // "active" flag, because the retry only learns about the hide after
        // the consumer's poll — a hold gated on activity would miss the very
        // frame the hide is applied.
        transitionHold: () => !retry.expired && refresh.armed(),
      });
      disposeCursor = cursor.dispose;
      // The client's own cursor state, projected for two consumers: the
      // console, for mode questions from a live session, and the pointer-lock
      // gate in input.ts, which reads `hidden` to tell mouse-look from a map
      // pan (measured 2026-08-03: mouse-look hides the client cursor within a
      // tick of the right press; a map pan never does). Bounded presentation
      // state only — no pixels, no pointers.
      installedCursorState = () => cursor?.state ?? null;
      window.gwCursorState = installedCursorState;
    }
    let optionalSettings = window.gwToolsSettings();
    skills.mount(document.body, optionalSettings);
    const configureTradeAlias = () => {
      configureTradeToggle?.(optionalSettings.enabled ? 1 : 0);
    };
    const pollTradeAlias = () => {
      if (takeTradeToggle?.() === 1 && optionalSettings.enabled) {
        window.dispatchEvent(new CustomEvent("gw:trade-toggle"));
      }
    };
    let snapshotPlayRegion: RuntimePlayRegion | null = observeState
      ? "unknown"
      : null;
    let partyPlayRegion: RuntimePlayRegion = foundation
      ? "unknown"
      : "pve";
    let readout: ReturnType<typeof createTargetReadout> | null = null;
    const playRegion = () => runtimePlayRegion(
      snapshotPlayRegion,
      partyPlayRegion,
    );
    const policy = () => enhancementRuntimePolicy(
      program,
      optionalSettings,
      playRegion(),
    );
    let lastPolicyTrace = "";
    const tracePolicy = (reason: "launch" | "region" | "settings") => {
      if (!window.gwNative.init.development) return;
      const active = policy();
      const summary = {
        program,
        playRegion: playRegion(),
        nativeCursor: capabilities.nativeCursor,
        teamManagement: active.teamManagement,
        xunlaiStorage: active.xunlaiStorage,
        targetReadout: active.targetReadout,
        commands: commands !== null,
      };
      const signature = JSON.stringify(summary);
      if (signature === lastPolicyTrace) return;
      lastPolicyTrace = signature;
      console.debug(`[tools:dev] policy ${JSON.stringify({ reason, ...summary })}`);
    };
    const targetEnabled = () => policy().targetReadout;
    const setTargetEnabled = () => {
      if (!observeState) return;
      if (targetEnabled()) readout ??= createTargetReadout(document.body);
      else {
        readout?.dispose();
        readout = null;
      }
    };
    const syncSkillOverlays = () => skills.sync(
      optionalSettings,
      policy().skillSlotGeometry,
      policy().skillCooldownOverlay,
    );
    setTargetEnabled();
    syncSkillOverlays();
    disposeReadout = () => {
      readout?.dispose();
      readout = null;
    };

    // Command modules own values and reviewed opcodes; the installer owns the
    // live permission gates and supplies fresh game and party observations.
    let toolboxObservation: ToolboxObservation | null = null;
    let companionState: CompanionSnapshot | null = null;
    const teamEnabled = () => policy().teamManagement;
    const syncActiveObservers = () => {
      const active =
        (capabilities.nativeCursor ? COMPANION_FEATURE_BITS.nativeCursor : 0)
        // Keep the bounded policy observer alive even while optional UI and
        // commands are denied. It is the only way an unknown region can later
        // prove that it became PvE without restarting.
        | (foundation ? COMPANION_FEATURE_BITS.toolboxFoundation : 0)
        | (targetEnabled() ? COMPANION_FEATURE_BITS.targetObservation : 0)
        | skills.activeFeatureFlags(
          optionalSettings,
          policy().skillSlotGeometry,
          policy().skillCooldownOverlay,
        );
      kernelDispatch(
        COMPANION_DISPATCH_KINDS.activeFeatures,
        active,
        0,
        0,
        0,
        0,
      );
    };
    const commands = commandEnqueue === null ? null : teamCommands!.createTeamApplyCommands({
      memory,
      payloadPointer,
      send: commandEnqueue,
      development: window.gwNative.init.development,
      ready: () => {
        if (cleaned) throw new Error("Enhancement installation is no longer active");
        if (!teamEnabled()) throw new Error("Apply team is disabled");
        const currentRegion = playRegion();
        if (currentRegion !== "pve") {
          throw new Error(
            currentRegion === "pvp"
              ? "GWonMac Tools are unavailable in PvP"
              : "GWonMac Tools are unavailable while the region is unknown",
          );
        }
        const observed = toolboxObservation;
        if (observed === null || observed.status !== "ready") {
          throw new Error("no party has been observed yet");
        }
        if (observed.party?.playRegion !== "pve") {
          throw new Error("team commands require a confirmed PvE party");
        }
        if (observed.party?.inOutpost !== true) {
          throw new Error("team commands require a confirmed PvE outpost");
        }
        return observed;
      },
    });
    const syncStoragePolicy = () => {
      storageInstallation?.update({
        enabled: policy().xunlaiStorage,
        state: companionState,
      });
    };
    const syncTravelPolicy = () => {
      travelInstallation?.update({
        enabled: policy().travelPalette,
        playRegion: playRegion(),
        state: travelGameState(companionState),
      });
    };
    storageInstallation?.mount();
    travelInstallation?.mount(document.body);
    const storage = storageInstallation?.command() ?? null;
    const toolbox = foundation
      ? createToolboxLifecycle(document.body, {
          mountTool: (host, onVisibilityChange) =>
            import("./tools-host.js").then(({ mountToolsInto }) =>
              mountToolsInto(host, onVisibilityChange, commands, storage, true),
            ),
          mountTrade: (host, onVisibilityChange) =>
            import("./tools-host.js").then(({ mountTradeInto }) =>
              mountTradeInto(host, onVisibilityChange),
            ),
        })
      : null;
    if (professionTracePointer !== 0 && professionTraceReader !== null) {
      professionTrace = createProfessionCommandTrace(
        memory,
        professionTracePointer,
        professionTraceReader,
      );
    }
    const syncToolboxAvailability = () => {
      toolbox?.setEnabled(policy().tools);
    };
    tracePolicy("launch");
    const onToolSettings = () => {
      // The event is only a notification. The validated bridge remains the
      // single source of truth even if page code dispatches a malformed event.
      optionalSettings = window.gwToolsSettings();
      tracePolicy("settings");
      syncToolboxAvailability();
      setTargetEnabled();
      syncSkillOverlays();
      syncActiveObservers();
      syncStoragePolicy();
      syncTravelPolicy();
      configureTradeAlias();
    };
    window.addEventListener("gw:tools-settings", onToolSettings);
    disposeToolSettings = () =>
      window.removeEventListener("gw:tools-settings", onToolSettings);
    disposeToolbox = () => {
      toolbox?.dispose();
    };

    // Apply opt-in state before the callback becomes reachable from the game.
    syncActiveObservers();
    syncStoragePolicy();
    syncTravelPolicy();
    configureTradeAlias();
    table.set(manifest.tableSlot, kernelDispatch);
    installedCallback = kernelDispatch;
    const observerRuntime = {
      memory,
      snapshotPointer,
      toolboxPointer,
      partyPointer,
      skillSlotPointer: skillSlotGeometry.pointer,
      skillCooldownPointer: skillCooldowns.pointer,
      hertz: 0,
      lastRenderUs: 0,
      renderSamples: [] as number[],
      snapshotReads: 0,
      rejectedSnapshots: 0,
    };
    const installation = companionInstallations + 1;
    const runtimeProjection = {
      status: "installed" as const,
      buildId: manifest.buildId,
      programId: manifest.programId,
      companionAbi: COMPANION_ABI,
      kernelSha256,
      installation,
      get hertz() {
        return observerRuntime.hertz;
      },
      get lastRenderUs() {
        return observerRuntime.lastRenderUs;
      },
      get renderP95Us() {
        return percentile95(observerRuntime.renderSamples);
      },
      get snapshotReads() {
        return observerRuntime.snapshotReads;
      },
      get rejectedSnapshots() {
        return observerRuntime.rejectedSnapshots;
      },
      get cursorRefreshes() {
        return cursorRefreshes;
      },
      get cursorHiddenRetests() {
        return hiddenRetry?.retests ?? 0;
      },
      get cursorHiddenGapMs() {
        return hiddenRetry?.lastGapMs ?? null;
      },
      get wasmMemoryBytes() {
        return memory.buffer.byteLength;
      },
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
      get skillCooldowns() {
        return skillCooldowns.state;
      },
      // One certified tri-state for the Xunlai live scenario. No player,
      // account, pointer, or raw record leaves the snapshot decoder.
      get xunlaiAccess() {
        return companionState?.status === "ready"
          && typeof companionState.xunlaiAccess === "boolean"
          ? companionState.xunlaiAccess
          : null;
      },
    };
    // The observer program is the one explicit harness capability. Toolbox
    // publishes projections only: it cannot read arbitrary game addresses or
    // mutate the hook after installation. The commands program adds exactly
    // one function to that surface, and it takes a hero id rather than a
    // message.
    const runtime = Object.freeze(program === "target-observer"
      ? Object.assign(runtimeProjection, {
          setHookEnabledForBenchmark(enabled: boolean) {
            if (cleaned || table.get(manifest.tableSlot) !== installedCallback) {
              throw new Error("Enhancement installation is no longer active");
            }
            hookSlot.value = enabled
              ? manifest.tableSlot + 1
              : 0;
          },
        })
      : commands === null
        ? runtimeProjection
        : Object.assign(runtimeProjection, commands));
    installedRuntime = runtime;
    // The retry loop rides the observer's own cadence: it runs exactly when
    // the consumer polls, and pauses with it when the page is hidden.
    const polledCursor = cursor === null ? null : {
      poll: () => {
        cursor.poll();
        hiddenRetry?.afterPoll(cursor.state);
      },
    };
    stopObserver = observeCompanion(
      observerRuntime,
      polledCursor,
      observeState
        ? { update: (state) => {
            companionState = state;
            const next: RuntimePlayRegion = state.status === "ready"
              && (state.playRegion === "pve" || state.playRegion === "pvp")
              ? state.playRegion
              : "unknown";
            if (next !== snapshotPlayRegion) {
              snapshotPlayRegion = next;
              tracePolicy("region");
              setTargetEnabled();
              syncSkillOverlays();
              syncActiveObservers();
            }
            readout?.update(state);
            syncStoragePolicy();
            syncTravelPolicy();
            pollTradeAlias();
          } }
        : null,
      foundation
        ? { update: (state) => {
            toolboxObservation = state;
            professionTrace?.poll(state);
            const party = state.party;
            const next: RuntimePlayRegion = state.status === "ready"
              && party?.status === "ready"
              && (party.playRegion === "pve" || party.playRegion === "pvp")
              ? party.playRegion
              : "unknown";
            const previousRegion = playRegion();
            if (next !== partyPlayRegion) {
              partyPlayRegion = next;
            }
            if (playRegion() !== previousRegion) {
              tracePolicy("region");
              setTargetEnabled();
              syncSkillOverlays();
              syncActiveObservers();
            }
            syncTravelPolicy();
            pollTradeAlias();
            toolbox?.update(state);
          } }
        : null,
      observeState,
      publishObserverState,
      skillSlotGeometry.sink,
      skillCooldowns.sink,
    );
    companionInstallations = installation;
    if (program !== "none") window.gwCompanionRuntime = runtime;
    hookSlot.value = manifest.tableSlot + 1;
    // Mount local product UI only after the callback and hook are published.
    // This keeps installation atomic while allowing the saved Build/Team
    // library to remain available before a live game region is known.
    syncToolboxAvailability();

    window.addEventListener("pagehide", cleanupAfterPageHide, { once: true });
    console.info(
      `[enhancement] installed for client build ${manifest.buildId}; ` +
      `companion ABI ${COMPANION_ABI} ${kernelSha256.slice(0, 12)}`,
    );
    const capabilityProfile = enhancementCapabilityProfile(capabilities);
    if (capabilityProfile !== null) {
      telemetryInstalled = true;
      recordMilestone("enhancement.installed", {
        companionAbi: COMPANION_ABI,
        installation,
        capabilityProfile,
      });
    }
    return runtime;
  } catch (error) {
    const cleanupFailures = [...cleanup()];
    try {
      recordMilestone("enhancement.installFailed");
    } catch (cause) {
      cleanupFailures.push(new Error(
        "Companion installation failure telemetry could not be recorded",
        { cause },
      ));
    }
    if (publishObserverState) {
      try {
        window.gwCompanionState = Object.freeze({
          status: "error",
          reason: error instanceof Error ? error.message : String(error),
        });
      } catch (cause) {
        cleanupFailures.push(new Error(
          "Companion installation failure state could not be published",
          { cause },
        ));
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
    throw error;
  }
}
