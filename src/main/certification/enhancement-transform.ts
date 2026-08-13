/**
 * The Enhancement transform: given one exact certified build, appends the hook
 * dispatch machinery to its WebAssembly and reserves the table slot the
 * companion kernel is installed into.
 *
 * The input hash is checked against the build entry before a byte is read, and
 * every hook's function signature is re-verified against the certified one, so
 * a table entry that has gone stale fails loudly instead of producing a module
 * that traps at runtime. Capability selection is exact — three booleans, no
 * extra keys, and a profile that has no certified output hash is refused rather
 * than derived.
 *
 * Hook ordering is part of the output identity, not an implementation detail:
 * it determines relocated function indices and therefore the resulting bytes,
 * so no capability selection may inherit another's ordering.
 *
 * `inspectEnhancementCandidate` is the read-only half. It reports what a module
 * looks like and certifies nothing.
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
  findEnhancementBuild,
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
  concat,
  countFunctionImports,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  parseCode,
  parseIndexVector,
  parseExports,
  parseTypes,
  readSleb,
  readUleb,
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

declare const WebAssembly: {
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
    keys.length !== 4
    || !Object.hasOwn(record, "nativeCursor")
    || !Object.hasOwn(record, "targetObservation")
    || !Object.hasOwn(record, "partyObservation")
    || !Object.hasOwn(record, "commands")
    || typeof record.nativeCursor !== "boolean"
    || typeof record.targetObservation !== "boolean"
    || typeof record.partyObservation !== "boolean"
    || typeof record.commands !== "boolean"
  ) {
    return null;
  }
  return Object.freeze({
    nativeCursor: record.nativeCursor,
    targetObservation: record.targetObservation,
    partyObservation: record.partyObservation,
    commands: record.commands,
  });
}

function encodeName(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(uleb(bytes.byteLength), bytes);
}

function parseTable(bytes: Uint8Array): {
  flags: number;
  min: number;
  max: number | null;
} {
  const cursor = { offset: 0 };
  if (readUleb(bytes, cursor) !== 1) fail("expected exactly one table");
  if (bytes[cursor.offset++] !== 0x70) fail("expected funcref table");
  const flags = readUleb(bytes, cursor);
  const min = readUleb(bytes, cursor);
  const max = (flags & 1) !== 0 ? readUleb(bytes, cursor) : null;
  if (cursor.offset !== bytes.byteLength) fail("malformed table section");
  return { flags, min, max };
}

function encodeTable(flags: number, min: number, max: number): Uint8Array {
  return concat(
    uleb(1),
    Uint8Array.of(0x70),
    uleb(flags),
    uleb(min),
    uleb(max),
  );
}

function tableSlotFunctions(bytes: Uint8Array): Map<number, number> {
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const slots = new Map<number, number>();
  for (let segment = 0; segment < count; segment += 1) {
    const flags = readUleb(bytes, cursor);
    if (flags !== 0) fail(`unsupported element segment flags ${flags}`);
    if (bytes[cursor.offset++] !== 0x41) fail("expected element i32.const");
    const base = readSleb(bytes, cursor);
    if (bytes[cursor.offset++] !== 0x0b) fail("malformed element offset");
    const entries = readUleb(bytes, cursor);
    for (let i = 0; i < entries; i += 1) {
      const functionIndex = readUleb(bytes, cursor);
      const slot = base + i;
      if (slots.has(slot)) fail(`duplicate active table slot ${slot}`);
      slots.set(slot, functionIndex);
    }
  }
  if (cursor.offset !== bytes.byteLength) fail("malformed element section");
  return slots;
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

/** The exact frame-API boundary used by GWCA's game-thread queue. */
function commandBoundary(
  paramCount: number,
  originalIndex: number,
  drainIndex: number,
): Uint8Array {
  const args = Array.from({ length: paramCount }, (_, index) =>
    concat(Uint8Array.of(0x20), uleb(index)),
  );
  return concat(
    uleb(0),
    // GWCA's OnLeaveGameThread drains queued work before invoking the original
    // frame function. Preserve that ordering rather than treating any
    // game-owned callback as an interchangeable "tick".
    Uint8Array.of(0x10), uleb(drainIndex),
    ...args,
    Uint8Array.of(0x10), uleb(originalIndex),
    Uint8Array.of(0x0b),
  );
}

