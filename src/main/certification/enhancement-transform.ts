/**
 * The Enhancement transform: given one exact certified build, appends the hook
 * dispatch machinery to its WebAssembly and reserves the table slot the
 * companion kernel is installed into.
 *
 * The input hash is checked against the build entry before a byte is read, and
 * every hook's function signature is re-verified against the certified one, so
 * a table entry that has gone stale fails loudly instead of producing a module
 * that traps at runtime. Capability selection is exact — five fields, no
 * extra keys, and a profile that has no certified output hash is refused rather
 * than derived.
 *
 * Hook ordering is part of the output identity, not an implementation detail:
 * it determines relocated function indices and therefore the resulting bytes,
 * so no capability selection may inherit another's ordering.
 *
 */
import { createHash } from "node:crypto";
import {
  enhancementCapabilityProfile,
  enhancementHooksFor,
  ENHANCEMENT_TRANSFORM_ABI,
  validEnhancementCapabilities,
  type EnhancementCapabilities,
} from "../../shared/enhancement-contracts.js";
import {
  enhancementConfigWords,
  supportedEnhancementCapabilities,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  PROFESSION_TRACE_WORDS,
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
  storageConfigure,
  storageEnqueue,
  localActionSlashParser,
  travelConfigure,
  travelEnqueue,
  travelToggleTake,
} from "./enhancement-command-transform.js";
import {
  concat,
  countFunctionImports,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  parseCode,
  parseIndexVector,
  parseExports,
  parseTypes,
  sectionById,
  sleb,
  splitSections,
  uleb,
  valueTypeName,
  vectorPayload,
  WASM_HEADER,
  type FunctionType,
  type Section,
} from "../core/wasm-binary.js";
import {
  encodeEnhancementTable,
  enhancementTableSlotFunctions,
  parseEnhancementTable,
} from "./enhancement-table.js";

declare const WebAssembly: {
  Module: new (bytes: Uint8Array) => unknown;
  validate(bytes: Uint8Array): boolean;
};

export const ENHANCEMENT_HOOK_EXPORT = "enhancement_hook_slot";
export const ENHANCEMENT_MANIFEST_SECTION = "enhancement_manifest";

const DISPATCH_PARAMS = 6;
/** `(opcode, a0, a1, a2, a3) -> i32`. Four arguments covers every certified
 *  command; the widest builder we have takes four scalars. */
const COMMAND_PARAMS = 5;
const COMMAND_ARGS = COMMAND_PARAMS - 1;
const DISPATCH_TICK = 0;
const DISPATCH_CURSOR = 1;
const DISPATCH_UI = 2;

function fail(message: string): never {
  throw new Error(`enhancement transform: ${message}`);
}

function exactCapabilities(value: unknown): EnhancementCapabilities | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 5
    || !Object.hasOwn(record, "nativeCursor")
    || !Object.hasOwn(record, "targetObservation")
    || !Object.hasOwn(record, "partyObservation")
    || !Object.hasOwn(record, "commands")
    || !Object.hasOwn(record, "storage")
    || typeof record.nativeCursor !== "boolean"
    || typeof record.targetObservation !== "boolean"
    || typeof record.partyObservation !== "boolean"
    || typeof record.commands !== "boolean"
    || typeof record.storage !== "boolean"
  ) {
    return null;
  }
  return Object.freeze({
    nativeCursor: record.nativeCursor,
    targetObservation: record.targetObservation,
    partyObservation: record.partyObservation,
    commands: record.commands,
    storage: record.storage,
  });
}

function encodeName(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(uleb(bytes.byteLength), bytes);
}


function dispatcher(
  paramCount: number,
  dispatchKind: number,
  dispatchTypeIndex: number,
  originalIndex: number,
  hookGlobalIndex: number,
): Uint8Array {
  const args = Array.from({ length: paramCount }, (_, index) =>
    concat(Uint8Array.of(0x20), uleb(index)),
  );
  return concat(
    uleb(0),
    // The game-owned function always runs in the game module and on the
    // game-owned call stack. The optional companion is a passive observer;
    // normal game execution must never depend on crossing into a side module
    // and then re-entering this clone.
    ...args,
    Uint8Array.of(0x10),
    uleb(originalIndex),
    Uint8Array.of(0x23),
    uleb(hookGlobalIndex),
    Uint8Array.of(0x45, 0x04, 0x40),
    Uint8Array.of(0x0f, 0x0b),
    Uint8Array.of(0x41),
    sleb(dispatchKind),
    ...args,
    ...Array.from({ length: DISPATCH_PARAMS - 1 - paramCount }, () =>
      concat(Uint8Array.of(0x41), sleb(0)),
    ),
    Uint8Array.of(0x23),
    uleb(hookGlobalIndex),
    Uint8Array.of(0x41),
    sleb(1),
    Uint8Array.of(0x6b, 0x11),
    uleb(dispatchTypeIndex),
    uleb(0),
    Uint8Array.of(0x0b),
  );
}

