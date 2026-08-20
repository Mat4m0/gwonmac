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
  travelConfigure,
  travelEnqueue,
  travelToggleTake,
} from "./enhancement-command-transform.js";
import type { EnhancementTransformResolution } from "./enhancement-transform.js";
import { TRAVEL_DESTINATIONS } from "../../shared/travel.js";

const REVIEWED_TRAVEL_MAP_IDS = TRAVEL_DESTINATIONS.map(({ mapId }) => mapId);

function fail(message: string): never {
  throw new Error(`enhancement transform: ${message}`);
}

function required<T>(value: T | null | undefined, label: string): T {
  return value ?? fail(`${label} is not available for the selected capabilities`);
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
}>;

export type TransformGlobalIndices = Readonly<{
  commandPending: number;
  commandArgumentBase: number;
  storagePayload: number;
  storageEnabled: number;
  travelPayload: number;
  travelEnabled: number;
  travelToggle: number;
}>;

export type TransformRewriteWorkspace = Readonly<{
  nextBodies: Uint8Array[];
  appendFunction: (typeIndex: number, body: Uint8Array) => number;
  addedFunctionExports: Array<Readonly<{ name: string; index: number }>>;
  typeIndices: TransformTypeIndices;
  globalIndices: TransformGlobalIndices;
  traceGlobals: ProfessionTraceGlobals | null;
  uiOriginalIndex: number | null;
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
  } = resolution;
  const {
    nextBodies,
    appendFunction,
    addedFunctionExports,
    typeIndices,
    globalIndices,
    traceGlobals,
    uiOriginalIndex,
  } = workspace;
  const rewriteAliases = (parserOriginalIndex: number): void => {
    const parser = required(storageSlashParserHook, "storage slash parser");
    nextBodies[parser.localIndex] = localActionSlashParser(
      parserOriginalIndex,
      globalIndices.commandPending,
      globalIndices.storagePayload,
      globalIndices.storageEnabled,
      globalIndices.travelEnabled,
      globalIndices.travelToggle,
      capabilities.travelAction,
      capabilities.xunlaiAction,
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
        ? {
            dispatcherFunctionIndex: uiOriginalIndex ?? uiDispatcher.functionIndex,
            contextResolverFunctionIndex: travelAction.contextResolver.functionIndex,
            messageId: travelAction.messageId,
            payloadGlobalIndex: globalIndices.travelPayload,
            reviewedMapIds: REVIEWED_TRAVEL_MAP_IDS,
          }
        : null,
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
}