/**
 * The command enqueue function: one exported function and one
 * `br_table`-free chain of exact opcode comparisons.
 *
 *     enhancement_command(opcode, a0, a1, a2, a3) -> i32   // 1 queued, 0 refused
 *
 * This is the whole write surface and it is deliberately shaped so that there
 * is no other. The companion kernel is a Wasm side module: its only route into
 * the client is the imported function table, and not one packet builder — nor
 * the sender, nor the connection read — is in that table. So without this
 * function there is no call from the kernel to any of them anywhere in the
 * module. Not a forbidden call; a nonexistent one.
 *
 * That property is what makes the capability meaningful. With `commands` off
 * the thunk is not emitted, and "the companion cannot send a packet" is a fact
 * about the bytes rather than a runtime check somebody could get wrong.
 *
 * Calling a client packet builder re-entrantly from JavaScript is not a valid
 * game-thread boundary. The exported function therefore writes at most one
 * command into private globals. The certified frame-API boundary used by
 * GWCA's game-thread queue drains that mailbox before its original function,
 * while execution is on the game-owned call stack with the packet context in
 * scope. Arguments are written before the opcode, which is the mailbox's ready
 * bit.
 *
 * Unknown opcodes and a second command while one is pending return 0 rather
 * than trapping. A refusal the caller can observe is worth more than an abort:
 * a stale or overlapping renderer request becomes a no-op instead of a dead
 * client.
 */
function commandEnqueue(
  entries: readonly Readonly<{ opcode: number; functionIndex: number; params: readonly string[] }>[],
  pendingGlobalIndex: number,
  argumentGlobalBase: number,
): Uint8Array {
  return concat(
    uleb(0),                                          // no locals
    Uint8Array.of(0x20), uleb(0),                    // opcode zero cancels
    Uint8Array.of(0x45),
    Uint8Array.of(0x04, 0x40),
    Uint8Array.of(0x41), sleb(0),
    Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(1),
    Uint8Array.of(0x0f),
    Uint8Array.of(0x0b),
    Uint8Array.of(0x23), uleb(pendingGlobalIndex),    // global.get pending
    Uint8Array.of(0x45),                              // i32.eqz
    Uint8Array.of(0x04, 0x40),                        // if mailbox is empty
    ...entries.map((entry) => concat(
      Uint8Array.of(0x20), uleb(0),                   // local.get opcode
      Uint8Array.of(0x41), sleb(entry.opcode),
      Uint8Array.of(0x46),                            // i32.eq
      Uint8Array.of(0x04, 0x40),                      // if
      ...Array.from({ length: COMMAND_ARGS }, (_, index) => concat(
        Uint8Array.of(0x20), uleb(index + 1),          // local.get argument
        Uint8Array.of(0x24), uleb(argumentGlobalBase + index),
      )),
      Uint8Array.of(0x20), uleb(0),                   // publish opcode last
      Uint8Array.of(0x24), uleb(pendingGlobalIndex),
      Uint8Array.of(0x41), sleb(1),
      Uint8Array.of(0x0f),                            // return
      Uint8Array.of(0x0b),                            // end if
    )),
    Uint8Array.of(0x0b),                              // end mailbox-empty if
    Uint8Array.of(0x41), sleb(0),                     // refused
    Uint8Array.of(0x0b),
  );
}

