/**
 * Owns Travel WebAssembly command builders.
 * Emits the matching game-thread drain branch.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";
import { configureLocalAction } from "./enhancement-command-transform.js";

const TRAVEL_COMMAND = -2;
const GUILD_HALL_COMMAND = -5;
const TRAVEL_MAP_OFFSET = 0;
const TRAVEL_REGION_OFFSET = 4;
const TRAVEL_LANGUAGE_OFFSET = 8;
const TRAVEL_DISTRICT_OFFSET = 12;
const INVALID_TRAVEL_CONTEXT = -1;
const VALID_TRAVEL_REGIONS = [-2, 0, 1, 2, 3, 4] as const;
const VALID_TRAVEL_LANGUAGES = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 17] as const;

export type TravelDrainConfig = Readonly<{
  dispatcherFunctionIndex: number;
  contextResolverFunctionIndex: number;
  unlockAccessorFunctionIndex: number;
  messageId: number;
  payloadGlobalIndex: number;
  reviewedMapIds: readonly number[];
  guildHall?: Readonly<{
    keyAccessorFunctionIndex: number;
    areaTypeAccessorFunctionIndex: number;
    enterMessageId: number;
    leaveMessageId: number;
  }>;
}>;

const TRAVEL_UNLOCK_WORD_LIMIT = 28;

function refuseLockedMap(travel: TravelDrainConfig, mapGlobalIndex: number): Uint8Array {
  const payload = () => concat(Uint8Array.of(0x23), uleb(travel.payloadGlobalIndex));
  const array = () => concat(payload(), Uint8Array.of(0x28), uleb(2), uleb(4));
  const map = () => concat(Uint8Array.of(0x23), uleb(mapGlobalIndex));
  const word = () => concat(map(), Uint8Array.of(0x41), sleb(5), Uint8Array.of(0x76));
  const memoryBytes = () => concat(
    Uint8Array.of(0x3f, 0x00, 0x41), sleb(16), Uint8Array.of(0x74),
  );
  const buffer = () => concat(array(), Uint8Array.of(0x28), uleb(2), uleb(0));
  const wordAddress = () => concat(
    buffer(), word(), Uint8Array.of(0x41), sleb(2), Uint8Array.of(0x74, 0x6a),
  );
  return concat(
    // The official accessor returns Array<u32>{buffer, capacity, size}.
    payload(), Uint8Array.of(0x10), uleb(travel.unlockAccessorFunctionIndex),
    Uint8Array.of(0x36), uleb(2), uleb(4),
    refuseUnless(concat(array(), Uint8Array.of(0x45, 0x45))),
    refuseUnless(concat(
      array(), memoryBytes(), Uint8Array.of(0x41), sleb(12), Uint8Array.of(0x6b, 0x4d),
    )),
    refuseUnless(concat(buffer(), Uint8Array.of(0x45, 0x45))),
    refuseUnless(concat(wordAddress(), buffer(), Uint8Array.of(0x4f))),
    refuseUnless(concat(
      wordAddress(), memoryBytes(), Uint8Array.of(0x41), sleb(4), Uint8Array.of(0x6b, 0x4d),
    )),
    refuseUnless(concat(
      array(), Uint8Array.of(0x28), uleb(2), uleb(8),
      word(), Uint8Array.of(0x4b),
      array(), Uint8Array.of(0x28), uleb(2), uleb(8),
      Uint8Array.of(0x41), sleb(TRAVEL_UNLOCK_WORD_LIMIT), Uint8Array.of(0x4d),
      wordAddress(), Uint8Array.of(0x28), uleb(2), uleb(0),
      map(), Uint8Array.of(0x76, 0x41), sleb(1), Uint8Array.of(0x71),
      // The size bound and map bit must both be true.
      Uint8Array.of(0x71, 0x71),
    )),
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

/** Queues the one native enter-or-leave Guild Hall action. */
export function guildHallEnqueue(
  pendingGlobalIndex: number,
  payloadGlobalIndex: number,
  enabledGlobalIndex: number,
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
    Uint8Array.of(0x41), sleb(GUILD_HALL_COMMAND),
    Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(1), Uint8Array.of(0x0b),
  );
}

function guildHallDrain(
  pendingGlobalIndex: number,
  scratchGlobalIndex: number,
  travel: TravelDrainConfig,
): Uint8Array {
  const guild = travel.guildHall;
  if (!guild) return new Uint8Array();
  const pointer = () => concat(Uint8Array.of(0x23), uleb(scratchGlobalIndex));
  const memoryBytes = () => concat(
    Uint8Array.of(0x3f, 0x00, 0x41), sleb(16), Uint8Array.of(0x74),
  );
  const keyWord = (offset: number) => concat(
    pointer(), Uint8Array.of(0x28), uleb(2), uleb(offset),
  );
  return concat(
    Uint8Array.of(0x23), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(GUILD_HALL_COMMAND), Uint8Array.of(0x46, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    // The client's own branch treats AreaInfo type 4 as a Guild Hall.
    Uint8Array.of(0x10), uleb(guild.areaTypeAccessorFunctionIndex),
    Uint8Array.of(0x41), sleb(4), Uint8Array.of(0x46, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(guild.leaveMessageId),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x41), sleb(0),
    Uint8Array.of(0x10), uleb(travel.dispatcherFunctionIndex),
    Uint8Array.of(0x0f, 0x0b),
    // Re-read the current guild key at the game-thread safe point.
    Uint8Array.of(0x10), uleb(guild.keyAccessorFunctionIndex),
    Uint8Array.of(0x24), uleb(scratchGlobalIndex),
    refuseUnless(concat(pointer(), Uint8Array.of(0x45, 0x45))),
    refuseUnless(concat(pointer(), Uint8Array.of(0x41), sleb(3), Uint8Array.of(0x71, 0x45))),
    refuseUnless(concat(
      pointer(), memoryBytes(), Uint8Array.of(0x41), sleb(16), Uint8Array.of(0x6b, 0x4d),
    )),
    refuseUnless(concat(
      keyWord(0), keyWord(4), Uint8Array.of(0x72),
      keyWord(8), Uint8Array.of(0x72), keyWord(12), Uint8Array.of(0x72),
    )),
    ...[0, 4, 8, 12].map((offset) => concat(
      Uint8Array.of(0x23), uleb(travel.payloadGlobalIndex),
      keyWord(offset),
      Uint8Array.of(0x36), uleb(2), uleb(offset),
    )),
    Uint8Array.of(0x41), sleb(guild.enterMessageId),
    Uint8Array.of(0x23), uleb(travel.payloadGlobalIndex),
    Uint8Array.of(0x41), sleb(0),
    Uint8Array.of(0x10), uleb(travel.dispatcherFunctionIndex),
    Uint8Array.of(0x0f, 0x0b),
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

/** Emits the complete fail-closed Travel branch of the game-thread drain. */
export function travelDrain(
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
    guildHallDrain(pendingGlobalIndex, argumentGlobalBase, travel),
    Uint8Array.of(0x23), uleb(pendingGlobalIndex),
    Uint8Array.of(0x41), sleb(TRAVEL_COMMAND), Uint8Array.of(0x46, 0x04, 0x40),
    Uint8Array.of(0x41), sleb(0), Uint8Array.of(0x24), uleb(pendingGlobalIndex),
    refuseUnless(globalValueIsOneOf(argumentGlobalBase, travel.reviewedMapIds)),
    refuseLockedMap(travel, argumentGlobalBase),
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
