/**
 * Prepares the optional half of a certified companion installation. Core owns
 * the shared kernel transaction and calls this extension only in Tools mode.
 */
import { COMPANION_DISPATCH_KINDS, COMPANION_FEATURE_BITS } from "../shared/companion-abi.js";
import type { EnhancementCapabilities, EnhancementProgram } from "../shared/enhancement-contracts.js";
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import type { CompanionSnapshot } from "./companion-snapshot.js";
import type { CompanionSkillSlotState } from "./companion-skill-snapshot.js";
import type { EnhancementCommandEnqueue } from "./enhancement-team-commands.js";
import type * as TeamCommandsModule from "./enhancement-team-commands.js";
import type { ProfessionCommandTraceReader } from "./profession-command-trace.js";
import type { StorageInstallation } from "./enhancement-storage-installation.js";
import type { TravelInstallation } from "./enhancement-travel-installation.js";
import type {
  CompanionExtensionActivation,
  CompanionExtensionSession,
  PreparedCompanionExtension,
} from "./certified-companion-extension.js";
import {
  setSkillCooldownReadiness,
  setSkillGeometryReadiness,
} from "./observer-readiness.js";
import * as tools from "./certified-companion-tools.js";

const EMPTY_REGION = Object.freeze({ pointer: 0, bytes: 0 });

function runCleanupSteps(
  message: string,
  steps: readonly (() => void)[],
): void {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, message);
}

function reportSkillGeometry(state: CompanionSkillSlotState): void {
  const readiness = state.status === "ready"
    ? Object.freeze({ status: "ready" as const })
    : Object.freeze({ status: "waiting" as const, reason: state.reason });
  if (!setSkillGeometryReadiness(readiness)) return;
  const fields = state.status === "ready"
    ? { state: "ready" as const, reason: null, candidates: null }
    : {
      state: "waiting" as const,
      reason: state.reason,
      candidates: "candidateCount" in state ? state.candidateCount : null,
    };
  void window.gwNative.diagnostics.recordRendererMilestone(
    "enhancement.skillGeometryState",
    performance.now() * 1_000,
    fields,
  ).catch(() => {});
}

