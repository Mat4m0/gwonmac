/**
 * Prepares the optional half of a certified companion installation. Core owns
 * the shared kernel transaction and calls this extension only in Tools mode.
 */
import { COMPANION_ABI, COMPANION_DISPATCH_KINDS, COMPANION_FEATURE_BITS } from "../shared/companion-abi.js";
import {
  ENHANCEMENT_CHAT_FILTER_MASKS,
  type EnhancementCapabilities,
  type EnhancementProgram,
} from "../shared/enhancement-contracts.js";
import type { AppSettings } from "../shared/contracts.js";
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import type { TravelFriends } from "../shared/friends.js";
import {
  companionFriendsSignature,
  readCompanionFriends,
} from "./companion-friend-snapshot.js";
import { decodeFriendObserverManifest } from "./friend-observer-manifest.js";
import type { CompanionSnapshot } from "./companion-snapshot.js";
import type { CompanionSkillSlotState } from "./companion-skill-snapshot.js";
import { createCompanionSequenceFeed } from "./companion-sequence-feed.js";
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
import {
  clearCartographyPlayerState,
  updateCartographyPlayerState,
} from "./cartography-player-state.js";
import {
  installQuickItemMove,
  QUICK_ITEM_MOVE_SCRATCH_BYTES,
  quickItemMoveExports,
  type QuickItemMoveInstallation,
} from "./quick-item-move-installation.js";
import {
  createEffectIconGeometryInstallation,
  createPlayerEffectObservationInstallation,
} from "./player-effect-state-installation.js";
import { createEffectTimerOverlayConsumer } from "./effect-timer-overlay-consumer.js";

const EMPTY_REGION = Object.freeze({ pointer: 0, bytes: 0 });

