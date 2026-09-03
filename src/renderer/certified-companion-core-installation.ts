/**
 * Installs only the required cursor, play-region, and pre-game companion
 * behavior. Optional Tools modules must never be imported from this graph.
 */
import {
  enhancementCapabilityProfile,
  type EnhancementCapabilities,
  type EnhancementProgram,
} from "../shared/enhancement-contracts.js";
import { COMPANION_ABI, COMPANION_FEATURE_BITS } from "../shared/companion-abi.js";
import { CHARACTER_SWITCH_ACTION_ABI } from "../shared/character-switch-action-abi.js";
import type {
  EnhancementObserverConsumer,
  RendererMilestone,
  RendererMilestoneFields,
} from "../shared/diagnostics.js";
import { allocateCompanionCoreMemory } from "./companion-core-memory-installation.js";
import { installCompanionKernel } from "./companion-kernel-loader.js";
import { validateCompanionOwnedRegions } from "./companion-owned-regions.js";
import { observeCompanion, recordCompanionLifecycle } from "./companion-observer.js";
import { createCursorConsumer } from "./enhancement-cursor.js";
import {
  createHiddenCursorRetry,
  installCursorRefresh,
  type HiddenCursorRetry,
} from "./cursor-refresh.js";
import { decodeEnhancementManifest } from "./enhancement-manifest.js";
import { createPlayRegionObservationInstallation } from "./play-region-state-installation.js";
import type {
  CompanionExtensionSession,
  PrepareCompanionExtension,
  PreparedCompanionExtension,
} from "./certified-companion-extension.js";
import {
  sameCharacterListPresentation,
  type CompanionCharacterListState,
} from "./companion-character-list-snapshot.js";
import {
  createCharacterSwitchController,
  type CharacterSwitchController,
} from "./character-switch-controller.js";

let coreInstallations = 0;

const recordMilestone = (
  name: RendererMilestone,
  fields?: RendererMilestoneFields,
) => {
  void window.gwNative.diagnostics
    .recordRendererMilestone(name, performance.now() * 1_000, fields)
    .catch(() => {});
};

function percentile95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

