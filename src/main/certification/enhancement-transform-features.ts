/**
 * Feature-owned rewrite contributions consumed by the Enhancement assembler.
 * Generic WASM section assembly remains outside this module.
 */
import {
  professionTraceReader,
  tracedPacketSender,
  tracedProfessionBuilder,
  tracedSkillBuilder,
  type ProfessionTraceGlobals,
} from "./enhancement-command-trace-transform.js";
import {
  commandBoundary,
  commandDrain,
  commandEnqueue,
  localActionSlashParser,
  storageConfigure,
  storageEnqueue,
  tradeToggleConfigure,
  tradeToggleTake,
} from "./enhancement-command-transform.js";
import {
  travelConfigure,
  travelDrain,
  travelEnqueue,
  guildHallEnqueue,
  travelToggleTake,
} from "./enhancement-travel-command-transform.js";
import type { EnhancementTransformResolution } from "./enhancement-transform.js";
import {
  ENHANCEMENT_PRE_GAME_DIAGNOSTIC_EXPORT,
  ENHANCEMENT_PRE_GAME_STATE_EXPORT,
} from "./enhancement-pre-game-transform.js";
import { TRAVEL_DESTINATIONS } from "../../shared/travel-destinations.js";
import {
  characterActionConfigure,
  characterActionDrain,
  characterActionEnqueue,
  characterActionExecute,
} from "./enhancement-character-switch-transform.js";
import { ENHANCEMENT_CHAT_FILTER_CONFIGURE_EXPORT } from "./enhancement-chat-filter-transform.js";
import {
  quickItemMoveDrain,
  type QuickItemMoveGlobals,
} from "./enhancement-quick-item-move-transform.js";

const REVIEWED_TRAVEL_MAP_IDS = TRAVEL_DESTINATIONS.map(({ mapId }) => mapId);

function fail(message: string): never {
  throw new Error(`enhancement transform: ${message}`);
}

function required<T>(value: T | null | undefined, label: string): T {
  return value ?? fail(`${label} is not available for the selected capabilities`);
}

export function featureExportNames(
  resolution: EnhancementTransformResolution,
): readonly string[] {
  const { capabilities, preGameResolution, teamApply, xunlaiAction, travelAction } = resolution;
  const quick = capabilities.quickItemMove
    ? resolution.quickItemMoveResolution?.certificate ?? null
    : null;
  const action = capabilities.characterSwitchAction
    ? required(preGameResolution, "pre-game action certificate")
        .certificate.characterSwitchAction
    : null;
  return Object.freeze([
    ...(capabilities.preGameControls
      ? [ENHANCEMENT_PRE_GAME_STATE_EXPORT, ENHANCEMENT_PRE_GAME_DIAGNOSTIC_EXPORT]
      : []),
    ...(action ? [action.enqueueExport, action.configureExport] : []),
    ...(capabilities.teamApply
      ? [teamApply.thunkExport, teamApply.professionTrace.readerExport]
      : []),
    ...(capabilities.xunlaiAction
      ? [xunlaiAction.openExport, xunlaiAction.configureExport]
      : []),
    ...(capabilities.travelAction
      ? [
          travelAction.enqueueExport,
          travelAction.configureExport,
          travelAction.toggleExport,
          ...(travelAction.guildHall ? [travelAction.guildHall.enqueueExport] : []),
        ]
      : []),
    ...(capabilities.chatAliases
      ? ["enhancement_configure_trade_toggle", "enhancement_take_trade_toggle"]
      : []),
    ...(capabilities.chatFiltering
      ? [ENHANCEMENT_CHAT_FILTER_CONFIGURE_EXPORT]
      : []),
    ...(quick ? [quick.configureExport, quick.modifierExport] : []),
  ]);
}

export type TransformTypeIndices = Readonly<{
  command: number | null;
  commandDrain: number | null;
  professionTraceReader: number | null;
  storageOpen: number | null;
  storageConfigure: number | null;
  travelEnqueue: number | null;
  travelConfigure: number | null;
  travelToggle: number | null;
  tradeConfigure: number | null;
  tradeToggle: number | null;
  characterEnqueue: number | null;
  characterConfigure: number | null;
  characterExecute: number | null;
}>;