export function configuredChatFilterMask(
  settings: Pick<AppSettings,
    "chatFilterAllyDrops" | "chatFilterHallOfHeroes" | "chatFilterTitleAchievements">,
  enabled: boolean,
): number {
  if (!enabled) return 0;
  return (settings.chatFilterAllyDrops ? ENHANCEMENT_CHAT_FILTER_MASKS.allyDrops : 0)
    | (settings.chatFilterHallOfHeroes ? ENHANCEMENT_CHAT_FILTER_MASKS.hallOfHeroes : 0)
    | (settings.chatFilterTitleAchievements
      ? ENHANCEMENT_CHAT_FILTER_MASKS.titleAchievements
      : 0);
}

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
  module: WebAssembly.Module,
  capabilities: EnhancementCapabilities,
  program: EnhancementProgram,
): Promise<PreparedCompanionExtension> {
  const foundation = capabilities.partyObservation;
  const friendManifest = capabilities.travelAction ? decodeFriendObserverManifest(module) : null;
  let friendPointer = 0;
  let quickItemMovePointer = 0;
  const observeState = capabilities.targetObservation || capabilities.xunlaiAction;
  const skills = tools.createSkillOverlaysInstallation(capabilities);
  const slots = skills.geometry;
  const cooldowns = skills.cooldowns;
  const playerEffects = createPlayerEffectObservationInstallation(
    capabilities.playerEffectObservation,
  );
  const effectIcons = createEffectIconGeometryInstallation(
    capabilities.effectIconGeometry,
  );
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
  const quickItemMove = capabilities.quickItemMove ? quickItemMoveExports(exports) : null;
  if (capabilities.quickItemMove && quickItemMove === null) {
    throw new Error("the Quick Item Move profile derived a module with no certified controls");
  }
  const configureTrade = capabilities.chatAliases
    && typeof exports.enhancement_configure_trade_toggle === "function"
    ? exports.enhancement_configure_trade_toggle as (enabled: number) => number : null;
  const takeTrade = capabilities.chatAliases
    && typeof exports.enhancement_take_trade_toggle === "function"
    ? exports.enhancement_take_trade_toggle as () => number : null;
  const configureChatFilters = capabilities.chatFiltering
    && typeof exports.enhancement_configure_chat_filters === "function"
    ? exports.enhancement_configure_chat_filters as (mask: number) => number
    : null;
  if (capabilities.chatAliases && (!configureTrade || !takeTrade)) {
    throw new Error("the aliases profile derived a module with no Trade Chat toggle");
  }
  if (capabilities.chatFiltering && configureChatFilters === null) {
    throw new Error("the chat filtering profile derived a module with no filter configuration");
  }
  let allocated = false;
  let activated = false;
  return Object.freeze({
    featureFlags:
      (observeState ? COMPANION_FEATURE_BITS.gameSnapshot : 0)
      | (foundation ? COMPANION_FEATURE_BITS.toolboxFoundation : 0)
      | (capabilities.targetObservation ? COMPANION_FEATURE_BITS.targetObservation : 0)
      | skills.certifiedFeatureFlags
      | (capabilities.playerEffectObservation
        ? COMPANION_FEATURE_BITS.playerEffectObservation : 0)
      | (capabilities.effectIconGeometry
        ? COMPANION_FEATURE_BITS.effectIconGeometry : 0)
      | (friendManifest === null ? 0 : COMPANION_FEATURE_BITS.friendObservation),
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
      if (friendManifest !== null) friendPointer = Number(malloc(COMPANION_ABI.friends.bytes));
      if (quickItemMove !== null) quickItemMovePointer = Number(malloc(QUICK_ITEM_MOVE_SCRATCH_BYTES));
      slots?.allocate(malloc);
      cooldowns?.allocate(malloc);
      playerEffects.allocate(malloc);
      effectIcons.allocate(malloc);
      storage?.allocate(malloc);
      travel?.allocate(malloc);
      if ((friendManifest !== null && (!Number.isInteger(friendPointer) || friendPointer <= 0))
        || (quickItemMove !== null && (!Number.isInteger(quickItemMovePointer) || quickItemMovePointer <= 0))
        || (slots !== null && !slots.allocated)
        || (cooldowns !== null && !cooldowns.allocated)
        || !playerEffects.allocated
        || !effectIcons.allocated
        || (storage !== null && !storage.region().pointer)
        || (travel !== null && !travel.region().pointer)) {
        throw new Error("Companion Tools allocation failed");
      }
    },
    initialize(memory) {
      if (friendPointer !== 0) new Uint8Array(memory.buffer, friendPointer, COMPANION_ABI.friends.bytes).fill(0);
      if (quickItemMovePointer !== 0) {
        new Uint8Array(memory.buffer, quickItemMovePointer, QUICK_ITEM_MOVE_SCRATCH_BYTES).fill(0);
      }
      if (playerEffects.pointer !== 0) {
        new Uint8Array(
          memory.buffer,
          playerEffects.pointer,
          playerEffects.bytes,
        ).fill(0);
      }
      if (effectIcons.pointer !== 0) {
        new Uint8Array(memory.buffer, effectIcons.pointer, effectIcons.bytes).fill(0);
      }
      storage?.initialize(memory); travel?.initialize();
    },
    ownedRegions: () => [
      ...(friendPointer === 0 ? [] : [{ name: "friend snapshot", pointer: friendPointer,
        size: COMPANION_ABI.friends.bytes, align: 4 as const }]),
      ...(quickItemMovePointer === 0 ? [] : [{ name: "Quick Item Move payload", pointer: quickItemMovePointer,
        size: QUICK_ITEM_MOVE_SCRATCH_BYTES, align: 4 as const }]),
      ...(slots?.region == null ? [] : [slots.region]),
      ...(cooldowns?.region == null ? [] : [cooldowns.region]),
      ...(playerEffects.region == null ? [] : [playerEffects.region]),
      ...(effectIcons.region == null ? [] : [effectIcons.region]),
      ...(storage === null ? [] : [storage.region()]),
      ...(travel === null ? [] : [travel.region()]),
    ],
    kernelRegions: {
      get friends() { return friendPointer === 0 ? EMPTY_REGION : { pointer: friendPointer, bytes: COMPANION_ABI.friends.bytes }; },
      friendRoot: friendManifest?.root ?? 0,
      get skillSlots() {
        return slots === null ? EMPTY_REGION : { pointer: slots.pointer, bytes: slots.bytes };
      },
      get skillCooldowns() {
        return cooldowns === null
          ? EMPTY_REGION : { pointer: cooldowns.pointer, bytes: cooldowns.bytes };
      },
      get playerEffects() {
        return playerEffects.region === null
          ? EMPTY_REGION
          : { pointer: playerEffects.pointer, bytes: playerEffects.bytes };
      },
      get effectIcons() {
        return effectIcons.region === null
          ? EMPTY_REGION
          : { pointer: effectIcons.pointer, bytes: effectIcons.bytes };
      },
    },
    activate(context) {
      const session = activateTools({ context, capabilities, program, foundation, observeState,
        skills, slots, cooldowns, playerEffects, effectIcons, enqueue, traceReader, teamCommands, storage,
        travel, configureTrade, takeTrade, configureChatFilters, friendPointer,
        quickItemMove, quickItemMovePointer });
      activated = true;
      return session;
    },
    rollback(free) {
      if (!allocated || activated) return;
      runCleanupSteps("Companion Tools allocation rollback failed", [
        () => { if (friendPointer !== 0) free(friendPointer); friendPointer = 0; },
        () => { if (quickItemMovePointer !== 0) free(quickItemMovePointer); quickItemMovePointer = 0; },
        () => slots?.release(free),
        () => cooldowns?.release(free),
        () => playerEffects.release(free),
        () => effectIcons.release(free),
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
  playerEffects: ReturnType<typeof createPlayerEffectObservationInstallation>;
  effectIcons: ReturnType<typeof createEffectIconGeometryInstallation>;
  enqueue: EnhancementCommandEnqueue | null;
  traceReader: ProfessionCommandTraceReader | null;
  teamCommands: typeof TeamCommandsModule | null;
  storage: StorageInstallation | null;
  travel: TravelInstallation | null;
  configureTrade: ((enabled: number) => number) | null;
  takeTrade: (() => number) | null;
  configureChatFilters: ((mask: number) => number) | null;
  friendPointer: number;
  quickItemMove: ReturnType<typeof quickItemMoveExports>;
  quickItemMovePointer: number;
}>;

function activateTools(input: ToolsInput): CompanionExtensionSession {
  const { context, capabilities, program, foundation, observeState, skills,
    slots, cooldowns, playerEffects, effectIcons, enqueue, traceReader, teamCommands, storage, travel,
    configureTrade, takeTrade, configureChatFilters } = input;
  let activeFriendPointer = input.friendPointer;
  let activeQuickItemMovePointer = input.quickItemMovePointer;
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
  const playerEffectsActive = () => capabilities.playerEffectObservation
    && (program === "effect-observer"
      || (policy().effectTimers && capabilities.effectIconGeometry));
  const effectIconsActive = () => capabilities.effectIconGeometry
    && (program === "effect-observer" || policy().effectTimers);
  const playRegion = () => snapshot().playRegion;
  const cartographyActive = () => {
    const settings = window.gwToolsSettings();
    return policy().cartography && (settings.cartographyOverlayEnabled || settings.cartographyGridEnabled);
  };
  let companionState: CompanionSnapshot | null = null;
  let party: ToolboxObservation | null = null;
  let readout: ReturnType<typeof tools.createTargetReadout> | null = null;
  let toolbox: ReturnType<typeof tools.createToolboxLifecycle> | null = null;
  let professionTrace: ReturnType<typeof tools.createProfessionCommandTrace> | null = null;
  let quickItemMoveInstallation: QuickItemMoveInstallation | null = null;
  let aliasEnabled: boolean | null = null;
  let lastTrace = "";
  let observingFriends = false;
  let effectOverlay: ReturnType<typeof createEffectTimerOverlayConsumer> | null = null;
  let unsubscribeEffects: (() => void) | null = null;
  let unsubscribeEffectIcons: (() => void) | null = null;
  const waitingFriends = Object.freeze({
    status: "waiting" as const,
    reason: "unavailable" as const,
  });
  const friendFeed = activeFriendPointer === 0 || travel === null
    ? null
    : createCompanionSequenceFeed<TravelFriends>(waitingFriends, waitingFriends, {
      sameReadyState: (previous, next) =>
        companionFriendsSignature(previous) === companionFriendsSignature(next),
    });
  const unsubscribeFriends = friendFeed?.subscribe((friends) => travel?.updateFriends(friends));
  const pollFriends = () => {
    if (activeFriendPointer === 0 || travel === null || friendFeed === null) return;
    const nextObservation = policy().travel && travel.observingFriends();
    if (nextObservation !== observingFriends) {
      observingFriends = nextObservation;
      if (!observingFriends) friendFeed.withdraw();
      syncObservers();
    }
    if (!observingFriends) return;
    friendFeed.update(readCompanionFriends(memory.buffer, activeFriendPointer));
  };
  const disposePresentation = () => runCleanupSteps(
    "Companion Tools presentation cleanup failed",
    [
      () => { readout?.dispose(); readout = null; },
      () => toolbox?.dispose(),
      () => skills.disposePresentation(),
      () => slots?.dispose(),
      () => cooldowns?.dispose(),
      () => { unsubscribeEffects?.(); unsubscribeEffects = null; },
      () => { unsubscribeEffectIcons?.(); unsubscribeEffectIcons = null; },
      () => { effectOverlay?.dispose(); effectOverlay = null; },
      () => { configureTrade?.(0); },
      () => { configureChatFilters?.(0); },
      () => { quickItemMoveInstallation?.dispose(); quickItemMoveInstallation = null; },
      () => professionTrace?.dispose(),
      () => { unsubscribeFriends?.(); friendFeed?.dispose(); },
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
  const quickItemMoveControls = input.quickItemMove;
  if (quickItemMoveControls !== null && activeQuickItemMovePointer !== 0) {
    quickItemMoveInstallation = prepare(() => installQuickItemMove({
      configure: quickItemMoveControls.configure,
      setModifiers: quickItemMoveControls.setModifiers,
      scratchPointer: activeQuickItemMovePointer,
    }));
  }
  prepare(() => {
    if (!capabilities.effectIconGeometry) return;
    const canvas = document.getElementById("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Enhancement effect overlay target is missing");
    }
    effectOverlay = createEffectTimerOverlayConsumer(document.body, canvas);
    unsubscribeEffects = playerEffects.subscribe(effectOverlay.setEffects);
    unsubscribeEffectIcons = effectIcons.subscribe(effectOverlay.setGeometry);
  });

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
  let chatFilterMask: number | null = null;
  const syncChatFilters = () => {
    if (configureChatFilters === null) return;
    const settings = snapshot().settings;
    const mask = configuredChatFilterMask(settings, policy().chatFilters);
    if (mask === chatFilterMask) return;
    if (configureChatFilters(mask) !== 1) {
      throw new Error("the chat filter rejected its configuration");
    }
    chatFilterMask = mask;
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
      | (policy().targetReadout || cartographyActive()
        ? COMPANION_FEATURE_BITS.targetObservation : 0)
      | skills.activeFeatureFlags
      | (playerEffectsActive() ? COMPANION_FEATURE_BITS.playerEffectObservation : 0)
      | (effectIconsActive() ? COMPANION_FEATURE_BITS.effectIconGeometry : 0)
      | (activeFriendPointer !== 0 && policy().travel && travel?.observingFriends() === true
        ? COMPANION_FEATURE_BITS.friendObservation : 0),
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
    playerEffects.setActive(playerEffectsActive());
    effectIcons.setActive(effectIconsActive());
    effectOverlay?.setEnabled(policy().effectTimers && effectIconsActive());
    syncObservers();
    syncStorage();
    syncTravel();
    quickItemMoveInstallation?.update(policy().quickItemMove);
  };
  const syncPolicy = (reason: "region" | "settings") => {
    tracePolicy(reason); syncToolbox(); syncConsumers(); syncAlias(); syncChatFilters();
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
        ...(activeFriendPointer === 0 ? [] : [{ poll: pollFriends, enabled: () => true }]),
        ...(travel === null ? [] : [{
          poll: () => travel.poll(),
          enabled: () => policy().travel,
        }]),
        ...(takeTrade === null ? [] : [{
          poll: pollAlias,
          enabled: () => policy().tradeChat,
        }]),
      ],
      state: observeState ? {
        enabled: () => policy().targetReadout || policy().xunlaiStorage || cartographyActive(),
        update: (state) => {
          companionState = state;
          updateCartographyPlayerState(state);
          readout?.update(state);
          syncStorage();
        },
      } : null,
      toolbox: foundation ? { enabled: () => policy().buildLibrary || program === "effect-observer",
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
      playerEffects: playerEffects.sink == null ? null : {
        enabled: () => playerEffects.active,
        inactive: () => playerEffects.setActive(false),
        update: playerEffects.sink.update,
      },
      effectIcons: effectIcons.sink == null ? null : {
        enabled: () => effectIcons.active,
        inactive: () => effectIcons.setActive(false),
        update: effectIcons.sink.update,
      },
      readers: tools.observerReaders,
      pointers: { snapshot: core.snapshot.pointer, toolbox: core.toolbox.pointer,
        party: core.party.pointer, skillSlots: slots?.pointer ?? 0,
        skillCooldowns: cooldowns?.pointer ?? 0,
        playerEffects: playerEffects.pointer, effectIcons: effectIcons.pointer },
    },
    beforeHook() {
      source.subscribe(({ reason }) => {
        if (reason === "launch") {
          tracePolicy(reason); syncConsumers(); syncAlias(); syncChatFilters();
        }
        else syncPolicy(reason);
      });
    },
    afterHook: syncToolbox,
    createRuntime(base) {
      Object.defineProperties(base, {
        readout: { configurable: true, enumerable: true, get: () => readout?.state ?? null },
        toolbox: { configurable: true, enumerable: true, get: () => toolbox?.state ?? null },
        party: { configurable: true, enumerable: true, get: () => {
          if (program !== "effect-observer") return null;
          const roster = party?.party;
          if (party?.status !== "ready" || roster?.status !== "ready"
            || roster.rosterObserved !== true || !Array.isArray(roster.slots)
            || typeof roster.slotCount !== "number" || !Number.isInteger(roster.slotCount)) {
            return Object.freeze({ status: "waiting" as const });
          }
          const agentIds = roster.slots.flatMap((slot) =>
            slot.occupied && typeof slot.agentId === "number"
              && Number.isInteger(slot.agentId) && slot.agentId > 0 ? [slot.agentId] : []);
          if (agentIds.length !== roster.slotCount + 1) {
            return Object.freeze({ status: "waiting" as const });
          }
          return Object.freeze({
            status: "ready" as const,
            slotCount: roster.slotCount,
            agentIds: Object.freeze(agentIds),
          });
        } },
        skillCooldowns: { configurable: true, enumerable: true, get: () => cooldowns?.state ?? null },
        playerEffects: { configurable: true, enumerable: true, get: () => playerEffects.state },
        effectIcons: { configurable: true, enumerable: true, get: () => effectIcons.state },
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
    disposePresentation() {
      clearCartographyPlayerState();
      disposePresentation();
    },
    releaseObserverMemory(free) {
      runCleanupSteps("Companion Tools observer memory cleanup failed", [
        () => { if (activeFriendPointer !== 0) free(activeFriendPointer); activeFriendPointer = 0; },
        () => slots?.release(free),
        () => cooldowns?.release(free),
        () => { playerEffects.release(free); playerEffects.dispose(); },
        () => { effectIcons.release(free); effectIcons.dispose(); },
      ]);
    },
    releaseCallbackResources(free) {
      runCleanupSteps("Companion Tools callback cleanup failed", [
        () => storage?.dispose(free),
        () => travel?.dispose(free),
        () => { if (activeQuickItemMovePointer !== 0) free(activeQuickItemMovePointer); activeQuickItemMovePointer = 0; },
      ]);
    },
  });
}
