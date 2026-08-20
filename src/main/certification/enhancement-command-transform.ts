/**
 * The feature-local WebAssembly command rewrite plan for Team Apply and storage.
 * It emits bounded mailbox builders without owning the surrounding module transform.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";

const COMMAND_ARGS = 4;
const STORAGE_COMMAND = -1;
const TRAVEL_COMMAND = -2;
const TRAVEL_MAP_OFFSET = 0;
const TRAVEL_REGION_OFFSET = 4;
const TRAVEL_LANGUAGE_OFFSET = 8;
const TRAVEL_DISTRICT_OFFSET = 12;
const INVALID_TRAVEL_CONTEXT = -1;
const VALID_TRAVEL_REGIONS = [-2, 0, 1, 2, 3, 4] as const;
const VALID_TRAVEL_LANGUAGES = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 17] as const;

type CommandEntry = Readonly<{
  opcode: number;
  functionIndex: number;
  params: readonly string[];
}>;

/** Queues the one argument-free storage action when policy and payload allow it. */
export function storageEnqueue(
  pendingGlobalIndex: number,
  payloadGlobalIndex: number,
  enabledGlobalIndex: number,
): Uint8Array {
  return concat(
    uleb(0),
    Uint8Array.of(0x23), uleb(enabledGlobalIndex), Uint8Array.of(0x45, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x0f, 0x0b),
    Uint8Array.of(0x23), uleb(payloadGlobalIndex), Uint8Array.of(0x45, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x0f, 0x0b),
    Uint8Array.of(0x23), uleb(pendingGlobalIndex), Uint8Array.of(0x04, 0x40),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x0f, 0x0b),
    Uint8Array.of(0x41), sleb(STORAGE_COMMAND),
    Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x0b),
  );
}

/** Publishes the installer-owned payload and the current fail-closed policy. */
export function storageConfigure(
  pendingGlobalIndex: number,
  payloadGlobalIndex: number,
  enabledGlobalIndex: number,
): Uint8Array {
  return configureLocalAction(
    pendingGlobalIndex,
    payloadGlobalIndex,
    enabledGlobalIndex,
    STORAGE_COMMAND,
  );
}

function configureLocalAction(
  pendingGlobalIndex: number,
  payloadGlobalIndex: number,
  enabledGlobalIndex: number,
  command: number,
): Uint8Array {
  return concat(
    uleb(0),
    Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x24), uleb(payloadGlobalIndex),
    Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x45, 0x45),
    Uint8Array.of(0x20), uleb(1), Uint8Array.of(0x45, 0x45, 0x71),
    Uint8Array.of(0x24), uleb(enabledGlobalIndex),
    Uint8Array.of(0x23), uleb(enabledGlobalIndex), Uint8Array.of(0x45, 0x04, 0x40),
    Uint8Array.of(0x23), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(command), Uint8Array.of(0x46, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    Uint8Array.of(0x0b, 0x0b),
    Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x0b),
  );
}

/** Queues one reviewed map id; live context is derived on the game thread. */
export function travelEnqueue(
  pendingGlobalIndex: number,
  argumentGlobalBase: number,
  payloadGlobalIndex: number,
  enabledGlobalIndex: number,
  reviewedMapIds: readonly number[],
): Uint8Array {
  const refuse = (condition: Uint8Array) => concat(
    condition,
    Uint8Array.of(0x04, 0x40, 0x41), sleb(0), Uint8Array.of(0x0f, 0x0b),
  );
  return concat(
    uleb(0),
    refuse(concat(Uint8Array.of(0x23), uleb(enabledGlobalIndex), Uint8Array.of(0x45))),
    refuse(concat(Uint8Array.of(0x23), uleb(payloadGlobalIndex), Uint8Array.of(0x45))),
    refuse(concat(Uint8Array.of(0x23), uleb(pendingGlobalIndex))),
    refuse(concat(localValueIsOneOf(0, reviewedMapIds), Uint8Array.of(0x45))),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x24), uleb(argumentGlobalBase),
    Uint8Array.of(0x41), sleb(TRAVEL_COMMAND),
    Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x0b),
  );
}

/** Publishes the installer-owned 16-byte travel payload and live policy. */
export function travelConfigure(
  pendingGlobalIndex: number,
  payloadGlobalIndex: number,
  enabledGlobalIndex: number,
): Uint8Array {
  return configureLocalAction(
    pendingGlobalIndex,
    payloadGlobalIndex,
    enabledGlobalIndex,
    TRAVEL_COMMAND,
  );
}