export type TransformGlobalIndices = Readonly<{
  commandPending: number;
  commandArgumentBase: number;
  storagePayload: number;
  storageEnabled: number;
  travelPayload: number;
  travelEnabled: number;
  travelToggle: number;
  tradeEnabled: number;
  tradeToggle: number;
  characterPayload: number;
  characterEnabled: number;
  characterExpectedIndex: number;
  characterConfirmationAttempts: number;
}>;

export type TransformRewriteWorkspace = Readonly<{
  nextBodies: Uint8Array[];
  appendFunction: (typeIndex: number, body: Uint8Array) => number;
  addedFunctionExports: Array<Readonly<{ name: string; index: number }>>;
  typeIndices: TransformTypeIndices;
  globalIndices: TransformGlobalIndices;
  traceGlobals: ProfessionTraceGlobals | null;
  uiOriginalIndex: number | null;
  quickItemMove: Readonly<{
    handlerIndex: number;
    globals: QuickItemMoveGlobals;
  }> | null;
}>;

/** Apply only feature-owned rewrites and exports. The generic section assembly
 * remains in enhancement-transform, so a feature cannot quietly change it. */
export function applyFeatureContributions(
  resolution: EnhancementTransformResolution,
  workspace: TransformRewriteWorkspace,
): void {
  const {
    capabilities,
    bodies,
    uiDispatcher,
    teamApply,
    xunlaiAction,
    travelAction,
    commands,
    professionBuilder,
    skillBuilder,
    storageSlashParserHook,
    packetSender,
    commandDrainBoundary,
    preGameResolution,
  } = resolution;
  const {
    nextBodies,
    appendFunction,
    addedFunctionExports,
    typeIndices,
    globalIndices,
    traceGlobals,
    uiOriginalIndex,
    quickItemMove,
  } = workspace;
  const characterExecuteIndex = capabilities.characterSwitchAction
    ? (() => {
        const preGame = required(preGameResolution, "pre-game action certificate");
        const action = preGame.certificate.characterSwitchAction;
        return appendFunction(
          required(typeIndices.characterExecute, "character action executor type"),
          characterActionExecute({
            layout: {
              ...preGame.certificate.layout,
              characterArrayPointer: preGame.certificate.characterListLayout.characterArrayPointer,
              characterArrayCount: preGame.certificate.characterListLayout.characterArrayCount,
            },
            dispatcherFunctionIndex: uiOriginalIndex ?? required(
              uiDispatcher,
              "character action UI dispatcher",
            ).functionIndex,
            frameChildFunctionIndex: action.frameChild.functionIndex,
            frameParentFunctionIndex: action.frameParent.functionIndex,
            frameResolverFunctionIndex: action.frameResolver.functionIndex,
            frameDispatchFunctionIndex: action.frameDispatch.functionIndex,
            frameDispatchOffset: action.frameDispatchOffset,
            logoutMessageId: action.logoutMessageId,
            selectorHash: preGame.certificate.labelHashes.selector,
            playHash: preGame.certificate.labelHashes.play,
            pendingGlobalIndex: globalIndices.commandPending,
            expectedIndexGlobalIndex: globalIndices.characterExpectedIndex,
            confirmationAttemptsGlobalIndex: globalIndices.characterConfirmationAttempts,
          }),
        );
      })()
    : null;
  const rewriteAliases = (parserOriginalIndex: number): void => {
    const parser = required(storageSlashParserHook, "storage slash parser");
    nextBodies[parser.localIndex] = localActionSlashParser(
      parserOriginalIndex,
      globalIndices.commandPending,
      globalIndices.storagePayload,
      globalIndices.storageEnabled,
      globalIndices.travelEnabled,
      globalIndices.travelToggle,
      globalIndices.tradeEnabled,
      globalIndices.tradeToggle,
      capabilities.chatAliases,
      capabilities.travelAction,
      capabilities.xunlaiAction,
    );
  };
  const addTradeExports = (): void => {
    if (!capabilities.chatAliases) return;
    addedFunctionExports.push(
      {
        name: "enhancement_configure_trade_toggle",
        index: appendFunction(
          required(typeIndices.tradeConfigure, "trade configure function type"),
          tradeToggleConfigure(globalIndices.tradeEnabled, globalIndices.tradeToggle),
        ),
      },
      {
        name: "enhancement_take_trade_toggle",
        index: appendFunction(
          required(typeIndices.tradeToggle, "trade toggle function type"),
          tradeToggleTake(globalIndices.tradeToggle),
        ),
      },
    );
  };
  if (!commandDrainBoundary) {
    if (capabilities.chatAliases) {
      const parser = required(storageSlashParserHook, "storage slash parser");
      rewriteAliases(appendFunction(
        parser.typeIndex,
        bodies[parser.localIndex]!,
      ));
    }
    addTradeExports();
    return;
  }

  const commandBoundaryOriginalIndex = appendFunction(
    commandDrainBoundary.typeIndex,
    bodies[commandDrainBoundary.localIndex]!,
  );
  const professionOriginalIndex = professionBuilder
    ? appendFunction(professionBuilder.typeIndex, bodies[professionBuilder.localIndex]!)
    : null;
  const skillOriginalIndex = skillBuilder
    ? appendFunction(skillBuilder.typeIndex, bodies[skillBuilder.localIndex]!)
    : null;
  const senderOriginalIndex = packetSender
    ? appendFunction(packetSender.typeIndex, bodies[packetSender.localIndex]!)
    : null;
  const parserOriginalIndex = storageSlashParserHook
    ? appendFunction(
        storageSlashParserHook.typeIndex,
        bodies[storageSlashParserHook.localIndex]!,
      )
    : null;
  const drainFunctionIndex = appendFunction(
    required(typeIndices.commandDrain, "command drain function type"),
    commandDrain(
      commands,
      globalIndices.commandPending,
      globalIndices.commandArgumentBase,
      traceGlobals === null
        ? null
        : {
            origin: traceGlobals.origin,
            drainCount: traceGlobals.drainCount,
            drainOpcode: traceGlobals.drainOpcode,
          },
      capabilities.xunlaiAction
        ? {
            functionIndex: xunlaiAction.handler.functionIndex,
            payloadGlobalIndex: globalIndices.storagePayload,
          }
        : null,
      capabilities.travelAction
        ? travelDrain(
            globalIndices.commandPending,
            globalIndices.commandArgumentBase,
            {
            dispatcherFunctionIndex: uiOriginalIndex ?? uiDispatcher.functionIndex,
            contextResolverFunctionIndex: travelAction.contextResolver.functionIndex,
            unlockAccessorFunctionIndex: travelAction.unlockProof.accessor.functionIndex,
            messageId: travelAction.messageId,
            payloadGlobalIndex: globalIndices.travelPayload,
            reviewedMapIds: REVIEWED_TRAVEL_MAP_IDS,
            ...(travelAction.guildHall ? {
              guildHall: {
                keyAccessorFunctionIndex: travelAction.guildHall.keyAccessor.functionIndex,
                areaTypeAccessorFunctionIndex: travelAction.guildHall.areaTypeAccessor.functionIndex,
                enterMessageId: travelAction.guildHall.enterMessageId,
                leaveMessageId: travelAction.guildHall.leaveMessageId,
              },
            } : {}),
            },
          )
        : null,
      capabilities.characterSwitchAction
        ? characterActionDrain(
            globalIndices.commandPending,
            globalIndices.commandArgumentBase,
            globalIndices.characterPayload,
            globalIndices.characterEnabled,
            required(characterExecuteIndex, "character action executor"),
          )
        : null,
      quickItemMove === null
        ? null
        : quickItemMoveDrain(
            globalIndices.commandPending,
            globalIndices.commandArgumentBase,
            quickItemMove.globals,
            quickItemMove.handlerIndex,
          ),
    ),
  );
  nextBodies[commandDrainBoundary.localIndex] = commandBoundary(
    commandDrainBoundary.type.params.length,
    commandBoundaryOriginalIndex,
    drainFunctionIndex,
  );

  if (capabilities.teamApply) {
    const profession = required(professionBuilder, "profession builder");
    const skill = required(skillBuilder, "skill-bar builder");
    const sender = required(packetSender, "traced packet sender");
    const trace = required(traceGlobals, "profession trace globals");
    nextBodies[profession.localIndex] = tracedProfessionBuilder(
      required(professionOriginalIndex, "original profession builder"),
      trace,
    );
    nextBodies[skill.localIndex] = tracedSkillBuilder(
      required(skillOriginalIndex, "original skill-bar builder"),
      trace,
    );
    nextBodies[sender.localIndex] = tracedPacketSender(
      required(senderOriginalIndex, "original packet sender"),
      trace,
    );
    addedFunctionExports.push(
      {
        name: teamApply.thunkExport,
        index: appendFunction(
          required(typeIndices.command, "command function type"),
          commandEnqueue(
            commands,
            globalIndices.commandPending,
            globalIndices.commandArgumentBase,
          ),
        ),
      },
      {
        name: teamApply.professionTrace.readerExport,
        index: appendFunction(
          required(typeIndices.professionTraceReader, "profession trace reader type"),
          professionTraceReader(trace),
        ),
      },
    );
  }

  if (capabilities.chatAliases) {
    rewriteAliases(required(parserOriginalIndex, "original storage slash parser"));
  }
  addTradeExports();

  if (capabilities.xunlaiAction) {
    addedFunctionExports.push(
      {
        name: xunlaiAction.openExport,
        index: appendFunction(
          required(typeIndices.storageOpen, "storage open function type"),
          storageEnqueue(
            globalIndices.commandPending,
            globalIndices.storagePayload,
            globalIndices.storageEnabled,
          ),
        ),
      },
      {
        name: xunlaiAction.configureExport,
        index: appendFunction(
          required(typeIndices.storageConfigure, "storage configure function type"),
          storageConfigure(
            globalIndices.commandPending,
            globalIndices.storagePayload,
            globalIndices.storageEnabled,
          ),
        ),
      },
    );
  }
  if (capabilities.travelAction) {
    addedFunctionExports.push(
      {
        name: travelAction.enqueueExport,
        index: appendFunction(
          required(typeIndices.travelEnqueue, "travel enqueue function type"),
          travelEnqueue(
            globalIndices.commandPending,
            globalIndices.commandArgumentBase,
            globalIndices.travelPayload,
            globalIndices.travelEnabled,
            REVIEWED_TRAVEL_MAP_IDS,
          ),
        ),
      },
      ...(travelAction.guildHall ? [{
        name: travelAction.guildHall.enqueueExport,
        index: appendFunction(
          required(typeIndices.travelToggle, "Guild Hall enqueue function type"),
          guildHallEnqueue(
            globalIndices.commandPending,
            globalIndices.travelPayload,
            globalIndices.travelEnabled,
          ),
        ),
      }] : []),
      {
        name: travelAction.configureExport,
        index: appendFunction(
          required(typeIndices.travelConfigure, "travel configure function type"),
          travelConfigure(
            globalIndices.commandPending,
            globalIndices.travelPayload,
            globalIndices.travelEnabled,
          ),
        ),
      },
      {
        name: travelAction.toggleExport,
        index: appendFunction(
          required(typeIndices.travelToggle, "travel toggle function type"),
          travelToggleTake(globalIndices.travelToggle),
        ),
      },
    );
  }
  if (capabilities.characterSwitchAction) {
    const action = required(
      resolution.preGameResolution,
      "pre-game character action certificate",
    ).certificate.characterSwitchAction;
    addedFunctionExports.push(
      {
        name: action.enqueueExport,
        index: appendFunction(
          required(typeIndices.characterEnqueue, "character enqueue function type"),
          characterActionEnqueue(
            globalIndices.commandPending,
            globalIndices.commandArgumentBase,
            globalIndices.characterEnabled,
            globalIndices.characterExpectedIndex,
            globalIndices.characterConfirmationAttempts,
          ),
        ),
      },
      {
        name: action.configureExport,
        index: appendFunction(
          required(typeIndices.characterConfigure, "character configure function type"),
          characterActionConfigure(
            globalIndices.commandPending,
            globalIndices.characterPayload,
            globalIndices.characterEnabled,
            globalIndices.characterExpectedIndex,
            globalIndices.characterConfirmationAttempts,
          ),
        ),
      },
    );
  }
}
