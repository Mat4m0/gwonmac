/** Travel-owned WebAssembly command builders and game-thread drain branch. */
import { concat, sleb, uleb } from "../core/wasm-binary.js";
import { configureLocalAction } from "./enhancement-command-transform.js";

const TRAVEL_COMMAND = -2;
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
  messageId: number;
  payloadGlobalIndex: number;
  reviewedMapIds: readonly number[];
}>;

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