export async function prepareToolsCompanionExtension(
  exports: WebAssembly.Exports,
  capabilities: EnhancementCapabilities,
  program: EnhancementProgram,
): Promise<PreparedCompanionExtension> {
  const foundation = capabilities.partyObservation;
  const observeState = capabilities.targetObservation || capabilities.xunlaiAction;
  const skills = tools.createSkillOverlaysInstallation(capabilities);
  const slots = skills.geometry;
  const cooldowns = skills.cooldowns;
  const enqueue = capabilities.teamApply && typeof exports.enhancement_command === "function"
    ? exports.enhancement_command as EnhancementCommandEnqueue : null;
  const traceReader = capabilities.teamApply
    && typeof exports.enhancement_profession_trace === "function"
    ? exports.enhancement_profession_trace as ProfessionCommandTraceReader : null;
  if (capabilities.teamApply && enqueue === null) {
    throw new Error("the commands profile derived a module with no command queue");
  }
  if (capabilities.teamApply && traceReader === null) {
    throw new Error("the commands profile derived a module with no profession trace");
  }
  const teamCommands = capabilities.teamApply
    ? await import("./enhancement-team-commands.js") : null;
  const storage: StorageInstallation | null = capabilities.xunlaiAction
    ? (await import("./enhancement-storage-installation.js"))
        .createStorageInstallation(exports, true, window.gwNative.init.development)
    : null;
  const travel: TravelInstallation | null = capabilities.travelAction
    ? (await import("./enhancement-travel-installation.js"))
        .createTravelInstallation(exports, true) : null;
  const configureTrade = capabilities.chatAliases
    && typeof exports.enhancement_configure_trade_toggle === "function"
    ? exports.enhancement_configure_trade_toggle as (enabled: number) => number : null;
  const takeTrade = capabilities.chatAliases
    && typeof exports.enhancement_take_trade_toggle === "function"
    ? exports.enhancement_take_trade_toggle as () => number : null;
  if (capabilities.chatAliases && (!configureTrade || !takeTrade)) {
    throw new Error("the aliases profile derived a module with no Trade Chat toggle");
  }
  let allocated = false;
  let activated = false;
  return Object.freeze({
    featureFlags:
      (observeState ? COMPANION_FEATURE_BITS.gameSnapshot : 0)
      | (foundation ? COMPANION_FEATURE_BITS.toolboxFoundation : 0)
      | (capabilities.targetObservation ? COMPANION_FEATURE_BITS.targetObservation : 0)
      | skills.certifiedFeatureFlags,
    memoryNeeds: {
      snapshot: observeState,
      toolbox: foundation,
      commandPayloadBytes: capabilities.teamApply
        ? teamCommands!.TEAM_COMMAND_PAYLOAD_BYTES : 0,
      professionTrace: capabilities.teamApply && window.gwNative.init.development,
      professionTraceBytes: tools.PROFESSION_COMMAND_TRACE_BYTES,
    },
    allocate(malloc) {
      allocated = true;
      slots?.allocate(malloc);
      cooldowns?.allocate(malloc);
      storage?.allocate(malloc);
      travel?.allocate(malloc);
      if ((slots !== null && !slots.allocated)
        || (cooldowns !== null && !cooldowns.allocated)
        || (storage !== null && !storage.region().pointer)
        || (travel !== null && !travel.region().pointer)) {
        throw new Error("Companion Tools allocation failed");
      }
    },
    initialize(memory) { storage?.initialize(memory); travel?.initialize(); },
    ownedRegions: () => [
      ...(slots?.region == null ? [] : [slots.region]),
      ...(cooldowns?.region == null ? [] : [cooldowns.region]),
      ...(storage === null ? [] : [storage.region()]),
      ...(travel === null ? [] : [travel.region()]),
    ],
    kernelRegions: {
      get skillSlots() {
        return slots === null ? EMPTY_REGION : { pointer: slots.pointer, bytes: slots.bytes };
      },
      get skillCooldowns() {
        return cooldowns === null
          ? EMPTY_REGION : { pointer: cooldowns.pointer, bytes: cooldowns.bytes };
      },
    },
    activate(context) {
      const session = activateTools({ context, capabilities, program, foundation, observeState,
        skills, slots, cooldowns, enqueue, traceReader, teamCommands, storage,
        travel, configureTrade, takeTrade });
      activated = true;
      return session;
    },
    rollback(free) {
      if (!allocated || activated) return;
      runCleanupSteps("Companion Tools allocation rollback failed", [
        () => slots?.release(free),
        () => cooldowns?.release(free),
        () => storage?.dispose(free),
        () => travel?.dispose(free),
      ]);
    },
  });
}

type ToolsInput = Readonly<{
  context: CompanionExtensionActivation;
  capabilities: EnhancementCapabilities;
  program: EnhancementProgram;
  foundation: boolean;
  observeState: boolean;
  skills: ReturnType<typeof tools.createSkillOverlaysInstallation>;
  slots: ReturnType<typeof tools.createSkillOverlaysInstallation>["geometry"];
  cooldowns: ReturnType<typeof tools.createSkillOverlaysInstallation>["cooldowns"];
  enqueue: EnhancementCommandEnqueue | null;
  traceReader: ProfessionCommandTraceReader | null;
  teamCommands: typeof TeamCommandsModule | null;
  storage: StorageInstallation | null;
  travel: TravelInstallation | null;
  configureTrade: ((enabled: number) => number) | null;
  takeTrade: (() => number) | null;
}>;