export async function installCoreCertifiedCompanion(
  instance: WebAssembly.Instance,
  module: WebAssembly.Module,
  capabilities: EnhancementCapabilities,
  program: EnhancementProgram = "none",
  prepareExtension?: PrepareCompanionExtension,
) {
  const coreFeatureFlags =
    (capabilities.nativeCursor ? COMPANION_FEATURE_BITS.nativeCursor : 0)
    | (capabilities.playRegionObservation
      ? COMPANION_FEATURE_BITS.playRegionObservation
      : 0);
  const characterListFeature = capabilities.preGameControls
    ? COMPANION_FEATURE_BITS.characterList
    : 0;
  const manifest = decodeEnhancementManifest(module, capabilities);
  const exports = instance.exports;
  if (
    !manifest
    || !(exports.memory instanceof WebAssembly.Memory)
    || !(exports.__indirect_function_table instanceof WebAssembly.Table)
    || typeof exports.malloc !== "function"
    || typeof exports.free !== "function"
    || !(exports.enhancement_hook_slot instanceof WebAssembly.Global)
  ) {
    const state = Object.freeze({ status: "unsupported" } as const);
    recordCompanionLifecycle(state);
    if (program === "target-observer") window.gwCompanionState = state;
    recordMilestone("enhancement.installFailed");
    return null;
  }

  const memory = exports.memory;
  const table = exports.__indirect_function_table;
  const hookSlot = exports.enhancement_hook_slot;
  const malloc = exports.malloc as (bytes: number) => unknown;
  const free = exports.free as (pointer: number) => void;
  let extension: PreparedCompanionExtension | null = null;
  let extensionSession: CompanionExtensionSession | null = null;
  const preGameStateReader = capabilities.preGameControls
    && typeof exports.enhancement_pre_game_state === "function"
    ? exports.enhancement_pre_game_state as () => number
    : null;
  const preGameDiagnosticReader = capabilities.preGameControls
    && typeof exports.enhancement_pre_game_diagnostic === "function"
    ? exports.enhancement_pre_game_diagnostic as () => number
    : null;
  const characterActionEnqueue = capabilities.characterSwitchAction
    && typeof exports.enhancement_character_action === "function"
    ? exports.enhancement_character_action as (action: number, argument: number) => number
    : null;
  const characterActionConfigure = capabilities.characterSwitchAction
    && typeof exports.enhancement_configure_character_action === "function"
    ? exports.enhancement_configure_character_action as (payload: number, enabled: number) => number
    : null;
  if (capabilities.preGameControls
    && (preGameStateReader === null || preGameDiagnosticReader === null)) {
    throw new Error("the pre-game profile derived a module with incomplete readers");
  }
  if (capabilities.characterSwitchAction
    && (characterActionEnqueue === null || characterActionConfigure === null)) {
    throw new Error("the character-switch profile derived an incomplete action");
  }
  if (manifest.tableSlot >= table.length) {
    throw new Error(`Enhancement table slot ${manifest.tableSlot} is out of bounds`);
  }
  if (table.get(manifest.tableSlot) !== null) {
    throw new Error(`Enhancement table slot ${manifest.tableSlot} is occupied`);
  }
  if (hookSlot.value !== 0) throw new Error("Enhancement hook is already enabled");
  try {
    hookSlot.value = 0;
  } catch {
    throw new Error("Enhancement hook global is immutable");
  }
  extension = prepareExtension === undefined
    ? null
    : await prepareExtension(exports, module, capabilities, program);
  const featureFlags = coreFeatureFlags | characterListFeature | (extension?.featureFlags ?? 0);
  if (featureFlags === 0) return null;

  const playRegions = createPlayRegionObservationInstallation(
    capabilities.playRegionObservation,
  );
  let coreMemory: ReturnType<typeof allocateCompanionCoreMemory> | null = null;
  let stopObserver = () => {};
  let disposeCursor = () => {};
  let disposeCursorRefresh = () => {};
  let installedCallback: CallableFunction | null = null;
  let installedCursorState: NonNullable<typeof window.gwCursorState> | null = null;
  let installedRuntime: object | null = null;
  let installedPreGameControls: PreGameControls | null = null;
  let installedCharacterList: CharacterListSource | null = null;
  let installedCharacterSwitch: CharacterSwitchController | null = null;
  let detachCharacterSwitch = () => {};
  let characterActionPointer = 0;
  let cleaned = false;
  let telemetryInstalled = false;

  const cleanup = (): readonly Error[] => {
    if (cleaned) return [];
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
    attempt("extension policy withdrawal", () => extensionSession?.withdrawPolicy());
    attempt("character-switch withdrawal", () => {
      detachCharacterSwitch();
      installedCharacterSwitch?.dispose();
      if (window.gwCharacterSwitch === installedCharacterSwitch) {
        window.gwCharacterSwitch = null;
      }
    });
    const cursorStateWithdrawn = attempt("cursor state withdrawal", () => {
      if (window.gwCursorState === installedCursorState) delete window.gwCursorState;
    });
    const observerStopped = attempt("observer disposal", stopObserver);
    const cursorRefreshDisposed = attempt(
      "cursor refresh disposal",
      disposeCursorRefresh,
    );
    if (observerStopped) {
      attempt("cursor disposal", disposeCursor);
      attempt("extension presentation disposal", () => {
        extensionSession?.disposePresentation();
      });
      attempt("play-region feed disposal", playRegions.dispose);
    }
    const callbackWithdrawn = attempt("callback withdrawal", () => {
      if (table.get(manifest.tableSlot) === installedCallback) {
        table.set(manifest.tableSlot, null);
      }
    });
    if (callbackWithdrawn) {
      if (observerStopped) {
        attempt("observer memory release", () => coreMemory?.releaseObserverMemory());
        attempt("extension observer memory release", () => {
          extensionSession?.releaseObserverMemory(free);
        });
        attempt("play-region allocation release", () => playRegions.release(free));
      }
      attempt("extension callback resource release", () => {
        if (extensionSession) extensionSession.releaseCallbackResources(free);
        else extension?.rollback(free);
      });
      attempt("character action memory release", () => {
        if (characterActionPointer !== 0) free(characterActionPointer);
        characterActionPointer = 0;
      });
      if (cursorRefreshDisposed) {
        attempt("callback memory release", () => coreMemory?.releaseCallbackMemory());
      }
    }
    attempt("runtime withdrawal", () => {
      if (window.gwCompanionRuntime === installedRuntime) {
        window.gwCompanionRuntime = null;
      }
    });
    attempt("pre-game controls withdrawal", () => {
      if (window.gwPreGameControls === installedPreGameControls) {
        window.gwPreGameControls = null;
      }
    });
    attempt("character-list withdrawal", () => {
      if (window.gwCharacterList === installedCharacterList) {
        window.gwCharacterList = null;
      }
      installedCharacterList?.dispose();
    });
    if (
      telemetryInstalled
      && observerStopped
      && cursorStateWithdrawn
      && callbackWithdrawn
      && failures.length === 0
    ) {
      telemetryInstalled = false;
      recordMilestone("enhancement.uninstalled", { installation: coreInstallations });
    }
    return failures;
  };
  const cleanupAfterPageHide = () => {
    const failures = cleanup();
    if (failures.length > 0) {
      console.error(
        "companion cleanup failed",
        new AggregateError(failures, "Companion cleanup was incomplete"),
      );
    }
  };

  try {
    coreMemory = allocateCompanionCoreMemory({
      memory,
      malloc,
      free,
      configWords: manifest.configWords,
      needs: {
        snapshot: extension?.memoryNeeds.snapshot ?? false,
        cursor: capabilities.nativeCursor,
        toolbox: extension?.memoryNeeds.toolbox ?? false,
        commandPayloadBytes: extension?.memoryNeeds.commandPayloadBytes ?? 0,
        professionTrace: extension?.memoryNeeds.professionTrace ?? false,
        professionTraceBytes: extension?.memoryNeeds.professionTraceBytes ?? 0,
        characterList: capabilities.preGameControls,
      },
    });
    const core = coreMemory;
    if (capabilities.characterSwitchAction) {
      characterActionPointer = Number(malloc(CHARACTER_SWITCH_ACTION_ABI.bytes));
      if (!Number.isInteger(characterActionPointer) || characterActionPointer <= 0) {
        throw new Error("Character action allocation failed");
      }
    }
    playRegions.allocate(malloc);
    extension?.allocate(malloc);
    if (!playRegions.allocated) throw new Error("Companion allocation failed");
    validateCompanionOwnedRegions([
      ...core.regions,
      ...(extension?.ownedRegions() ?? []),
      ...(playRegions.region === null ? [] : [playRegions.region]),
      ...(characterActionPointer === 0 ? [] : [{
        name: "character action payload",
        pointer: characterActionPointer,
        size: 40,
        align: 4 as const,
      }]),
    ], memory.buffer.byteLength);
    core.initialize();
    extension?.initialize(memory);

    const kernel = await installCompanionKernel({
      memory,
      runtimePointer: core.runtimePointer,
      featureFlags,
      friendRoot: extension?.kernelRegions.friendRoot ?? 0,
      regions: {
        snapshot: core.snapshot,
        config: core.config,
        cursor: core.cursor,
        toolbox: core.toolbox,
        party: core.party,
        skillSlots: extension?.kernelRegions.skillSlots ?? { pointer: 0, bytes: 0 },
        skillCooldowns: extension?.kernelRegions.skillCooldowns ?? { pointer: 0, bytes: 0 },
        friends: extension?.kernelRegions.friends ?? { pointer: 0, bytes: 0 },
        playRegion: { pointer: playRegions.pointer, bytes: playRegions.bytes },
        characterList: core.characterList,
      },
    });

    let cursorRefreshes = 0;
    const observedConsumers = new Set<EnhancementObserverConsumer>();
    const firstObservation = (consumer: EnhancementObserverConsumer) => {
      if (observedConsumers.has(consumer)) return;
      observedConsumers.add(consumer);
      recordMilestone("enhancement.consumerSignal", {
        consumer,
        signal: "first-observation",
      });
    };
    let hiddenRetry: HiddenCursorRetry | null = null;
    let cursor: ReturnType<typeof createCursorConsumer> | null = null;
    if (capabilities.nativeCursor) {
      const element = document.getElementById("canvas");
      if (!(element instanceof HTMLCanvasElement)) {
        throw new Error("Enhancement cursor target is missing");
      }
      const refresh = installCursorRefresh(
        element,
        () => Number(kernel.cursorEventCount()) >>> 0,
        () => { cursorRefreshes += 1; },
      );
      disposeCursorRefresh = refresh.dispose;
      hiddenRetry = createHiddenCursorRetry(refresh.retest);
      cursor = createCursorConsumer({
        element,
        memory,
        cursorPointer: core.cursor.pointer,
        fallback: "",
        transitionHold: () => !hiddenRetry!.expired && refresh.armed(),
      });
      disposeCursor = cursor.dispose;
      installedCursorState = () => cursor?.state ?? null;
      window.gwCursorState = installedCursorState;
    }

    extensionSession = extension?.activate({
      memory,
      exports,
      core,
      kernel,
      playRegions,
      capabilities,
      program,
      isCleaned: () => cleaned,
      hookInstalled: () => table.get(manifest.tableSlot) === installedCallback,
      setHookEnabled: (enabled) => {
        hookSlot.value = enabled ? manifest.tableSlot + 1 : 0;
      },
    }) ?? null;
    playRegions.setActive(true);
    extensionSession?.beforeHook();
    table.set(manifest.tableSlot, kernel.dispatch);
    installedCallback = kernel.dispatch;
    const observerRuntime = {
      memory,
      snapshotPointer: extensionSession?.observer.pointers.snapshot ?? 0,
      toolboxPointer: extensionSession?.observer.pointers.toolbox ?? 0,
      partyPointer: extensionSession?.observer.pointers.party ?? 0,
      skillSlotPointer: extensionSession?.observer.pointers.skillSlots ?? 0,
      skillCooldownPointer: extensionSession?.observer.pointers.skillCooldowns ?? 0,
      playRegionPointer: playRegions.pointer,
      characterListPointer: core.characterList.pointer,
      hertz: 0,
      lastRenderUs: 0,
      renderSamples: [] as number[],
      snapshotReads: 0,
      rejectedSnapshots: 0,
    };
    const polledCursor = cursor === null ? null : {
      poll: () => {
        cursor?.poll();
        if (cursor) hiddenRetry?.afterPoll(cursor.state);
        if (cursor?.state.valid) firstObservation("cursor");
      },
    };
    const characterListeners = new Set<(state: CompanionCharacterListState) => void>();
    let characterState: CompanionCharacterListState = Object.freeze({
      status: "waiting", reason: "memory",
    });
    installedCharacterList = Object.freeze({
      get state() { return characterState; },
      subscribe(listener: (state: CompanionCharacterListState) => void) {
        characterListeners.add(listener);
        listener(characterState);
        return () => characterListeners.delete(listener);
      },
      dispose() { characterListeners.clear(); },
    });
    window.gwCharacterList = installedCharacterList;
    const characterConsumer = capabilities.preGameControls ? {
      update(state: CompanionCharacterListState) {
        const previous = characterState;
        characterState = state;
        if (sameCharacterListPresentation(previous, state)) return;
        for (const listener of characterListeners) listener(state);
      },
    } : null;
    stopObserver = observeCompanion(
      observerRuntime,
      [
        ...(polledCursor === null ? [] : [polledCursor]),
        ...(extensionSession?.observer.pollers ?? []),
      ],
      extensionSession?.observer.state ?? null,
      extensionSession?.observer.toolbox ?? null,
      extensionSession?.observer.observeState ?? false,
      extensionSession?.observer.publishState ?? false,
      extensionSession?.observer.skillSlots ?? null,
      extensionSession?.observer.skillCooldowns ?? null,
      playRegions.sink,
      extensionSession?.observer.readers ?? null,
      firstObservation,
      characterConsumer,
    );

    const installation = coreInstallations + 1;
    const baseRuntime: CompanionDeveloperRuntime = {
      status: "installed" as const,
      buildId: manifest.buildId,
      programId: manifest.programId,
      companionAbi: COMPANION_ABI.kernel,
      kernelSha256: kernel.sha256,
      installation,
      get hertz() { return observerRuntime.hertz; },
      get lastRenderUs() { return observerRuntime.lastRenderUs; },
      get renderP95Us() { return percentile95(observerRuntime.renderSamples); },
      get snapshotReads() { return observerRuntime.snapshotReads; },
      get rejectedSnapshots() { return observerRuntime.rejectedSnapshots; },
      get cursorRefreshes() { return cursorRefreshes; },
      get cursorHiddenRetests() { return hiddenRetry?.retests ?? 0; },
      get cursorHiddenGapMs() { return hiddenRetry?.lastGapMs ?? null; },
      get wasmMemoryBytes() { return memory.buffer.byteLength; },
      get cursor() { return cursor?.state ?? null; },
      get readout() { return null; },
      get toolbox() { return null; },
      get xunlaiAccess() { return null; },
    };
    const runtime = Object.freeze(
      extensionSession?.createRuntime(baseRuntime) ?? baseRuntime,
    );
    installedRuntime = runtime;

    if (preGameStateReader) {
      const readPreGameState = (): PreGameState => {
        try {
          switch (Number(preGameStateReader()) >>> 0) {
            case 1: return "character-select";
            case 2: return "reconnect";
            case 3: return "loading";
            default: return "unknown";
          }
        } catch {
          return "unknown";
        }
      };
      installedPreGameControls = Object.freeze({
        state: readPreGameState,
        switchContext() {
          const preGame = readPreGameState();
          if (preGame === "character-select") return "character-select";
          if (preGame === "reconnect" || preGame === "loading") return "loading";
          const state = playRegions.state;
          if (state.status !== "ready") return "unavailable";
          if (state.instanceType === 0) return "outpost";
          if (state.instanceType !== 1) return "unavailable";
          return state.playRegion === "pve" ? "pve-explorable" : "pvp-explorable";
        },
        diagnosticMask() {
          try {
            return Number(preGameDiagnosticReader!()) >>> 0;
          } catch {
            return 0x8000_0000;
          }
        },
      });
      window.gwPreGameControls = installedPreGameControls;
    }
    if (
      installedPreGameControls
      && installedCharacterList
      && characterActionEnqueue
      && characterActionConfigure
      && characterActionPointer !== 0
    ) {
      new Uint8Array(
        memory.buffer,
        characterActionPointer,
        CHARACTER_SWITCH_ACTION_ABI.bytes,
      ).fill(0);
      installedCharacterSwitch = createCharacterSwitchController({
        memory,
        payloadPointer: characterActionPointer,
        enqueue: characterActionEnqueue,
        configure: characterActionConfigure,
        characters: installedCharacterList,
        controls: installedPreGameControls,
        buildId: manifest.buildId,
        programId: manifest.programId,
      });
      window.gwCharacterSwitch = installedCharacterSwitch;
      detachCharacterSwitch = window.gwCharacterSwitchHost?.attach(
        installedCharacterSwitch,
      ) ?? (() => {});
    }

    coreInstallations = installation;
    if (program !== "none") window.gwCompanionRuntime = runtime;
    hookSlot.value = manifest.tableSlot + 1;
    extensionSession?.afterHook();
    const installedConsumers: readonly [boolean, EnhancementObserverConsumer][] = [
      [capabilities.nativeCursor, "cursor"],
      [capabilities.playRegionObservation, "region"],
      [capabilities.targetObservation, "target"],
      [capabilities.partyObservation, "party"],
      [capabilities.skillSlotGeometry, "skill-geometry"],
      [capabilities.skillCooldownObservation, "cooldowns"],
    ];
    for (const [installed, consumer] of installedConsumers) {
      if (installed) recordMilestone("enhancement.consumerSignal", {
        consumer,
        signal: "installed",
      });
    }
    window.addEventListener("pagehide", cleanupAfterPageHide, { once: true });
    const capabilityProfile = enhancementCapabilityProfile(capabilities);
    if (capabilityProfile !== null) {
      telemetryInstalled = true;
      recordMilestone("enhancement.installed", {
        companionAbi: COMPANION_ABI.kernel,
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
    if (program === "target-observer") {
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