/** Takes and clears the one-shot request to show or hide Quick Travel. */
export function travelToggleTake(toggleGlobalIndex: number): Uint8Array {
  return concat(
    uleb(0),
    Uint8Array.of(0x23), uleb(toggleGlobalIndex),
    Uint8Array.of(0x41), sleb(0),
    Uint8Array.of(0x24), uleb(toggleGlobalIndex),
    Uint8Array.of(0x0b),
  );
}

/** Compares one local UTF-16LE pointer with one exact null-terminated command. */
function exactSlashCommand(pointerLocalIndex: number, value: string): Uint8Array {
  const units = Array.from({ length: value.length }, (_, index) =>
    value.charCodeAt(index),
  );
  units.push(0);
  const comparisons: Uint8Array[] = [];
  for (let index = 0; index < units.length; index += 2) {
    const remaining = units.length - index;
    const width = remaining === 1 ? 2 : 4;
    const expected = width === 2
      ? units[index]!
      : units[index]! | (units[index + 1]! << 16);
    comparisons.push(concat(
      Uint8Array.of(0x20), uleb(pointerLocalIndex),
      Uint8Array.of(width === 2 ? 0x2f : 0x28),
      uleb(width === 2 ? 1 : 2),
      uleb(index * 2),
      Uint8Array.of(0x41), sleb(expected),
      Uint8Array.of(0x46),
      ...(index === 0 ? [] : [Uint8Array.of(0x71)]),
    ));
  }
  return concat(...comparisons);
}

/** Consumes the exact local-action slash commands at their named boundaries. */
export function localActionSlashParser(
  originalIndex: number,
  pendingGlobalIndex: number,
  payloadGlobalIndex: number,
  enabledGlobalIndex: number,
  travelEnabledGlobalIndex: number,
  travelToggleGlobalIndex: number,
  travelAliases: boolean,
  xunlaiAliases: boolean,
): Uint8Array {
  const original = () => concat(
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x20), uleb(1),
    Uint8Array.of(0x10), uleb(originalIndex),
  );
  return concat(
    uleb(0),
    ...(travelAliases ? [concat(
      // Travel has its own setting and does not borrow the storage mailbox or
      // payload. The renderer takes this bounded signal.
      Uint8Array.of(0x02, 0x40),
      exactSlashCommand(1, "/tp"),
      Uint8Array.of(0x45, 0x0d), uleb(0),
      Uint8Array.of(0x23), uleb(travelEnabledGlobalIndex),
      Uint8Array.of(0x45, 0x0d), uleb(0),
      Uint8Array.of(0x41), sleb(1),
      Uint8Array.of(0x24), uleb(travelToggleGlobalIndex),
      Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x0f, 0x0b),
    )] : []),
    ...(xunlaiAliases ? [concat(
      Uint8Array.of(0x23), uleb(enabledGlobalIndex), Uint8Array.of(0x45, 0x04, 0x40),
      original(), Uint8Array.of(0x0f, 0x0b),
      Uint8Array.of(0x23), uleb(payloadGlobalIndex), Uint8Array.of(0x45, 0x04, 0x40),
      original(), Uint8Array.of(0x0f, 0x0b),
      exactSlashCommand(1, "/chest"),
      exactSlashCommand(1, "/xunlai"),
      Uint8Array.of(0x72, 0x45, 0x04, 0x40),
      original(), Uint8Array.of(0x0f, 0x0b),
      // A recognized local command stays consumed while the bounded mailbox is
      // busy; falling through would incorrectly show Guild Wars' Unknown command.
      Uint8Array.of(0x23), uleb(pendingGlobalIndex), Uint8Array.of(0x04, 0x40),
      Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x0f, 0x0b),
      Uint8Array.of(0x41), sleb(STORAGE_COMMAND),
      Uint8Array.of(0x24), uleb(pendingGlobalIndex),
      Uint8Array.of(0x41), sleb(1),
    )] : [original()]),
    Uint8Array.of(0x0b),
  );
}