/** Runs only from the certified frame-API boundary, never as a JS export. */
function commandDrain(
  entries: readonly Readonly<{ opcode: number; functionIndex: number; params: readonly string[] }>[],
  pendingGlobalIndex: number,
  argumentGlobalBase: number,
  traceOriginGlobalIndex: number,
): Uint8Array {
  return concat(
    uleb(0),
    ...entries.map((entry) => concat(
      Uint8Array.of(0x23), uleb(pendingGlobalIndex),
      Uint8Array.of(0x41), sleb(entry.opcode),
      Uint8Array.of(0x46),
      Uint8Array.of(0x04, 0x40),
      // Clear before entering client code so even a re-entrant observer can
      // never see and dispatch the same command twice.
      Uint8Array.of(0x41), sleb(0),
      Uint8Array.of(0x24), uleb(pendingGlobalIndex),
      // Mark the synchronous builder/sender chain as GWonMac-owned. Native UI
      // calls see the default zero and are therefore directly comparable.
      Uint8Array.of(0x41), sleb(1),
      Uint8Array.of(0x24), uleb(traceOriginGlobalIndex),
      ...entry.params.map((_, index) =>
        concat(Uint8Array.of(0x23), uleb(argumentGlobalBase + index))),
      Uint8Array.of(0x10), uleb(entry.functionIndex),
      Uint8Array.of(0x41), sleb(0),
      Uint8Array.of(0x24), uleb(traceOriginGlobalIndex),
      Uint8Array.of(0x0f),
      Uint8Array.of(0x0b),
    )),
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

export interface EnhancementCandidateReport {
  sha256: string;
  validWasm: boolean;
  certifiedBuildId: number | null;
  mainLoop: {
    functionIndex: number;
    params: string[];
    results: string[];
  } | null;
  table: {
    min: number;
    max: number | null;
    firstEmptySlots: number[];
  } | null;
}

export function inspectEnhancementCandidate(
  input: Uint8Array,
): EnhancementCandidateReport {
  const sha256 = createHash("sha256").update(input).digest("hex");
  if (!WebAssembly.validate(input)) {
    return {
      sha256,
      validWasm: false,
      certifiedBuildId: null,
      mainLoop: null,
      table: null,
    };
  }
  const sections = splitSections(input);
  const types = parseTypes(sectionById(sections, 1));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const mainLoopExport = parseExports(sectionById(sections, 7)).find(
    (entry) => entry.kind === 0 && entry.name === "EmscriptenExeThreadMainLoop",
  );
  let mainLoop: EnhancementCandidateReport["mainLoop"] = null;
  if (mainLoopExport && mainLoopExport.index >= importCount) {
    const localIndex = mainLoopExport.index - importCount;
    const typeIndex = functionTypes[localIndex];
    const type = typeIndex === undefined ? undefined : types[typeIndex];
    if (type) {
      mainLoop = {
        functionIndex: mainLoopExport.index,
        params: type.params.map(valueTypeName),
        results: type.results.map(valueTypeName),
      };
    }
  }
  let table: EnhancementCandidateReport["table"];
  try {
    const { min, max } = parseTable(sectionById(sections, 4));
    const occupied = tableSlotFunctions(sectionById(sections, 9));
    const firstEmptySlots: number[] = [];
    for (
      let slot = 0;
      slot < min && firstEmptySlots.length < 8;
      slot += 1
    ) {
      if (!occupied.has(slot)) firstEmptySlots.push(slot);
    }
    table = { min, max, firstEmptySlots };
  } catch {
    table = null;
  }
  return {
    sha256,
    validWasm: true,
    certifiedBuildId: findEnhancementBuild(sha256)?.buildId ?? null,
    mainLoop,
    table,
  };
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
  ) {
    fail("capability facts are not certified for this build");
  }
  const cursorEvent = build.cursorEvent!;
  const partyObservation = build.partyObservation!;
  const teamApply = build.teamApply!;
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
  if (new Set(selected.map((hook) => hook.localIndex)).size !== selected.length) {
    fail("selected hooks must resolve to distinct functions");
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
  if (
    capabilities.commands
    && new Set(commands.map((entry) => entry.functionIndex)).size !== commands.length
  ) {
    fail("certified commands must resolve to distinct functions");
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
    if (
      selected.some((hook) => hook.localIndex === packetSender.localIndex)
      || commands.some((entry) => entry.functionIndex
        === teamApply.professionTrace.sender.functionIndex)
    ) {
      fail("traced packet sender must be distinct from hooks and commands");
    }
  }
  const commandDrainBoundary = capabilities.commands
    ? resolveHook(
        "command drain boundary",
        teamApply.drain.functionIndex,
        teamApply.drain.params,
        teamApply.drain.results,
      )
    : null;
  if (commandDrainBoundary) {
    const body = createHash("sha256")
      .update(bodies[commandDrainBoundary.localIndex]!)
      .digest("hex");
    if (body !== teamApply.drain.bodySha256) {
      fail(
        `command drain boundary resolves to function `
        + `${teamApply.drain.functionIndex}, whose body is ${body} and not `
        + `the certified ${teamApply.drain.bodySha256}`,
      );
    }
    if (
      selected.some((hook) => hook.localIndex === commandDrainBoundary.localIndex)
      || commands.some((entry) => entry.functionIndex === teamApply.drain.functionIndex)
      || packetSender?.localIndex === commandDrainBoundary.localIndex
    ) {
      fail("command drain boundary must be distinct from hooks, commands, and sender");
    }
  }

  const table = parseTable(sectionById(sections, 4));
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
    ? tableSlotFunctions(sectionById(sections, 9))
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
    && tableSlots?.get(teamApply.drain.tableSlot)
      !== teamApply.drain.functionIndex
  ) {
    fail(
      `command drain table slot ${teamApply.drain.tableSlot} does not map `
      + `to function ${teamApply.drain.functionIndex}`,
    );
  }

  const globals = vectorPayload(sectionById(sections, 6));
  const exports = vectorPayload(sectionById(sections, 7));
  const existingExports = parseExports(sectionById(sections, 7));
  const addedExportNames = capabilities.commands
    ? [
        ENHANCEMENT_HOOK_EXPORT,
        teamApply.thunkExport,
        teamApply.professionTrace.readerExport,
      ]
    : [ENHANCEMENT_HOOK_EXPORT];
  for (const name of addedExportNames) {
    if (existingExports.some((entry) => entry.name === name)) {
      fail(`export ${name} already exists`);
    }
  }
  const originalBaseIndex = importCount + bodies.length;
  const hookGlobalIndex = globals.count;
  const commandPendingGlobalIndex = hookGlobalIndex + 1;
  const commandArgumentGlobalBase = commandPendingGlobalIndex + 1;
  const traceGlobalBase = commandArgumentGlobalBase + COMMAND_ARGS;
  const traceGlobals: ProfessionTraceGlobals = {
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
  };
  const dispatchTypeIndex = types.length;

  // After the dispatch type, so `dispatchTypeIndex` is `types.length` whether or
  // not commands are on and the read profiles gain no unused type.
  const commandTypeIndex = types.length + 1;
  const commandDrainTypeIndex = types.length + 2;
  const professionTraceReaderTypeIndex = types.length + 3;
  const nextTypes = [
    ...types,
    { params: Array<number>(DISPATCH_PARAMS).fill(0x7f), results: [] },
    ...(capabilities.commands
      ? [
          { params: Array<number>(COMMAND_PARAMS).fill(0x7f), results: [0x7f] },
          { params: [], results: [] },
          { params: [0x7f], results: [0x7f] },
        ]
      : []),
  ];
  const nextFunctionTypes = [
    ...functionTypes,
    ...selected.map((hook) => hook.typeIndex),
    ...(commandDrainBoundary
      ? [
          commandDrainBoundary.typeIndex,
          commandTypeIndex,
          commandDrainTypeIndex,
          professionBuilder!.typeIndex,
          skillBuilder!.typeIndex,
          packetSender!.typeIndex,
          professionTraceReaderTypeIndex,
        ]
      : []),
  ];
  const nextBodies = [
    ...bodies,
    ...selected.map((hook) => bodies[hook.localIndex]!),
    ...(commandDrainBoundary
      ? [
          bodies[commandDrainBoundary.localIndex]!,
          commandEnqueue(
            commands,
            commandPendingGlobalIndex,
            commandArgumentGlobalBase,
          ),
          commandDrain(
            commands,
            commandPendingGlobalIndex,
            commandArgumentGlobalBase,
            traceGlobals.origin,
          ),
          bodies[professionBuilder!.localIndex]!,
          bodies[skillBuilder!.localIndex]!,
          bodies[packetSender!.localIndex]!,
          professionTraceReader(traceGlobals),
        ]
      : []),
  ];
  // The frame boundary's relocated original precedes both private command
  // functions. Only the enqueue function is exported.
  const commandBoundaryOriginalIndex = originalBaseIndex + selected.length;
  const commandFunctionIndex = commandBoundaryOriginalIndex + 1;
  const commandDrainFunctionIndex = commandFunctionIndex + 1;
  const professionOriginalIndex = commandDrainFunctionIndex + 1;
  const skillOriginalIndex = professionOriginalIndex + 1;
  const senderOriginalIndex = skillOriginalIndex + 1;
  const professionTraceReaderIndex = senderOriginalIndex + 1;
  selected.forEach((hook, index) => {
    nextBodies[hook.localIndex] = dispatcher(
      hook.type.params.length,
      hook.dispatchKind,
      dispatchTypeIndex,
      originalBaseIndex + index,
      hookGlobalIndex,
    );
  });
  if (commandDrainBoundary) {
    nextBodies[commandDrainBoundary.localIndex] = commandBoundary(
      commandDrainBoundary.type.params.length,
      commandBoundaryOriginalIndex,
      commandDrainFunctionIndex,
    );
    nextBodies[professionBuilder!.localIndex] = tracedProfessionBuilder(
      professionOriginalIndex,
      traceGlobals,
    );
    nextBodies[skillBuilder!.localIndex] = tracedSkillBuilder(
      skillOriginalIndex,
      traceGlobals,
    );
    nextBodies[packetSender!.localIndex] = tracedPacketSender(
      senderOriginalIndex,
      traceGlobals,
    );
  }
  const addedGlobalCount = capabilities.commands
    ? 2 + COMMAND_ARGS + PROFESSION_TRACE_WORDS
    : 1;
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
    ...(capabilities.commands
      ? [
          encodeName(teamApply.thunkExport),
          Uint8Array.of(0x00),
          uleb(commandFunctionIndex),
          encodeName(teamApply.professionTrace.readerExport),
          Uint8Array.of(0x00),
          uleb(professionTraceReaderIndex),
        ]
      : []),
  );

  const rewritten = sections.map((section): Section => {
    if (section.id === 1) return { id: section.id, body: encodeTypes(nextTypes) };
    if (section.id === 3) {
      return { id: section.id, body: encodeIndexVector(nextFunctionTypes) };
    }
    if (section.id === 4) {
      return {
        id: section.id,
        body: encodeTable(table.flags, nextTableSize, nextTableSize),
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
  if (!WebAssembly.validate(output)) fail("rewritten module failed validation");
  return output;
}
