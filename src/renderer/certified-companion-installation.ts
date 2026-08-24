/**
 * Installs the companion kernel into the running client: verifies the exports
 * it needs, allocates its shared memory, hands it the manifest's config, and
 * starts the observer.
 *
 * Host prerequisites are checked before allocation. Later initialization is a
 * transaction: a failure releases every resource proved unreachable by the
 * current observer and callback safety barriers before it rethrows. A module
 * that carries no decodable manifest, or that lacks an export the kernel needs,
 * gets no kernel at all rather than a partial one.
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
  type CompanionSnapshot,
} from "./companion-snapshot.js";
import { createPlayRegionObservationInstallation } from "./play-region-state-installation.js";
import { createSkillOverlaysInstallation } from "./skill-overlays-installation.js";
import {
  validateCompanionOwnedRegions,
} from "./companion-owned-regions.js";
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
import { installCompanionKernel } from "./companion-kernel-loader.js";
import { allocateCompanionCoreMemory } from "./companion-core-memory-installation.js";
import { createCompanionPolicySource } from "./companion-policy-source.js";
import {
  createProfessionCommandTrace,
  type ProfessionCommandTraceReader,
} from "./profession-command-trace.js";

const COMPANION_ABI = COMPANION_DESCRIPTOR.kernel;
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
  const playRegions = createPlayRegionObservationInstallation(
    capabilities.playRegionObservation,
  );
  const observeState = capabilities.targetObservation || capabilities.xunlaiAction;
  const publishObserverState = program === "target-observer";
  const featureFlags =
    (capabilities.nativeCursor ? COMPANION_FEATURE_BITS.nativeCursor : 0)
    | (observeState ? COMPANION_FEATURE_BITS.gameSnapshot : 0)
    | (foundation ? COMPANION_FEATURE_BITS.toolboxFoundation : 0)
    | (capabilities.playRegionObservation
      ? COMPANION_FEATURE_BITS.playRegionObservation
      : 0)
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
  // as the bare `Function`. Name its ABI before handing it to the allocation
  // owners and the cleanup transaction.
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

  let coreMemory: ReturnType<typeof allocateCompanionCoreMemory> | null = null;
  let stopObserver = () => {};
  let disposeCursor = () => {};
  let disposeReadout = () => {};
  let disposeToolbox = () => {};
  let disposePolicySource = () => {};
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
    // Withdraw policy inputs before disposing any surface. Region withdrawal
    // notifies subscribers synchronously; leaving this subscription live could
    // recreate a readout or overlay during the same teardown transaction.
    attempt("policy source disposal", disposePolicySource);
    const cursorStateWithdrawn = attempt("cursor state withdrawal", () => {
      if (
        installedCursorState !== null
        && window.gwCursorState === installedCursorState
      ) {
        delete window.gwCursorState;
      }
    });
    const observerStopped = attempt("observer disposal", stopObserver);
    // Cursor refresh owns DOM listeners that call cursorEventCount(), which
    // reads the kernel runtime allocation. Its disposal is therefore an
    // independent runtime-memory barrier, not a consequence of stopping the
    // animation-frame observer.
    const cursorRefreshDisposed = attempt(
      "cursor refresh disposal",
      disposeCursorRefresh,
    );
    if (observerStopped) {
      attempt("cursor disposal", disposeCursor);
      attempt("target readout disposal", disposeReadout);
      attempt("Toolbox disposal", disposeToolbox);
      attempt("skill overlay disposal", skills.disposePresentation);
      attempt("skill-slot feed disposal", skillSlotGeometry.dispose);
      attempt("skill cooldown feed disposal", skillCooldowns.dispose);
      attempt("play-region feed disposal", playRegions.dispose);
    }
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
        attempt("core observer memory release", () => {
          coreMemory?.releaseObserverMemory();
        });
        attempt("skill-slot allocation release", () => skillSlotGeometry.release(free));
        attempt("skill cooldown allocation release", () => skillCooldowns.release(free));
        attempt("play-region allocation release", () => playRegions.release(free));
      }
      attempt("storage disposal", () => storageInstallation?.dispose(free));
      attempt("Travel disposal", () => travelInstallation?.dispose(free));
      if (cursorRefreshDisposed) {
        attempt("core callback memory release", () => {
          coreMemory?.releaseCallbackMemory();
        });
      }
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
    coreMemory = allocateCompanionCoreMemory({
      memory,
      malloc: exports.malloc as (bytes: number) => unknown,
      free,
      configWords: manifest.configWords,
      needs: {
        snapshot: observeState,
        cursor: capabilities.nativeCursor,
        toolbox: foundation,
        commandPayloadBytes: capabilities.teamApply
          ? teamCommands!.TEAM_COMMAND_PAYLOAD_BYTES
          : 0,
        professionTrace:
          capabilities.teamApply && window.gwNative.init.development,
      },
    });
    const core = coreMemory;
    skillSlotGeometry.allocate(exports.malloc as (bytes: number) => unknown);
    skillCooldowns.allocate(exports.malloc as (bytes: number) => unknown);
    playRegions.allocate(exports.malloc as (bytes: number) => unknown);
    storageInstallation?.allocate(exports.malloc as (bytes: number) => unknown);
    travelInstallation?.allocate(exports.malloc as (bytes: number) => unknown);
    if (
      !skillSlotGeometry.allocated
      || !skillCooldowns.allocated
      || !playRegions.allocated
      || (storageInstallation !== null && !storageInstallation.region().pointer)
      || (travelInstallation !== null && !travelInstallation.region().pointer)
    ) {
      throw new Error("Companion allocation failed");
    }
    const ownedRegions = [
      ...core.regions,
      ...(skillSlotGeometry.region === null ? [] : [skillSlotGeometry.region]),
      ...(skillCooldowns.region === null ? [] : [skillCooldowns.region]),
      ...(playRegions.region === null ? [] : [playRegions.region]),
      ...(storageInstallation === null ? [] : [storageInstallation.region()]),
      ...(travelInstallation === null ? [] : [travelInstallation.region()]),
    ];
    validateCompanionOwnedRegions(ownedRegions, memory.buffer.byteLength);
    core.initialize();
    storageInstallation?.initialize(memory);
    travelInstallation?.initialize();

    const kernel = await installCompanionKernel({
      memory,
      runtimePointer: core.runtimePointer,
      featureFlags,
      regions: {
        snapshot: core.snapshot,
        config: core.config,
        cursor: core.cursor,
        toolbox: core.toolbox,
        party: core.party,
        skillSlots: {
          pointer: skillSlotGeometry.pointer,
          bytes: skillSlotGeometry.bytes,
        },
        skillCooldowns: {
          pointer: skillCooldowns.pointer,
          bytes: skillCooldowns.bytes,
        },
        playRegion: {
          pointer: playRegions.pointer,
          bytes: playRegions.bytes,
        },
      },
    });
    const kernelSha256 = kernel.sha256;
    const kernelDispatch = kernel.dispatch;
    const cursorEventCount = kernel.cursorEventCount;

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
        cursorPointer: core.cursor.pointer,
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
    const policySource = createCompanionPolicySource({
      program,
      readSettings: window.gwToolsSettings,
      settingsEvents: window,
      readPlayRegion: () => playRegions.state,
      subscribePlayRegion: playRegions.subscribe,
    });
    disposePolicySource = policySource.dispose;
    const policySnapshot = () => policySource.snapshot;
    skills.mount(document.body, policySnapshot().settings);
    const configureTradeAlias = () => {
      configureTradeToggle?.(policySnapshot().settings.gwonmacTools ? 1 : 0);
    };
    const pollTradeAlias = () => {
      if (takeTradeToggle?.() === 1 && policySnapshot().settings.gwonmacTools) {
        window.dispatchEvent(new CustomEvent("gw:trade-toggle"));
      }
    };
    let readout: ReturnType<typeof createTargetReadout> | null = null;
    const playRegion = () => policySnapshot().playRegion;
    const policy = () => policySnapshot().policy;
    let lastPolicyTrace = "";
    const tracePolicy = (reason: "launch" | "region" | "settings") => {
      if (!window.gwNative.init.development) return;
      const active = policy();
      const summary = {
        program,
        playRegion: playRegion(),
        nativeCursor: capabilities.nativeCursor,
        teamManagement: active.teamApply,
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
      policySnapshot().settings,
      policy(),
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
    const teamEnabled = () => policy().teamApply;
    const syncActiveObservers = () => {
      const active =
        (capabilities.nativeCursor ? COMPANION_FEATURE_BITS.nativeCursor : 0)
        | (foundation && policy().tools
          ? COMPANION_FEATURE_BITS.toolboxFoundation
          : 0)
        // Keep only the bounded policy observer alive while optional UI and
        // commands are denied. It lets unknown/loading recover without the
        // heavier party observer or a restart.
        | (capabilities.playRegionObservation
          ? COMPANION_FEATURE_BITS.playRegionObservation
          : 0)
        | (targetEnabled() ? COMPANION_FEATURE_BITS.targetObservation : 0)
        | skills.activeFeatureFlags;
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
      payloadPointer: core.commandPayloadPointer,
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
        playRegion: playRegion(),
        state: companionState,
      });
    };
    const syncTravelPolicy = () => {
      travelInstallation?.update({
        enabled: policy().travel,
        playRegion: playRegion(),
        state: travelGameState(policySnapshot().playRegionState),
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
    if (core.professionTracePointer !== 0 && professionTraceReader !== null) {
      professionTrace = createProfessionCommandTrace(
        memory,
        core.professionTracePointer,
        professionTraceReader,
      );
    }
    const syncToolboxAvailability = () => {
      toolbox?.setEnabled(policy().tools);
    };
    const syncLivePolicyConsumers = () => {
      setTargetEnabled();
      syncSkillOverlays();
      syncActiveObservers();
      syncStoragePolicy();
      syncTravelPolicy();
    };
    const syncPolicySurfaces = (reason: "region" | "settings") => {
      tracePolicy(reason);
      syncToolboxAvailability();
      syncLivePolicyConsumers();
    };
    disposeToolbox = () => {
      toolbox?.dispose();
    };

    // Apply opt-in state before the callback becomes reachable from the game.
    playRegions.setActive(true);
    policySource.subscribe(({ reason }) => {
      if (reason === "launch") {
        tracePolicy(reason);
        syncLivePolicyConsumers();
        configureTradeAlias();
        return;
      }
      syncPolicySurfaces(reason);
      if (reason === "settings") configureTradeAlias();
    });
    table.set(manifest.tableSlot, kernelDispatch);
    installedCallback = kernelDispatch;
    const observerRuntime = {
      memory,
      snapshotPointer: core.snapshot.pointer,
      toolboxPointer: core.toolbox.pointer,
      partyPointer: core.party.pointer,
      skillSlotPointer: skillSlotGeometry.pointer,
      skillCooldownPointer: skillCooldowns.pointer,
      playRegionPointer: playRegions.pointer,
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
      [polledCursor, travelInstallation].filter(
        (poller): poller is { poll(): void } => poller !== null,
      ),
      observeState
          ? { update: (state) => {
            companionState = state;
            readout?.update(state);
            syncStoragePolicy();
            pollTradeAlias();
          } }
        : null,
      foundation
        ? { update: (state) => {
            toolboxObservation = state;
            professionTrace?.poll(state);
            pollTradeAlias();
            toolbox?.update(state);
          } }
        : null,
      observeState,
      publishObserverState,
      skillSlotGeometry.sink,
      skillCooldowns.sink,
      playRegions.sink,
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