function buildManifestSection(
  build: KnownEnhancementBuild,
  capabilities: EnhancementCapabilities,
): Section {
  const selectedHooks = enhancementHooksFor(capabilities);
  const cursorEvent = build.cursorEvent;
  const partyObservation = build.partyObservation;
  const configWords = enhancementConfigWords(build, capabilities);
  const json = new TextEncoder().encode(
    JSON.stringify({
      transformAbi: ENHANCEMENT_TRANSFORM_ABI,
      programId: build.programId,
      buildId: build.buildId,
      tableSlot: build.tableSlot,
      capabilities,
      hooks: {
        tick: selectedHooks.tick
          ? {
              functionIndex: build.hookFunction,
              params: build.hookParams,
              results: build.hookResults,
            }
          : null,
        cursor: selectedHooks.cursor
          ? {
              functionIndex: cursorEvent!.functionIndex,
              params: cursorEvent!.params,
              results: cursorEvent!.results,
              existingTableSlot: cursorEvent!.tableSlot,
            }
          : null,
        ui: selectedHooks.ui
          ? {
              functionIndex: partyObservation!.functionIndex,
              params: partyObservation!.params,
              results: partyObservation!.results,
            }
          : null,
      },
      messages: selectedHooks.ui
          ? {
            playerChat: partyObservation!.playerChatMessage,
            hideHeroPanel: partyObservation!.hideHeroPanelMessage,
            showHeroPanel: partyObservation!.showHeroPanelMessage,
            partyDirty: partyObservation!.partyDirtyMessages,
          }
        : null,
      configWords,
    }),
  );
  return {
    id: 0,
    body: concat(encodeName(ENHANCEMENT_MANIFEST_SECTION), json),
  };
}

function assertSignature(
  label: string,
  type: FunctionType,
  expectedParams: readonly string[],
  expectedResults: readonly string[],
): void {
  const params = type.params.map(valueTypeName);
  const results = type.results.map(valueTypeName);
  if (
    params.join(",") !== expectedParams.join(",") ||
    results.join(",") !== expectedResults.join(",")
  ) {
    fail(
      `${label} signature is (${params.join(",")}) -> (${results.join(",")}), expected ` +
        `(${expectedParams.join(",")}) -> (${expectedResults.join(",")})`,
    );
  }
}

function encodeTypes(types: readonly FunctionType[]): Uint8Array {
  return concat(
    uleb(types.length),
    ...types.map((type) =>
      concat(
        Uint8Array.of(0x60),
        uleb(type.params.length),
        Uint8Array.from(type.params),
        uleb(type.results.length),
        Uint8Array.from(type.results),
      ),
    ),
  );
}

