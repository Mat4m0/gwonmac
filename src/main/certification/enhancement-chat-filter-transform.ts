/**
 * Builds the bounded, fail-open chat filter that runs before the game UI
 * dispatcher and keeps all message contents inside the game module.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";
import { ENHANCEMENT_CHAT_FILTER_MASKS } from "../../shared/enhancement-contracts.js";
import type { KnownEnhancementBuild } from "./enhancement-build-model.js";

export const ENHANCEMENT_CHAT_FILTER_CONFIGURE_EXPORT =
  "enhancement_configure_chat_filters";

const getLocal = (index: number) => concat(Uint8Array.of(0x20), uleb(index));
const setLocal = (index: number) => concat(Uint8Array.of(0x21), uleb(index));
const getGlobal = (index: number) => concat(Uint8Array.of(0x23), uleb(index));
const setGlobal = (index: number) => concat(Uint8Array.of(0x24), uleb(index));
const i32 = (value: number) => concat(Uint8Array.of(0x41), sleb(value));
const load = (offset = 0) => concat(Uint8Array.of(0x28), uleb(2), uleb(offset));
const load16 = (offset = 0) => concat(Uint8Array.of(0x2f), uleb(1), uleb(offset));
const memoryPages = () => Uint8Array.of(0x3f, 0x00);
const returnZeroIf = (condition: Uint8Array) => concat(
  condition,
  Uint8Array.of(0x04, 0x40), i32(0), Uint8Array.of(0x0f, 0x0b),
);
const pointerInvalid = (pointerLocal: number, bytes: number) => concat(
  getLocal(pointerLocal), Uint8Array.of(0x45),
  getLocal(pointerLocal), i32(-bytes), Uint8Array.of(0x4b, 0x72),
  getLocal(pointerLocal), i32(bytes - 1), Uint8Array.of(0x6a),
  i32(16), Uint8Array.of(0x76), memoryPages(), Uint8Array.of(0x4f, 0x72),
);
const localEqualsAny = (local: number, values: readonly number[]) => concat(
  ...values.map((value, index) => concat(
    getLocal(local), i32(value), Uint8Array.of(0x46),
    ...(index === 0 ? [] : [Uint8Array.of(0x72)]),
  )),
);

export function chatFilterConfigure(maskGlobal: number): Uint8Array {
  return concat(
    uleb(0),
    getLocal(0), i32(ENHANCEMENT_CHAT_FILTER_MASKS.all), Uint8Array.of(0x4b, 0x04, 0x40),
      i32(0), setGlobal(maskGlobal), i32(0), Uint8Array.of(0x0f),
    Uint8Array.of(0x0b),
    getLocal(0), setGlobal(maskGlobal), i32(1), Uint8Array.of(0x0b),
  );
}

/** Returns 1 only when the current UI callback is a conclusively matched filter. */
export function chatFilterDecision(
  fact: NonNullable<KnownEnhancementBuild["chatFiltering"]>,
  layout: Pick<
    NonNullable<KnownEnhancementBuild["observationBase"]>["layout"],
    "contextRoot" | "gameContextSlot" | "characterContext" | "playerNumber"
  >,
  maskGlobal: number,
): Uint8Array {
  // params: event, packet. locals: message, nested, cursor, unit, context,
  // player-or-name-length, name-index, name-base.
  const MESSAGE = 2;
  const NESTED = 3;
  const CURSOR = 4;
  const UNIT = 5;
  const CONTEXT = 6;
  const PLAYER = 7;
  const NAME_INDEX = 8;
  const NAME_BASE = 9;
  const messageUnitAddress = (extraBytes = 0) => concat(
    getLocal(MESSAGE), getLocal(CURSOR), i32(1), Uint8Array.of(0x74, 0x6a),
    ...(extraBytes === 0 ? [] : [i32(extraBytes), Uint8Array.of(0x6a)]),
  );
  const indexedMessageNameUnitAddress = () => concat(
    getLocal(MESSAGE), getLocal(CURSOR), i32(2), Uint8Array.of(0x6a),
    getLocal(NAME_INDEX), Uint8Array.of(0x6a), i32(1), Uint8Array.of(0x74, 0x6a),
  );
  const currentNameUnitAddress = (indexLocal: number) => concat(
    getLocal(NAME_BASE), getLocal(indexLocal), i32(1), Uint8Array.of(0x74, 0x6a),
  );
  const returnOne = concat(i32(1), Uint8Array.of(0x0f));
  return concat(
    uleb(1), uleb(8), Uint8Array.of(0x7f),
    returnZeroIf(concat(getGlobal(maskGlobal), Uint8Array.of(0x45))),
    returnZeroIf(concat(
      getLocal(0), i32(fact.writeToChatLogMessage), Uint8Array.of(0x47),
    )),
    returnZeroIf(pointerInvalid(1, Math.max(fact.packetChannelOffset + 4, fact.packetMessageOffset + 4))),
    getLocal(1), load(fact.packetMessageOffset), setLocal(MESSAGE),
    returnZeroIf(pointerInvalid(MESSAGE, 4)),
    getLocal(MESSAGE), load16(), i32(fact.systemPrefix), Uint8Array.of(0x46, 0x04, 0x40),
      getLocal(MESSAGE), load16(2), setLocal(NESTED),
      getGlobal(maskGlobal), i32(ENHANCEMENT_CHAT_FILTER_MASKS.hallOfHeroes), Uint8Array.of(0x71, 0x04, 0x40),
        getLocal(NESTED), i32(fact.hallOfHeroesTemplate), Uint8Array.of(0x46, 0x04, 0x40),
          returnOne,
        Uint8Array.of(0x0b),
      Uint8Array.of(0x0b),
      getGlobal(maskGlobal), i32(ENHANCEMENT_CHAT_FILTER_MASKS.titleAchievements), Uint8Array.of(0x71, 0x04, 0x40),
        localEqualsAny(NESTED, fact.titleTemplates), Uint8Array.of(0x04, 0x40),
          returnOne,
        Uint8Array.of(0x0b),
      Uint8Array.of(0x0b),
      i32(0), Uint8Array.of(0x0f),
    Uint8Array.of(0x0b),
    returnZeroIf(concat(
      getGlobal(maskGlobal), i32(ENHANCEMENT_CHAT_FILTER_MASKS.allyDrops), Uint8Array.of(0x71, 0x45),
    )),
    returnZeroIf(concat(
      getLocal(MESSAGE), load16(), i32(fact.allyDropTemplate), Uint8Array.of(0x47),
    )),
    i32(1), setLocal(CURSOR),
    Uint8Array.of(0x02, 0x40, 0x03, 0x40),
      getLocal(CURSOR), i32(64), Uint8Array.of(0x4f, 0x0d), uleb(1),
      messageUnitAddress(), setLocal(CONTEXT),
      pointerInvalid(CONTEXT, 4), Uint8Array.of(0x0d), uleb(1),
      getLocal(CONTEXT), load16(), setLocal(UNIT),
      getLocal(UNIT), Uint8Array.of(0x45, 0x0d), uleb(1),
      getLocal(UNIT), i32(fact.numericSegment), Uint8Array.of(0x46, 0x04, 0x40),
        getLocal(CONTEXT), load16(2), setLocal(UNIT),
        returnZeroIf(concat(
          getLocal(UNIT), i32(fact.encodedNumberBase), Uint8Array.of(0x4d),
          getLocal(UNIT), i32(fact.encodedNumberBase + 0xffff), Uint8Array.of(0x4b, 0x72),
        )),
        i32(layout.contextRoot), setLocal(CONTEXT),
        returnZeroIf(pointerInvalid(CONTEXT, 4)),
        getLocal(CONTEXT), load(), setLocal(CONTEXT),
        returnZeroIf(pointerInvalid(CONTEXT, layout.gameContextSlot * 4 + 4)),
        getLocal(CONTEXT), load(layout.gameContextSlot * 4), setLocal(CONTEXT),
        returnZeroIf(pointerInvalid(CONTEXT, layout.characterContext + 4)),
        getLocal(CONTEXT), load(layout.characterContext), setLocal(CONTEXT),
        returnZeroIf(pointerInvalid(CONTEXT, layout.playerNumber + 4)),
        getLocal(CONTEXT), load(layout.playerNumber), setLocal(PLAYER),
        returnZeroIf(concat(
          getLocal(PLAYER), Uint8Array.of(0x45),
          getLocal(PLAYER), i32(0xffff), Uint8Array.of(0x4b, 0x72),
        )),
        getLocal(UNIT), i32(fact.encodedNumberBase), Uint8Array.of(0x6b),
        getLocal(PLAYER), Uint8Array.of(0x47, 0x04, 0x40), returnOne, Uint8Array.of(0x0b),
        i32(0), Uint8Array.of(0x0f),
      Uint8Array.of(0x0b),
      getLocal(UNIT), i32(fact.playerNameToken), Uint8Array.of(0x46, 0x04, 0x40),
        returnZeroIf(pointerInvalid(CONTEXT, 4)),
        returnZeroIf(concat(
          getLocal(CONTEXT), load16(2), i32(fact.encodedStringStart), Uint8Array.of(0x47),
        )),
        i32(layout.contextRoot), setLocal(CONTEXT),
        returnZeroIf(pointerInvalid(CONTEXT, 4)),
        getLocal(CONTEXT), load(), setLocal(CONTEXT),
        returnZeroIf(pointerInvalid(CONTEXT, layout.gameContextSlot * 4 + 4)),
        getLocal(CONTEXT), load(layout.gameContextSlot * 4), setLocal(CONTEXT),
        returnZeroIf(pointerInvalid(CONTEXT, layout.characterContext + 4)),
        getLocal(CONTEXT), load(layout.characterContext), setLocal(CONTEXT),
        returnZeroIf(pointerInvalid(
          CONTEXT,
          fact.currentPlayerNameOffset + fact.maxPlayerNameUnits * 2,
        )),
        getLocal(CONTEXT), i32(fact.currentPlayerNameOffset), Uint8Array.of(0x6a),
        setLocal(NAME_BASE),

        // Validate and measure the fixed-width current-character name.
        i32(0), setLocal(PLAYER),
        Uint8Array.of(0x02, 0x40, 0x03, 0x40),
          returnZeroIf(concat(
            getLocal(PLAYER), i32(fact.maxPlayerNameUnits), Uint8Array.of(0x4f),
          )),
          currentNameUnitAddress(PLAYER), load16(), setLocal(UNIT),
          getLocal(UNIT), Uint8Array.of(0x45, 0x0d), uleb(1),
          getLocal(PLAYER), i32(1), Uint8Array.of(0x6a), setLocal(PLAYER),
          Uint8Array.of(0x0c), uleb(0),
        Uint8Array.of(0x0b, 0x0b),
        returnZeroIf(concat(getLocal(PLAYER), Uint8Array.of(0x45))),

        // Validate and measure the encoded recipient. A malformed or
        // unterminated name remains visible instead of being guessed away.
        i32(0), setLocal(NESTED),
        Uint8Array.of(0x02, 0x40, 0x03, 0x40),
          returnZeroIf(concat(
            getLocal(NESTED), i32(fact.maxPlayerNameUnits), Uint8Array.of(0x4f),
          )),
          getLocal(MESSAGE), getLocal(CURSOR), i32(2), Uint8Array.of(0x6a),
          getLocal(NESTED), Uint8Array.of(0x6a), i32(1), Uint8Array.of(0x74, 0x6a),
          setLocal(CONTEXT),
          returnZeroIf(pointerInvalid(CONTEXT, 2)),
          getLocal(CONTEXT), load16(), setLocal(UNIT),
          getLocal(UNIT), i32(fact.encodedStringEnd), Uint8Array.of(0x46, 0x0d), uleb(1),
          returnZeroIf(concat(getLocal(UNIT), Uint8Array.of(0x45))),
          getLocal(NESTED), i32(1), Uint8Array.of(0x6a), setLocal(NESTED),
          Uint8Array.of(0x0c), uleb(0),
        Uint8Array.of(0x0b, 0x0b),
        returnZeroIf(concat(getLocal(NESTED), Uint8Array.of(0x45))),
        getLocal(PLAYER), getLocal(NESTED), Uint8Array.of(0x47, 0x04, 0x40),
          returnOne,
        Uint8Array.of(0x0b),

        // Equal lengths make an exact bounded comparison sufficient.
        i32(0), setLocal(NAME_INDEX),
        Uint8Array.of(0x02, 0x40, 0x03, 0x40),
          getLocal(NAME_INDEX), getLocal(PLAYER), Uint8Array.of(0x4f, 0x0d), uleb(1),
          currentNameUnitAddress(NAME_INDEX), load16(),
          indexedMessageNameUnitAddress(), load16(), Uint8Array.of(0x47, 0x04, 0x40),
            returnOne,
          Uint8Array.of(0x0b),
          getLocal(NAME_INDEX), i32(1), Uint8Array.of(0x6a), setLocal(NAME_INDEX),
          Uint8Array.of(0x0c), uleb(0),
        Uint8Array.of(0x0b, 0x0b),
        i32(0), Uint8Array.of(0x0f),
      Uint8Array.of(0x0b),
      getLocal(CURSOR), i32(1), Uint8Array.of(0x6a), setLocal(CURSOR),
      Uint8Array.of(0x0c), uleb(0),
    Uint8Array.of(0x0b, 0x0b),
    i32(0), Uint8Array.of(0x0b),
  );
}