/** The exact frame-API boundary used by GWCA's game-thread queue. */
export function commandBoundary(
  paramCount: number,
  originalIndex: number,
  drainIndex: number,
): Uint8Array {
  const args = Array.from({ length: paramCount }, (_, index) =>
    concat(Uint8Array.of(0x20), uleb(index)),
  );
  return concat(
    uleb(0),
    Uint8Array.of(0x10), uleb(drainIndex),
    ...args,
    Uint8Array.of(0x10), uleb(originalIndex),
    Uint8Array.of(0x0b),
  );
}

/** Emits the only exported Team Apply packet-builder mailbox. */
export function commandEnqueue(
  entries: readonly CommandEntry[],
  pendingGlobalIndex: number,
  argumentGlobalBase: number,
): Uint8Array {
  return concat(
    uleb(0),
    Uint8Array.of(0x20), uleb(0),
    Uint8Array.of(0x45, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(0),
    Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(1),
    Uint8Array.of(0x0f, 0x0b),
    Uint8Array.of(0x23), uleb(pendingGlobalIndex),
    Uint8Array.of(0x45, 0x04, 0x40),
    ...entries.map((entry) => concat(
      Uint8Array.of(0x20), uleb(0),
      Uint8Array.of(0x41), sleb(entry.opcode),
      Uint8Array.of(0x46, 0x04, 0x40),
      ...Array.from({ length: COMMAND_ARGS }, (_, index) => concat(
        Uint8Array.of(0x20), uleb(index + 1),
        Uint8Array.of(0x24), uleb(argumentGlobalBase + index),
      )),
      Uint8Array.of(0x20), uleb(0),
      Uint8Array.of(0x24), uleb(pendingGlobalIndex),
      Uint8Array.of(0x41), sleb(1),
      Uint8Array.of(0x0f, 0x0b),
    )),
    Uint8Array.of(0x0b),
    Uint8Array.of(0x41), sleb(0),
    Uint8Array.of(0x0b),
  );
}

function valueIsOneOf(load: () => Uint8Array, values: readonly number[]): Uint8Array {
  return concat(...values.map((value, index) => concat(
    load(),
    Uint8Array.of(0x41), sleb(value), Uint8Array.of(0x46),
    ...(index === 0 ? [] : [Uint8Array.of(0x72)]),
  )));
}

function localValueIsOneOf(localIndex: number, values: readonly number[]): Uint8Array {
  return valueIsOneOf(
    () => concat(Uint8Array.of(0x20), uleb(localIndex)),
    values,
  );
}

function globalValueIsOneOf(globalIndex: number, values: readonly number[]): Uint8Array {
  return valueIsOneOf(
    () => concat(Uint8Array.of(0x23), uleb(globalIndex)),
    values,
  );
}

function payloadValueIsOneOf(
  payloadGlobalIndex: number,
  offset: number,
  values: readonly number[],
): Uint8Array {
  return valueIsOneOf(
    () => concat(
      Uint8Array.of(0x23), uleb(payloadGlobalIndex),
      Uint8Array.of(0x28), uleb(2), uleb(offset),
    ),
    values,
  );
}

function refuseUnless(valid: Uint8Array): Uint8Array {
  return concat(valid, Uint8Array.of(0x45, 0x04, 0x40, 0x0f, 0x0b));
}

type TravelDrainConfig = Readonly<{
  dispatcherFunctionIndex: number;
  contextResolverFunctionIndex: number;
  messageId: number;
  payloadGlobalIndex: number;
  reviewedMapIds: readonly number[];
}>;

/** Emits the complete fail-closed Travel branch of the game-thread drain. */
function travelDrain(
  pendingGlobalIndex: number,
  argumentGlobalBase: number,
  travel: TravelDrainConfig,
): Uint8Array {
  const storePayload = (offset: number, value: number) => concat(
    Uint8Array.of(0x23), uleb(travel.payloadGlobalIndex),
    Uint8Array.of(0x41), sleb(value),
    Uint8Array.of(0x36), uleb(2), uleb(offset),
  );
  return concat(
    Uint8Array.of(0x23), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(TRAVEL_COMMAND), Uint8Array.of(0x46, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    refuseUnless(globalValueIsOneOf(argumentGlobalBase, travel.reviewedMapIds)),
    Uint8Array.of(0x23), uleb(travel.payloadGlobalIndex),
    Uint8Array.of(0x23), uleb(argumentGlobalBase),
    Uint8Array.of(0x36), uleb(2), uleb(TRAVEL_MAP_OFFSET),
    storePayload(TRAVEL_REGION_OFFSET, INVALID_TRAVEL_CONTEXT),
    storePayload(TRAVEL_LANGUAGE_OFFSET, INVALID_TRAVEL_CONTEXT),
    Uint8Array.of(0x23), uleb(argumentGlobalBase),
    Uint8Array.of(0x23), uleb(travel.payloadGlobalIndex),
    Uint8Array.of(0x41), sleb(TRAVEL_REGION_OFFSET), Uint8Array.of(0x6a),
    Uint8Array.of(0x23), uleb(travel.payloadGlobalIndex),
    Uint8Array.of(0x41), sleb(TRAVEL_LANGUAGE_OFFSET), Uint8Array.of(0x6a),
    Uint8Array.of(0x10), uleb(travel.contextResolverFunctionIndex),
    storePayload(TRAVEL_DISTRICT_OFFSET, 0),
    refuseUnless(payloadValueIsOneOf(
      travel.payloadGlobalIndex,
      TRAVEL_REGION_OFFSET,
      VALID_TRAVEL_REGIONS,
    )),
    refuseUnless(payloadValueIsOneOf(
      travel.payloadGlobalIndex,
      TRAVEL_LANGUAGE_OFFSET,
      VALID_TRAVEL_LANGUAGES,
    )),
    Uint8Array.of(0x41), sleb(travel.messageId),
    Uint8Array.of(0x23), uleb(travel.payloadGlobalIndex),
    Uint8Array.of(0x41), sleb(0),
    Uint8Array.of(0x10), uleb(travel.dispatcherFunctionIndex),
    Uint8Array.of(0x0f, 0x0b),
  );
}

/** Runs queued commands only from the certified game-owned frame boundary. */
export function commandDrain(
  entries: readonly CommandEntry[],
  pendingGlobalIndex: number,
  argumentGlobalBase: number,
  trace: Readonly<{
    origin: number;
    drainCount: number;
    drainOpcode: number;
  }> | null,
  storage: Readonly<{ functionIndex: number; payloadGlobalIndex: number }> | null,
  travel: TravelDrainConfig | null,
): Uint8Array {
  return concat(
    uleb(0),
    ...(storage
      ? [concat(
          Uint8Array.of(0x23), uleb(pendingGlobalIndex),
          Uint8Array.of(0x41), sleb(STORAGE_COMMAND), Uint8Array.of(0x46, 0x04, 0x40),
          Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x24), uleb(pendingGlobalIndex),
          Uint8Array.of(0x23), uleb(storage.payloadGlobalIndex),
          Uint8Array.of(0x10), uleb(storage.functionIndex),
          Uint8Array.of(0x0f, 0x0b),
        )]
      : []),
    ...(travel ? [travelDrain(pendingGlobalIndex, argumentGlobalBase, travel)] : []),
    ...entries.map((entry) => concat(
      Uint8Array.of(0x23), uleb(pendingGlobalIndex),
      Uint8Array.of(0x41), sleb(entry.opcode),
      Uint8Array.of(0x46, 0x04, 0x40),
      Uint8Array.of(0x41), sleb(0),
      Uint8Array.of(0x24), uleb(pendingGlobalIndex),
      ...(trace === null
        ? []
        : [concat(
            Uint8Array.of(0x23), uleb(trace.drainCount),
            Uint8Array.of(0x41), sleb(1),
            Uint8Array.of(0x6a, 0x24), uleb(trace.drainCount),
            Uint8Array.of(0x41), sleb(entry.opcode),
            Uint8Array.of(0x24), uleb(trace.drainOpcode),
            Uint8Array.of(0x41), sleb(1),
            Uint8Array.of(0x24), uleb(trace.origin),
          )]),
      ...entry.params.map((_, index) =>
        concat(Uint8Array.of(0x23), uleb(argumentGlobalBase + index))),
      Uint8Array.of(0x10), uleb(entry.functionIndex),
      ...(trace === null
        ? []
        : [concat(
            Uint8Array.of(0x41), sleb(0),
            Uint8Array.of(0x24), uleb(trace.origin),
          )]),
      Uint8Array.of(0x0f, 0x0b),
    )),
    Uint8Array.of(0x0b),
  );
}