export function transformEnhancementWasm(
  input: Uint8Array,
  build: KnownEnhancementBuild,
  requestedCapabilities: EnhancementCapabilities,
): Uint8Array {
  const capabilities = exactCapabilities(requestedCapabilities)
    ?? fail("capability selection is invalid");
  if (
    !validEnhancementCapabilities(capabilities)
    || enhancementCapabilityProfile(capabilities) === null
  ) {
    fail("capability profile is not certified");
  }
  const supported = supportedEnhancementCapabilities(build);
  if (
    (capabilities.nativeCursor && !supported.nativeCursor)
    || (capabilities.targetObservation && !supported.targetObservation)
    || (capabilities.partyObservation && !supported.partyObservation)
    || (capabilities.commands && !supported.commands)
    || (capabilities.storage && !supported.storage)
  ) {
    fail("capability facts are not certified for this build");
  }
  const cursorEvent = build.cursorEvent!;
  const partyObservation = build.partyObservation!;
  const gameThread = build.gameThread!;
  const teamApply = build.teamApply!;
  const storage = build.storage!;
  const selectedHooks = enhancementHooksFor(capabilities);
  const hash = createHash("sha256").update(input).digest("hex");
  if (hash !== build.sha256) fail(`input hash ${hash} is unsupported`);

  const sections = splitSections(input);
  const types = parseTypes(sectionById(sections, 1));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const bodies = parseCode(sectionById(sections, 10));
  if (functionTypes.length !== bodies.length) fail("function/code count mismatch");

  const resolveHook = (
    label: string,
    functionIndex: number,
    expectedParams: readonly string[],
    expectedResults: readonly string[],
  ): { localIndex: number; typeIndex: number; type: FunctionType } => {
    const localIndex = functionIndex - importCount;
    if (localIndex < 0 || localIndex >= bodies.length) {
      fail(`${label} function is out of range`);
    }
    const typeIndex = functionTypes[localIndex]!;
    const type = types[typeIndex] ?? fail(`${label} references an unknown type`);
    assertSignature(label, type, expectedParams, expectedResults);
    return { localIndex, typeIndex, type };
  };
  type ResolvedHook = ReturnType<typeof resolveHook> & Readonly<{
    dispatchKind: number;
  }>;
  // This is the transform's one ordering rule. It controls relocated-original
  // indices and output bytes, so capability selection can never inherit object
  // iteration order or the order in which a caller happened to request hooks.
  const selected: ResolvedHook[] = [];
  if (selectedHooks.tick) {
    selected.push({
      ...resolveHook(
        "tick",
        build.hookFunction,
        build.hookParams,
        build.hookResults,
      ),
      dispatchKind: DISPATCH_TICK,
    });
  }
  if (selectedHooks.cursor) {
    selected.push({
      ...resolveHook(
        "cursor",
        cursorEvent.functionIndex,
        cursorEvent.params,
        cursorEvent.results,
      ),
      dispatchKind: DISPATCH_CURSOR,
    });
  }
  if (selectedHooks.ui) {
    selected.push({
      ...resolveHook(
        "UI dispatcher",
        partyObservation.functionIndex,
        partyObservation.params,
        partyObservation.results,
      ),
      dispatchKind: DISPATCH_UI,
    });
  }
  const bodyHash = (functionIndex: number): string => {
    const body = bodies[functionIndex - importCount];
    if (!body) fail(`function ${functionIndex} has no body`);
    return createHash("sha256").update(body).digest("hex");
  };
  if (bodyHash(build.hookFunction) !== build.hookBodySha256) {
    fail("tick body does not match its semantic fingerprint");
  }
  if (selectedHooks.cursor) {
    if (bodyHash(cursorEvent.functionIndex) !== cursorEvent.bodySha256) {
      fail("cursor body does not match its semantic fingerprint");
    }
    for (let index = 0; index < cursorEvent.producerFunctions.length; index += 1) {
      resolveHook(
        `cursor producer ${index + 1}`,
        cursorEvent.producerFunctions[index]!,
        cursorEvent.producerParams[index]!,
        cursorEvent.producerResults[index]!,
      );
      if (
        bodyHash(cursorEvent.producerFunctions[index]!)
        !== cursorEvent.producerBodySha256[index]
      ) fail("cursor producer body does not match its semantic fingerprint");
    }
  }

  // Every certified command, verified before a byte of the thunk is written.
  // The type check is the same standard the hooks are held to; the body hash is
  // what actually pins the function. An index that has drifted -- the failure
  // this whole surface was reshaped around -- lands on a different body and is
  // refused here rather than dispatched to.
  const commands = capabilities.commands
    ? teamApply.entries.map((entry) => {
        const localIndex = entry.functionIndex - importCount;
        if (localIndex < 0 || localIndex >= bodies.length) {
          fail(`command opcode ${entry.opcode} is out of range`);
        }
        const typeIndex = functionTypes[localIndex]!;
        const type = types[typeIndex]
          ?? fail(`command opcode ${entry.opcode} references an unknown type`);
        assertSignature(
          `command opcode ${entry.opcode}`,
          type,
          entry.params,
          entry.results,
        );
        const body = createHash("sha256").update(bodies[localIndex]!).digest("hex");
        if (body !== entry.bodySha256) {
          fail(
            `command opcode ${entry.opcode} resolves to function `
            + `${entry.functionIndex}, whose body is ${body} and not the `
            + `certified ${entry.bodySha256}`,
          );
        }
        return entry;
      })
    : [];
  if (new Set(commands.map((entry) => entry.opcode)).size !== commands.length) {
    fail("certified commands must have distinct opcodes");
  }
  const professionCommand = capabilities.commands
    ? commands.find((entry) => entry.opcode === 65)
      ?? fail("commands capability has no certified profession command")
    : null;
  const skillCommand = capabilities.commands
    ? commands.find((entry) => entry.opcode === 93)
      ?? fail("commands capability has no certified skill-bar command")
    : null;
  const professionBuilder = professionCommand
    ? resolveHook(
        "profession builder",
        professionCommand.functionIndex,
        professionCommand.params,
        professionCommand.results,
      )
    : null;
  const skillBuilder = skillCommand
    ? resolveHook(
        "skill-bar builder",
        skillCommand.functionIndex,
        skillCommand.params,
        skillCommand.results,
      )
    : null;
  const storageHandler = capabilities.storage
    ? resolveHook(
        "DataWindow handler",
        storage.handler.functionIndex,
        storage.handler.params,
        storage.handler.results,
      )
    : null;
  if (
    storageHandler
    && bodyHash(storage.handler.functionIndex)
      !== storage.handler.bodySha256
  ) {
    fail("DataWindow handler body does not match its semantic fingerprint");
  }
  const storageSlashParserHook = capabilities.storage
    ? resolveHook(
        "storage slash parser",
        storage.slashParser.functionIndex,
        storage.slashParser.params,
        storage.slashParser.results,
      )
    : null;
  if (
    storageSlashParserHook
    && bodyHash(storage.slashParser.functionIndex)
      !== storage.slashParser.bodySha256
  ) {
    fail("storage slash parser body does not match its semantic fingerprint");
  }
  const travelProducer = capabilities.storage
    ? resolveHook(
        "travel payload producer",
        storage.travel.producer.functionIndex,
        storage.travel.producer.params,
        storage.travel.producer.results,
      )
    : null;
  if (
    travelProducer
    && bodyHash(storage.travel.producer.functionIndex)
      !== storage.travel.producer.bodySha256
  ) {
    fail("travel payload producer body does not match its semantic fingerprint");
  }
  const packetSender = capabilities.commands
    ? resolveHook(
        "traced packet sender",
        teamApply.professionTrace.sender.functionIndex,
        teamApply.professionTrace.sender.params,
        teamApply.professionTrace.sender.results,
      )
    : null;
  if (packetSender) {
    const body = createHash("sha256")
      .update(bodies[packetSender.localIndex]!)
      .digest("hex");
    if (body !== teamApply.professionTrace.sender.bodySha256) {
      fail(
        `traced packet sender resolves to function `
        + `${teamApply.professionTrace.sender.functionIndex}, whose body is `
        + `${body} and not the certified `
        + `${teamApply.professionTrace.sender.bodySha256}`,
      );
    }
  }
  const commandDrainBoundary = capabilities.commands || capabilities.storage
    ? resolveHook(
        "command drain boundary",
        gameThread.drain.functionIndex,
        gameThread.drain.params,
        gameThread.drain.results,
      )
    : null;
  if (commandDrainBoundary) {
    const body = createHash("sha256")
      .update(bodies[commandDrainBoundary.localIndex]!)
      .digest("hex");
    if (body !== gameThread.drain.bodySha256) {
      fail(
        `command drain boundary resolves to function `
        + `${gameThread.drain.functionIndex}, whose body is ${body} and not `
        + `the certified ${gameThread.drain.bodySha256}`,
      );
    }
  }

  const exclusiveRoles = [
    ...selected.map((hook) => ({
      name: `dispatch hook ${hook.dispatchKind}`,
      functionIndex: hook.localIndex + importCount,
    })),
    ...commands.map((entry) => ({
      name: `command opcode ${entry.opcode}`,
      functionIndex: entry.functionIndex,
    })),
    ...(packetSender ? [{
      name: "traced packet sender",
      functionIndex: packetSender.localIndex + importCount,
    }] : []),
    ...(commandDrainBoundary ? [{
      name: "command drain boundary",
      functionIndex: commandDrainBoundary.localIndex + importCount,
    }] : []),
    ...(storageHandler ? [{
      name: "DataWindow handler",
      functionIndex: storageHandler.localIndex + importCount,
    }] : []),
    ...(storageSlashParserHook ? [{
      name: "storage slash parser",
      functionIndex: storageSlashParserHook.localIndex + importCount,
    }] : []),
    ...(travelProducer ? [{
      name: "travel payload producer",
      functionIndex: travelProducer.localIndex + importCount,
    }] : []),
  ];
  const roleByFunction = new Map<number, string>();
  for (const role of exclusiveRoles) {
    const existing = roleByFunction.get(role.functionIndex);
    if (existing) {
      fail(`${role.name} must be distinct from ${existing}`);
    }
    roleByFunction.set(role.functionIndex, role.name);
  }

  const table = parseEnhancementTable(sectionById(sections, 4));
  if (
    table.flags !== 1 ||
    table.max === null ||
    table.min !== table.max ||
    table.max === 0xffff_ffff
  ) {
    fail("expected one bounded fixed-size function table");
  }
  if (build.tableSlot !== table.min) {
    fail(`hook table slot ${build.tableSlot} is not the new terminal slot`);
  }
  const nextTableSize = table.min + 1;
  const tableSlots = selectedHooks.cursor || commandDrainBoundary
    ? enhancementTableSlotFunctions(sectionById(sections, 9))
    : null;
  if (selectedHooks.cursor) {
    if (
      tableSlots?.get(cursorEvent.tableSlot)
      !== cursorEvent.functionIndex
    ) {
      fail(
        `cursor table slot ${cursorEvent.tableSlot} does not map to ` +
          `function ${cursorEvent.functionIndex}`,
      );
    }
  }
  if (
    commandDrainBoundary
    && tableSlots?.get(gameThread.drain.tableSlot)
      !== gameThread.drain.functionIndex
  ) {
    fail(
      `command drain table slot ${gameThread.drain.tableSlot} does not map `
      + `to function ${gameThread.drain.functionIndex}`,
    );
  }

  const globals = vectorPayload(sectionById(sections, 6));
  const exports = vectorPayload(sectionById(sections, 7));
  const existingExports = parseExports(sectionById(sections, 7));
  const addedExportNames = [
    ENHANCEMENT_HOOK_EXPORT,
    ...(capabilities.commands
      ? [teamApply.thunkExport, teamApply.professionTrace.readerExport]
      : []),
    ...(capabilities.storage
      ? [
          storage.openExport,
          storage.configureExport,
          storage.travel.enqueueExport,
          storage.travel.configureExport,
          storage.travel.toggleExport,
        ]
      : []),
  ];
  for (const name of addedExportNames) {
    if (existingExports.some((entry) => entry.name === name)) {
      fail(`export ${name} already exists`);
    }
  }
  let nextGlobalIndex = globals.count;
  const allocateGlobals = (count: number): number => {
    const first = nextGlobalIndex;
    nextGlobalIndex += count;
    return first;
  };
  const hasActions = capabilities.commands || capabilities.storage;
  const hookGlobalIndex = allocateGlobals(1);
  const commandPendingGlobalIndex = hasActions ? allocateGlobals(1) : 0;
  const commandArgumentGlobalBase = hasActions
    ? allocateGlobals(COMMAND_ARGS)
    : 0;
  const storagePayloadGlobalIndex = capabilities.storage ? allocateGlobals(1) : 0;
  const storageEnabledGlobalIndex = capabilities.storage ? allocateGlobals(1) : 0;
  const travelPayloadGlobalIndex = capabilities.storage ? allocateGlobals(1) : 0;
  const travelEnabledGlobalIndex = capabilities.storage ? allocateGlobals(1) : 0;
  const travelToggleGlobalIndex = capabilities.storage ? allocateGlobals(1) : 0;
  const traceGlobalBase = capabilities.commands
    ? allocateGlobals(PROFESSION_TRACE_WORDS)
    : 0;
  const traceGlobals: ProfessionTraceGlobals | null = capabilities.commands
    ? {
        origin: traceGlobalBase,
        builderCount: traceGlobalBase + 1,
        builderOrigin: traceGlobalBase + 2,
        builderTarget: traceGlobalBase + 3,
        builderProfession: traceGlobalBase + 4,
        skillBuilderCount: traceGlobalBase + 5,
        skillBuilderOrigin: traceGlobalBase + 6,
        skillBuilderTarget: traceGlobalBase + 7,
        skillBuilderSkillCount: traceGlobalBase + 8,
        senderCount: traceGlobalBase + 9,
        senderOrigin: traceGlobalBase + 10,
        senderConnection: traceGlobalBase + 11,
        senderState: traceGlobalBase + 12,
        senderTransport: traceGlobalBase + 13,
        senderCursorBefore: traceGlobalBase + 14,
        senderCursorAfter: traceGlobalBase + 15,
        senderFlagBefore: traceGlobalBase + 16,
        senderFlagAfter: traceGlobalBase + 17,
        senderSize: traceGlobalBase + 18,
        senderPayload: traceGlobalBase + 19,
      }
    : null;

  const nextTypes = [...types];
  const appendType = (type: FunctionType): number => {
    nextTypes.push(type);
    return nextTypes.length - 1;
  };
  const dispatchTypeIndex = appendType({
    params: Array<number>(DISPATCH_PARAMS).fill(0x7f),
    results: [],
  });
  const commandTypeIndex = capabilities.commands
    ? appendType({ params: Array<number>(COMMAND_PARAMS).fill(0x7f), results: [0x7f] })
    : null;
  const commandDrainTypeIndex = hasActions
    ? appendType({ params: [], results: [] })
    : null;
  const professionTraceReaderTypeIndex = capabilities.commands
    ? appendType({ params: [0x7f], results: [0x7f] })
    : null;
  const storageOpenTypeIndex = capabilities.storage
    ? appendType({ params: [], results: [0x7f] })
    : null;
  const storageConfigureTypeIndex = capabilities.storage
    ? appendType({ params: [0x7f, 0x7f], results: [0x7f] })
    : null;
  const travelEnqueueTypeIndex = capabilities.storage
    ? appendType({ params: Array<number>(COMMAND_ARGS).fill(0x7f), results: [0x7f] })
    : null;
  const travelConfigureTypeIndex = capabilities.storage
    ? appendType({ params: [0x7f, 0x7f], results: [0x7f] })
    : null;
  const travelToggleTypeIndex = capabilities.storage
    ? appendType({ params: [], results: [0x7f] })
    : null;

  const nextFunctionTypes = [...functionTypes];
  const nextBodies = [...bodies];
  const appendFunction = (typeIndex: number, body: Uint8Array): number => {
    const functionIndex = importCount + nextBodies.length;
    nextFunctionTypes.push(typeIndex);
    nextBodies.push(body);
    return functionIndex;
  };
  const selectedOriginalIndices = selected.map((hook) =>
    appendFunction(hook.typeIndex, bodies[hook.localIndex]!));
  const uiOriginalIndex = selectedHooks.ui
    ? selectedOriginalIndices[selected.findIndex((hook) => hook.dispatchKind === DISPATCH_UI)]!
    : null;
  selected.forEach((hook, index) => {
    nextBodies[hook.localIndex] = dispatcher(
      hook.type.params.length,
      hook.dispatchKind,
      dispatchTypeIndex,
      selectedOriginalIndices[index]!,
      hookGlobalIndex,
    );
  });

  const addedFunctionExports: Array<Readonly<{ name: string; index: number }>> = [];
  if (commandDrainBoundary) {
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
    const storageSlashParserOriginalIndex = storageSlashParserHook
      ? appendFunction(
          storageSlashParserHook.typeIndex,
          bodies[storageSlashParserHook.localIndex]!,
        )
      : null;
    const commandDrainFunctionIndex = appendFunction(
      commandDrainTypeIndex!,
      commandDrain(
        commands,
        commandPendingGlobalIndex,
        commandArgumentGlobalBase,
        traceGlobals?.origin ?? null,
        capabilities.storage
          ? {
              functionIndex: storage.handler.functionIndex,
              payloadGlobalIndex: storagePayloadGlobalIndex,
            }
          : null,
        capabilities.storage
          ? {
              dispatcherFunctionIndex: uiOriginalIndex!,
              messageId: storage.travel.messageId,
              payloadGlobalIndex: travelPayloadGlobalIndex,
            }
          : null,
      ),
    );
    nextBodies[commandDrainBoundary.localIndex] = commandBoundary(
      commandDrainBoundary.type.params.length,
      commandBoundaryOriginalIndex,
      commandDrainFunctionIndex,
    );
    if (capabilities.commands) {
      nextBodies[professionBuilder!.localIndex] = tracedProfessionBuilder(
        professionOriginalIndex!,
        traceGlobals!,
      );
      nextBodies[skillBuilder!.localIndex] = tracedSkillBuilder(
        skillOriginalIndex!,
        traceGlobals!,
      );
      nextBodies[packetSender!.localIndex] = tracedPacketSender(
        senderOriginalIndex!,
        traceGlobals!,
      );
      addedFunctionExports.push(
        {
          name: teamApply.thunkExport,
          index: appendFunction(
            commandTypeIndex!,
            commandEnqueue(commands, commandPendingGlobalIndex, commandArgumentGlobalBase),
          ),
        },
        {
          name: teamApply.professionTrace.readerExport,
          index: appendFunction(
            professionTraceReaderTypeIndex!,
            professionTraceReader(traceGlobals!),
          ),
        },
      );
    }
    if (capabilities.storage) {
      nextBodies[storageSlashParserHook!.localIndex] = localActionSlashParser(
        storageSlashParserOriginalIndex!,
        commandPendingGlobalIndex,
        storagePayloadGlobalIndex,
        storageEnabledGlobalIndex,
        travelEnabledGlobalIndex,
        travelToggleGlobalIndex,
      );
      addedFunctionExports.push(
        {
          name: storage.openExport,
          index: appendFunction(
            storageOpenTypeIndex!,
            storageEnqueue(
              commandPendingGlobalIndex,
              storagePayloadGlobalIndex,
              storageEnabledGlobalIndex,
            ),
          ),
        },
        {
          name: storage.configureExport,
          index: appendFunction(
            storageConfigureTypeIndex!,
            storageConfigure(
              commandPendingGlobalIndex,
              storagePayloadGlobalIndex,
              storageEnabledGlobalIndex,
            ),
          ),
        },
        {
          name: storage.travel.enqueueExport,
          index: appendFunction(
            travelEnqueueTypeIndex!,
            travelEnqueue(
              commandPendingGlobalIndex,
              commandArgumentGlobalBase,
              travelPayloadGlobalIndex,
              travelEnabledGlobalIndex,
            ),
          ),
        },
        {
          name: storage.travel.configureExport,
          index: appendFunction(
            travelConfigureTypeIndex!,
            travelConfigure(
              commandPendingGlobalIndex,
              travelPayloadGlobalIndex,
              travelEnabledGlobalIndex,
            ),
          ),
        },
        {
          name: storage.travel.toggleExport,
          index: appendFunction(
            travelToggleTypeIndex!,
            travelToggleTake(travelToggleGlobalIndex),
          ),
        },
      );
    }
  }
  const addedGlobalCount = nextGlobalIndex - globals.count;
  const nextGlobals = concat(
    uleb(globals.count + addedGlobalCount),
    globals.entries,
    ...Array.from({ length: addedGlobalCount }, () =>
      Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b)),
  );
  const nextExports = concat(
    uleb(exports.count + addedExportNames.length),
    exports.entries,
    encodeName(ENHANCEMENT_HOOK_EXPORT),
    Uint8Array.of(0x03),
    uleb(hookGlobalIndex),
    ...addedFunctionExports.map(({ name, index }) => concat(
      encodeName(name),
      Uint8Array.of(0x00),
      uleb(index),
    )),
  );

  const rewritten = sections.map((section): Section => {
    if (section.id === 1) return { id: section.id, body: encodeTypes(nextTypes) };
    if (section.id === 3) {
      return { id: section.id, body: encodeIndexVector(nextFunctionTypes) };
    }
    if (section.id === 4) {
      return {
        id: section.id,
        body: encodeEnhancementTable(table.flags, nextTableSize, nextTableSize),
      };
    }
    if (section.id === 6) return { id: section.id, body: nextGlobals };
    if (section.id === 7) return { id: section.id, body: nextExports };
    if (section.id === 10) return { id: section.id, body: encodeCode(nextBodies) };
    return section;
  });
  const output = concat(
    WASM_HEADER,
    ...rewritten.map(encodeSection),
    encodeSection(buildManifestSection(build, capabilities)),
  );
  if (!WebAssembly.validate(output)) {
    try {
      new WebAssembly.Module(output);
    } catch (error) {
      fail(`rewritten module failed validation: ${String(error)}`);
    }
    fail("rewritten module failed validation");
  }
  return output;
}
