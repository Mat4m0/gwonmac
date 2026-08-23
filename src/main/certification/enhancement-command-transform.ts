/**
 * Shared mailbox, Team Apply, Xunlai, and slash-parser WASM builders.
 * It emits bounded mailbox builders without owning the surrounding module transform.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";

const COMMAND_ARGS = 4;
const STORAGE_COMMAND = -1;

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

export function configureLocalAction(
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
  tradeEnabledGlobalIndex: number,
  tradeToggleGlobalIndex: number,
  tradeAliases: boolean,
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
    ...(tradeAliases ? [concat(
      Uint8Array.of(0x02, 0x40),
      exactSlashCommand(1, "/trade"),
      Uint8Array.of(0x45, 0x0d), uleb(0),
      Uint8Array.of(0x23), uleb(tradeEnabledGlobalIndex),
      Uint8Array.of(0x45, 0x0d), uleb(0),
      Uint8Array.of(0x41), sleb(1),
      Uint8Array.of(0x24), uleb(tradeToggleGlobalIndex),
      Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x0f, 0x0b),
    )] : []),
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

/** Enables the exact host-only `/trade` alias and clears stale signals when off. */
export function tradeToggleConfigure(
  enabledGlobalIndex: number,
  toggleGlobalIndex: number,
): Uint8Array {
  return concat(
    uleb(0),
    Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x45, 0x45),
    Uint8Array.of(0x24), uleb(enabledGlobalIndex),
    Uint8Array.of(0x23), uleb(enabledGlobalIndex), Uint8Array.of(0x45, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x24), uleb(toggleGlobalIndex),
    Uint8Array.of(0x0b),
    Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x0b),
  );
}

/** Reads and clears the single pending Trade Chat toggle. */
export function tradeToggleTake(toggleGlobalIndex: number): Uint8Array {
  return concat(
    uleb(0),
    Uint8Array.of(0x23), uleb(toggleGlobalIndex),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x24), uleb(toggleGlobalIndex),
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
  travelBranch: Uint8Array | null,
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
    ...(travelBranch ? [travelBranch] : []),
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