function activateTools(input: ToolsInput): CompanionExtensionSession {
  const { context, capabilities, program, foundation, observeState, skills,
    slots, cooldowns, enqueue, traceReader, teamCommands, storage, travel,
    configureTrade, takeTrade } = input;
  const { memory, core, kernel, playRegions } = context;
  const source = tools.createCompanionPolicySource({
    program,
    readSettings: window.gwToolsSettings,
    settingsEvents: window,
    readPlayRegion: () => playRegions.state,
    subscribePlayRegion: playRegions.subscribe,
  });
  const snapshot = () => source.snapshot;
  const policy = () => snapshot().policy;
  const playRegion = () => snapshot().playRegion;
  let companionState: CompanionSnapshot | null = null;
  let party: ToolboxObservation | null = null;
  let readout: ReturnType<typeof tools.createTargetReadout> | null = null;
  let toolbox: ReturnType<typeof tools.createToolboxLifecycle> | null = null;
  let professionTrace: ReturnType<typeof tools.createProfessionCommandTrace> | null = null;
  let aliasEnabled: boolean | null = null;
  let lastTrace = "";
  const disposePresentation = () => runCleanupSteps(
    "Companion Tools presentation cleanup failed",
    [
      () => { readout?.dispose(); readout = null; },
      () => toolbox?.dispose(),
      () => skills.disposePresentation(),
      () => slots?.dispose(),
      () => cooldowns?.dispose(),
      () => { configureTrade?.(0); },
      () => professionTrace?.dispose(),
    ],
  );
  const abortActivation = (cause: unknown): never => {
    const failures: unknown[] = [cause];
    for (const cleanup of [() => source.dispose(), disposePresentation]) {
      try {
        cleanup();
      } catch (cleanupCause) {
        failures.push(cleanupCause);
      }
    }
    throw failures.length === 1
      ? cause
      : new AggregateError(failures, "Companion Tools activation cleanup failed", {
          cause,
        });
  };
  const prepare = <Value>(operation: () => Value): Value => {
    try {
      return operation();
    } catch (cause) {
      return abortActivation(cause);
    }
  };

  prepare(() => skills.mount(document.body, snapshot().settings));

  const commands = enqueue === null ? null : teamCommands!.createTeamApplyCommands({
    memory,
    payloadPointer: core.commandPayloadPointer,
    send: enqueue,
    development: window.gwNative.init.development,
    ready: () => {
      if (context.isCleaned()) throw new Error("Enhancement installation is no longer active");
      if (!policy().teamApply) throw new Error("Apply team is disabled");
      if (playRegion() !== "pve") {
        throw new Error(playRegion() === "pvp"
          ? "GWonMac Tools are unavailable during PvP play"
          : "GWonMac Tools are unavailable while the region is unknown");
      }
      if (party === null || party.status !== "ready") {
        throw new Error("no party has been observed yet");
      }
      if (party.party?.playRegion !== "pve") {
        throw new Error("team commands require a confirmed supported party");
      }
      if (party.party?.inOutpost !== true) {
        throw new Error("team commands require a confirmed supported outpost");
      }
      return party;
    },
  });
  const syncAlias = () => {
    const enabled = policy().tradeChat;
    if (enabled === aliasEnabled) return;
    configureTrade?.(enabled ? 1 : 0);
    // A region/settings transition can withdraw Trade after the native hook
    // has already published one toggle. Consume that stale edge while closing
    // the gate so it cannot reopen Trade if the feature becomes available
    // again before another hook dispatch.
    if (!enabled) takeTrade?.();
    aliasEnabled = enabled;
  };
  const pollAlias = () => {
    if (policy().tradeChat && takeTrade?.() === 1) {
      window.dispatchEvent(new CustomEvent("gw:trade-toggle"));
    }
  };
  const syncTarget = () => {
    if (!observeState) return;
    if (policy().targetReadout) readout ??= tools.createTargetReadout(document.body);
    else { readout?.dispose(); readout = null; }
  };
  const syncObservers = () => kernel.dispatch(
    COMPANION_DISPATCH_KINDS.activeFeatures,
    (capabilities.nativeCursor ? COMPANION_FEATURE_BITS.nativeCursor : 0)
      | (foundation && policy().tools ? COMPANION_FEATURE_BITS.toolboxFoundation : 0)
      | (capabilities.playRegionObservation ? COMPANION_FEATURE_BITS.playRegionObservation : 0)
      | (policy().targetReadout ? COMPANION_FEATURE_BITS.targetObservation : 0)
      | skills.activeFeatureFlags,
    0, 0, 0, 0,
  );
  const syncStorage = () => storage?.update({
    enabled: policy().xunlaiStorage, playRegion: playRegion(), state: companionState,
  });
  const syncTravel = () => travel?.update({
    enabled: policy().travel,
    playRegion: playRegion(),
    state: tools.travelGameState(snapshot().playRegionState),
  });
  const syncToolbox = () => {
    toolbox?.setEnabled(policy().tools);
    toolbox?.setAvailable({ builds: policy().buildLibrary, trade: policy().tradeChat });
  };
  const tracePolicy = (reason: "launch" | "region" | "settings") => {
    if (!window.gwNative.init.development) return;
    const summary = { program, playRegion: playRegion(), nativeCursor: capabilities.nativeCursor,
      teamApply: policy().teamApply, xunlaiStorage: policy().xunlaiStorage,
      targetReadout: policy().targetReadout, commands: commands !== null };
    const signature = JSON.stringify(summary);
    if (signature === lastTrace) return;
    lastTrace = signature;
    console.debug(`[tools:dev] policy ${JSON.stringify({ reason, ...summary })}`);
  };
  const syncConsumers = () => {
    syncTarget();
    skills.sync(snapshot().settings, policy());
    syncObservers();
    syncStorage();
    syncTravel();
  };
  const syncPolicy = (reason: "region" | "settings") => {
    tracePolicy(reason); syncToolbox(); syncConsumers(); syncAlias();
  };

  prepare(() => storage?.mount());
  prepare(() => travel?.mount(document.body));
  const storageCommand = storage?.command() ?? null;
  toolbox = foundation ? prepare(() => tools.createToolboxLifecycle(document.body, {
    mountTool: (host, visible) => import("./tools-host.js").then(({ mountToolsInto }) =>
      mountToolsInto(host, visible, commands, storageCommand, true)),
    mountTrade: (host, visible) => import("./tools-host.js").then(({ mountTradeInto }) =>
      mountTradeInto(host, visible)),
  })) : null;
  if (core.professionTracePointer !== 0 && traceReader !== null) {
    professionTrace = prepare(() => tools.createProfessionCommandTrace(
      memory, core.professionTracePointer, traceReader,
    ));
  }
  prepare(syncTarget);
  prepare(() => skills.sync(snapshot().settings, policy()));

  return Object.freeze({
    observer: {
      pollers: [
        ...(travel === null ? [] : [{
          poll: () => travel.poll(),
          enabled: () => policy().travel,
        }]),
        ...(takeTrade === null ? [] : [{
          poll: pollAlias,
          enabled: () => policy().tradeChat,
        }]),
      ],
      state: observeState ? { enabled: () => policy().targetReadout || policy().xunlaiStorage,
        update: (state) => { companionState = state; readout?.update(state); syncStorage(); } } : null,
      toolbox: foundation ? { enabled: () => policy().buildLibrary,
        update: (state) => { party = state; professionTrace?.poll(state); toolbox?.update(state); } } : null,
      observeState,
      publishState: program === "target-observer",
      // Geometry is shared by both HUDs. Cooldowns must keep the slot feed
      // alive even when custom key labels are disabled.
      skillSlots: slots?.sink == null ? null : { enabled: () => slots.active,
        inactive: () => reportSkillGeometry(Object.freeze({
          status: "waiting", reason: "inactive",
        })),
        update: (state) => { slots.sink?.update(state); reportSkillGeometry(state); } },
      skillCooldowns: cooldowns?.sink == null ? null : { enabled: () => policy().skillCooldowns,
        inactive: () => { setSkillCooldownReadiness("waiting"); },
        update: (state) => {
          cooldowns.sink?.update(state);
          setSkillCooldownReadiness(state.status);
        } },
      readers: tools.observerReaders,
      pointers: { snapshot: core.snapshot.pointer, toolbox: core.toolbox.pointer,
        party: core.party.pointer, skillSlots: slots?.pointer ?? 0,
        skillCooldowns: cooldowns?.pointer ?? 0 },
    },
    beforeHook() {
      source.subscribe(({ reason }) => {
        if (reason === "launch") { tracePolicy(reason); syncConsumers(); syncAlias(); }
        else syncPolicy(reason);
      });
    },
    afterHook: syncToolbox,
    createRuntime(base) {
      Object.defineProperties(base, {
        readout: { configurable: true, enumerable: true, get: () => readout?.state ?? null },
        toolbox: { configurable: true, enumerable: true, get: () => toolbox?.state ?? null },
        skillCooldowns: { configurable: true, enumerable: true, get: () => cooldowns?.state ?? null },
        xunlaiAccess: { configurable: true, enumerable: true, get: () =>
          companionState?.status === "ready" && typeof companionState.xunlaiAccess === "boolean"
            ? companionState.xunlaiAccess : null },
      });
      if (program === "target-observer") return Object.assign(base, {
        setHookEnabledForBenchmark(enabled: boolean) {
          if (context.isCleaned() || !context.hookInstalled()) {
            throw new Error("Enhancement installation is no longer active");
          }
          context.setHookEnabled(enabled);
        },
      });
      return commands === null ? base : Object.assign(base, commands);
    },
    withdrawPolicy: source.dispose,
    disposePresentation,
    releaseObserverMemory(free) {
      runCleanupSteps("Companion Tools observer memory cleanup failed", [
        () => slots?.release(free),
        () => cooldowns?.release(free),
      ]);
    },
    releaseCallbackResources(free) {
      runCleanupSteps("Companion Tools callback cleanup failed", [
        () => storage?.dispose(free),
        () => travel?.dispose(free),
      ]);
    },
  });
}
