/**
 * Emits the three named character-switch actions and their game-thread executor.
 * It owns no generic frame or UI-message export; callers can only logout, select, or Play.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";
import type { EnhancementLayout } from "../../shared/enhancement-config.js";
import { CHARACTER_SWITCH_ACTION_ABI } from "../../shared/character-switch-action-abi.js";

export const CHARACTER_ACTION = CHARACTER_SWITCH_ACTION_ABI.action;
const RESULT = CHARACTER_SWITCH_ACTION_ABI.result;
const PROOF = CHARACTER_SWITCH_ACTION_ABI.proof;
const FIELD = CHARACTER_SWITCH_ACTION_ABI.fields;
const SELECTOR_INDEX_MESSAGE = 0x5a;
const SELECTOR_CLICK_MESSAGE = 0x31;
const COMMAND_BASE = -10;
const CHARACTER_RECORD_BYTES = 0x84;
const ACCOUNT_CHARACTER_NAME_OFFSET = 0x18;
const CHARACTER_NAME_UNITS = 0x14;

// The exact frame dispatcher body proves a 12-byte callback row at frame
// +0xa8. The latest non-null row owns the typed component context.
const FRAME_CALLBACK_COUNT_OFFSET = 0xb0;
const FRAME_CALLBACK_BYTES = 12;
const FRAME_CALLBACK_CONTEXT_OFFSET = 4;

// The Selector context and character record shape are revalidated against the
// fresh account list before any native message can be sent.
const SELECTOR_CONTEXT_FRAME_ID_OFFSET = 4;
const SELECTOR_CONTEXT_CHARACTERS_OFFSET = 8;
const SELECTOR_CONTEXT_CHARACTER_CAPACITY_OFFSET = 12;
const SELECTOR_CONTEXT_CHARACTER_COUNT_OFFSET = 16;
const SELECTOR_CHARACTER_NAME_OFFSET = 0x20;

const getLocal = (index: number) => concat(Uint8Array.of(0x20), uleb(index));
const setLocal = (index: number) => concat(Uint8Array.of(0x21), uleb(index));
const getGlobal = (index: number) => concat(Uint8Array.of(0x23), uleb(index));
const setGlobal = (index: number) => concat(Uint8Array.of(0x24), uleb(index));
const i32 = (value: number) => concat(Uint8Array.of(0x41), sleb(value));
const load = (offset = 0) => concat(Uint8Array.of(0x28), uleb(2), uleb(offset));
const load16 = (offset = 0) => concat(Uint8Array.of(0x2f), uleb(1), uleb(offset));
const store = (offset = 0) => concat(Uint8Array.of(0x36), uleb(2), uleb(offset));
const memoryBytes = () => concat(
  Uint8Array.of(0x3f, 0x00), i32(16), Uint8Array.of(0x74),
);

/** Exact frame-record guard shared with the executable bytecode regression test. */
export function characterActionFramePointerWithinMemory(
  pointerLocal: number,
  frameBytes: number,
): Uint8Array {
  return concat(
    getLocal(pointerLocal), Uint8Array.of(0x45, 0x45),
    getLocal(pointerLocal), memoryBytes(), i32(frameBytes), Uint8Array.of(0x6b, 0x4d, 0x71),
  );
}

export type CharacterActionConfig = Readonly<{
  layout: Pick<EnhancementLayout,
    | "contextRoot" | "gameContextSlot" | "characterContext" | "currentInstanceType"
    | "characterArrayPointer" | "characterArrayCount" | "frameArray" | "frameCount" | "frameBytes"
    | "frameId" | "frameChildOffsetId" | "frameState"
  > & Readonly<{ frameHashId: number }>;
  dispatcherFunctionIndex: number;
  frameChildFunctionIndex: number;
  frameParentFunctionIndex: number;
  frameResolverFunctionIndex: number;
  frameDispatchFunctionIndex: number;
  frameDispatchOffset: number;
  logoutMessageId: number;
  selectorHash: number;
  playHash: number;
  pendingGlobalIndex: number;
  expectedIndexGlobalIndex: number;
  confirmationAttemptsGlobalIndex: number;
}>;

/** Queues exactly one of the three closed actions. */
export function characterActionEnqueue(
  pendingGlobal: number,
  argumentGlobal: number,
  enabledGlobal: number,
  expectedIndexGlobal: number,
  confirmationAttemptsGlobal: number,
): Uint8Array {
  return concat(
    uleb(0),
    getGlobal(enabledGlobal), Uint8Array.of(0x45, 0x04, 0x40), i32(0), Uint8Array.of(0x0f, 0x0b),
    getGlobal(pendingGlobal), Uint8Array.of(0x04, 0x40), i32(0), Uint8Array.of(0x0f, 0x0b),
    getLocal(0), i32(CHARACTER_ACTION.logout), Uint8Array.of(0x49),
    getLocal(0), i32(CHARACTER_ACTION.play), Uint8Array.of(0x4b, 0x72, 0x04, 0x40),
      i32(0), Uint8Array.of(0x0f, 0x0b),
    getLocal(0), i32(CHARACTER_ACTION.select), Uint8Array.of(0x46, 0x04, 0x40),
      getLocal(1), i32(64), Uint8Array.of(0x4f, 0x04, 0x40),
        i32(0), Uint8Array.of(0x0f, 0x0b),
      Uint8Array.of(0x0b),
    getLocal(1), setGlobal(argumentGlobal),
    i32(-1), setGlobal(expectedIndexGlobal),
    i32(0), setGlobal(confirmationAttemptsGlobal),
    i32(COMMAND_BASE), getLocal(0), Uint8Array.of(0x6b), setGlobal(pendingGlobal),
    i32(1), Uint8Array.of(0x0b),
  );
}

/** Publishes the private fixed action packet and current focus/policy gate. */
export function characterActionConfigure(
  pendingGlobal: number,
  payloadGlobal: number,
  enabledGlobal: number,
  expectedIndexGlobal: number,
  confirmationAttemptsGlobal: number,
): Uint8Array {
  return concat(
    uleb(0), getLocal(0), setGlobal(payloadGlobal),
    getLocal(0), Uint8Array.of(0x45, 0x45), getLocal(1), Uint8Array.of(0x45, 0x45, 0x71),
    setGlobal(enabledGlobal),
    getGlobal(enabledGlobal), Uint8Array.of(0x45, 0x04, 0x40),
      getGlobal(pendingGlobal), i32(COMMAND_BASE - CHARACTER_ACTION.logout), Uint8Array.of(0x46),
      getGlobal(pendingGlobal), i32(COMMAND_BASE - CHARACTER_ACTION.select), Uint8Array.of(0x46, 0x72),
      getGlobal(pendingGlobal), i32(COMMAND_BASE - CHARACTER_ACTION.play), Uint8Array.of(0x46, 0x72, 0x04, 0x40),
        i32(0), setGlobal(pendingGlobal),
        i32(-1), setGlobal(expectedIndexGlobal),
        i32(0), setGlobal(confirmationAttemptsGlobal),
      Uint8Array.of(0x0b),
    Uint8Array.of(0x0b), i32(1), Uint8Array.of(0x0b),
  );
}

function visible(frameLocal: number, layout: CharacterActionConfig["layout"]): Uint8Array {
  return concat(
    getLocal(frameLocal), load(layout.frameState), i32(4), Uint8Array.of(0x71, 0x45, 0x45),
    getLocal(frameLocal), load(layout.frameState), i32(0x200), Uint8Array.of(0x71, 0x45, 0x71),
  );
}

/**
 * Runs one action on the existing game-thread drain and writes one closed ABI
 * result. The renderer never interprets an undocumented numeric value.
 */
export function characterActionExecute(config: CharacterActionConfig): Uint8Array {
  const { layout } = config;
  const result = (value: number) => concat(
    i32(-1), setGlobal(config.expectedIndexGlobalIndex),
    i32(0), setGlobal(config.confirmationAttemptsGlobalIndex),
    getLocal(2), i32(value), store(FIELD.result), Uint8Array.of(0x0f),
  );
  const frameProof = (bit: number) => concat(
    getLocal(2), getLocal(2), load(FIELD.proofMask), i32(1 << bit),
    Uint8Array.of(0x72), store(FIELD.proofMask),
  );
  const findFrame = (hash: number) => concat(
    i32(layout.frameCount), load(), setLocal(3),
    i32(layout.frameArray), load(), setLocal(4),
    getLocal(3), i32(1), Uint8Array.of(0x49),
    getLocal(3), i32(16_384), Uint8Array.of(0x4b, 0x72),
    getLocal(4), Uint8Array.of(0x45, 0x72, 0x04, 0x40),
      result(RESULT.invalid),
    Uint8Array.of(0x0b),
    // The frame registry mutates while character selection is constructed.
    // Bound the pointer table before reading any entry.
    getLocal(4), memoryBytes(), getLocal(3), i32(2), Uint8Array.of(0x74, 0x6b, 0x4b),
    Uint8Array.of(0x04, 0x40), result(RESULT.invalid), Uint8Array.of(0x0b),
    frameProof(PROOF.frameRegistryCount), frameProof(PROOF.frameRegistryArray),
    i32(0), setLocal(5), i32(0), setLocal(6),
    Uint8Array.of(0x02, 0x40, 0x03, 0x40),
      getLocal(5), getLocal(3), Uint8Array.of(0x4f, 0x0d), uleb(1),
      getLocal(4), getLocal(5), i32(4), Uint8Array.of(0x6c, 0x6a), load(), setLocal(7),
      // A stale transient entry is readiness failure, not authority to read.
      characterActionFramePointerWithinMemory(7, layout.frameBytes),
      Uint8Array.of(0x04, 0x40),
        frameProof(PROOF.framePointer),
        getLocal(7), load(layout.frameId), getLocal(5), Uint8Array.of(0x46, 0x04, 0x40),
          frameProof(PROOF.frameIdentity),
          getLocal(7), load(layout.frameHashId), i32(hash), Uint8Array.of(0x46, 0x04, 0x40),
            frameProof(PROOF.frameHash),
          Uint8Array.of(0x0b),
          getLocal(7), load(layout.frameHashId), i32(hash), Uint8Array.of(0x46),
          visible(7, layout), Uint8Array.of(0x71, 0x04, 0x40),
            frameProof(PROOF.frameVisible), getLocal(7), setLocal(6), Uint8Array.of(0x0c), uleb(4),
          Uint8Array.of(0x0b),
        Uint8Array.of(0x0b),
      Uint8Array.of(0x0b),
      getLocal(5), i32(1), Uint8Array.of(0x6a), setLocal(5), Uint8Array.of(0x0c), uleb(0),
    Uint8Array.of(0x0b, 0x0b),
  );
  const validateFrame = (frameLocal: number, idLocal: number, failure: number) => concat(
    getLocal(idLocal), Uint8Array.of(0x10), uleb(config.frameResolverFunctionIndex), setLocal(frameLocal),
    getLocal(frameLocal), Uint8Array.of(0x45, 0x04, 0x40), result(failure), Uint8Array.of(0x0b),
    getLocal(frameLocal), load(layout.frameId), getLocal(idLocal), Uint8Array.of(0x47, 0x04, 0x40),
      result(failure),
    Uint8Array.of(0x0b),
  );
  const parentFrame = (childLocal: number, parentLocal: number, idLocal: number, failure: number) => concat(
    getLocal(childLocal), load(layout.frameId),
    Uint8Array.of(0x10), uleb(config.frameParentFunctionIndex), setLocal(idLocal),
    getLocal(idLocal), Uint8Array.of(0x45, 0x04, 0x40), result(failure), Uint8Array.of(0x0b),
    frameProof(PROOF.parentResolved),
    getLocal(idLocal), Uint8Array.of(0x10), uleb(config.frameResolverFunctionIndex), setLocal(parentLocal),
    getLocal(parentLocal), Uint8Array.of(0x45, 0x04, 0x40), result(failure), Uint8Array.of(0x0b),
    frameProof(PROOF.parentPointer),
    getLocal(parentLocal), load(layout.frameId), getLocal(idLocal), Uint8Array.of(0x47, 0x04, 0x40),
      result(failure),
    Uint8Array.of(0x0b),
    frameProof(PROOF.parentIdentity), frameProof(PROOF.parentValidated),
  );
  const resolveSelectorTarget = () => concat(
    // Keep the target identity in the account array only long enough to find
    // the matching Selector-owned record. Never send this account pointer.
    i32(layout.characterArrayPointer), load(), setLocal(4),
    getLocal(4), Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.invalid), Uint8Array.of(0x0b),
    getLocal(4), getLocal(1), i32(CHARACTER_RECORD_BYTES), Uint8Array.of(0x6c, 0x6a),
    i32(ACCOUNT_CHARACTER_NAME_OFFSET), Uint8Array.of(0x6a), setLocal(11),
    characterActionFramePointerWithinMemory(11, CHARACTER_NAME_UNITS * 2),
    Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.invalid), Uint8Array.of(0x0b),

    // GetFrameContext scans the frame's callback rows in reverse and returns
    // the latest non-null typed component context.
    getLocal(6), load(config.frameDispatchOffset), setLocal(12),
    getLocal(6), load(FRAME_CALLBACK_COUNT_OFFSET), setLocal(13),
    getLocal(13), i32(1), Uint8Array.of(0x49),
    getLocal(13), i32(64), Uint8Array.of(0x4b, 0x72),
    getLocal(12), Uint8Array.of(0x45, 0x72, 0x04, 0x40), result(RESULT.selectorContext), Uint8Array.of(0x0b),
    getLocal(12), memoryBytes(), getLocal(13), i32(FRAME_CALLBACK_BYTES),
    Uint8Array.of(0x6c, 0x6b, 0x4b, 0x04, 0x40), result(RESULT.selectorContext), Uint8Array.of(0x0b),
    frameProof(PROOF.contextRows), i32(0), setLocal(14),
    Uint8Array.of(0x02, 0x40, 0x03, 0x40),
      getLocal(13), Uint8Array.of(0x45, 0x0d), uleb(1),
      getLocal(13), i32(1), Uint8Array.of(0x6b), setLocal(13),
      getLocal(12), getLocal(13), i32(FRAME_CALLBACK_BYTES), Uint8Array.of(0x6c, 0x6a),
      load(FRAME_CALLBACK_CONTEXT_OFFSET), setLocal(14),
      getLocal(14), Uint8Array.of(0x0d), uleb(1),
      Uint8Array.of(0x0c), uleb(0),
    Uint8Array.of(0x0b, 0x0b),
    getLocal(14), Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.selectorContext), Uint8Array.of(0x0b),
    frameProof(PROOF.contextFound),
    characterActionFramePointerWithinMemory(14, 20),
    Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.selectorContext), Uint8Array.of(0x0b),
    getLocal(14), load(SELECTOR_CONTEXT_FRAME_ID_OFFSET),
    getLocal(6), load(layout.frameId), Uint8Array.of(0x47, 0x04, 0x40), result(RESULT.selectorContext), Uint8Array.of(0x0b),
    frameProof(PROOF.contextIdentity),

    getLocal(14), load(SELECTOR_CONTEXT_CHARACTERS_OFFSET), setLocal(15),
    getLocal(14), load(SELECTOR_CONTEXT_CHARACTER_COUNT_OFFSET), setLocal(16),
    getLocal(16), i32(1), Uint8Array.of(0x49),
    getLocal(16), i32(64), Uint8Array.of(0x4b, 0x72),
    getLocal(15), Uint8Array.of(0x45, 0x72, 0x04, 0x40), result(RESULT.selectorArray), Uint8Array.of(0x0b),
    getLocal(14), load(SELECTOR_CONTEXT_CHARACTER_CAPACITY_OFFSET), setLocal(13),
    getLocal(13), getLocal(16), Uint8Array.of(0x49),
    getLocal(13), i32(64), Uint8Array.of(0x4b, 0x72, 0x04, 0x40),
      result(RESULT.selectorArray),
    Uint8Array.of(0x0b),
    getLocal(15), memoryBytes(), getLocal(16), i32(4), Uint8Array.of(0x6c, 0x6b, 0x4b),
    Uint8Array.of(0x04, 0x40), result(RESULT.selectorArray), Uint8Array.of(0x0b),
    frameProof(PROOF.characterArray),

    // Resolve the copied identity by exact bounded UTF-16 equality. A missing
    // or duplicate match refuses without a click.
    i32(-1), setLocal(5), i32(0), setLocal(22), i32(0), setLocal(18),
    Uint8Array.of(0x02, 0x40, 0x03, 0x40),
      getLocal(18), getLocal(16), Uint8Array.of(0x4f, 0x0d), uleb(1),
      getLocal(15), getLocal(18), i32(4), Uint8Array.of(0x6c, 0x6a), load(), setLocal(17),
      // Empty purchased slots have no character record and are skipped.
      getLocal(17), Uint8Array.of(0x04, 0x40),
        characterActionFramePointerWithinMemory(17, SELECTOR_CHARACTER_NAME_OFFSET + CHARACTER_NAME_UNITS * 2),
        Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.selectorArray), Uint8Array.of(0x0b),
        i32(1), setLocal(20), i32(0), setLocal(19),
        Uint8Array.of(0x02, 0x40, 0x03, 0x40),
          getLocal(19), i32(CHARACTER_NAME_UNITS), Uint8Array.of(0x4f, 0x0d), uleb(1),
          getLocal(17), getLocal(19), i32(2), Uint8Array.of(0x6c, 0x6a),
          load16(SELECTOR_CHARACTER_NAME_OFFSET),
          getLocal(11), getLocal(19), i32(2), Uint8Array.of(0x6c, 0x6a), load16(),
          Uint8Array.of(0x47, 0x04, 0x40), i32(0), setLocal(20), Uint8Array.of(0x0c), uleb(2),
          Uint8Array.of(0x0b),
          getLocal(19), i32(1), Uint8Array.of(0x6a), setLocal(19), Uint8Array.of(0x0c), uleb(0),
        Uint8Array.of(0x0b, 0x0b),
        getLocal(20), Uint8Array.of(0x04, 0x40),
          getLocal(5), i32(-1), Uint8Array.of(0x47, 0x04, 0x40), result(RESULT.selectorTarget), Uint8Array.of(0x0b),
          getLocal(18), setLocal(5), getLocal(17), setLocal(22),
        Uint8Array.of(0x0b),
      Uint8Array.of(0x0b),
      getLocal(18), i32(1), Uint8Array.of(0x6a), setLocal(18), Uint8Array.of(0x0c), uleb(0),
    Uint8Array.of(0x0b, 0x0b),
    getLocal(5), i32(-1), Uint8Array.of(0x46, 0x04, 0x40), result(RESULT.selectorTarget), Uint8Array.of(0x0b),
    frameProof(PROOF.targetResolved),
  );
  return concat(
    // Locals 3..22 hold only bounded frame/context traversal state.
    uleb(1), uleb(20), Uint8Array.of(0x7f),
    getLocal(2), Uint8Array.of(0x45, 0x04, 0x40), Uint8Array.of(0x0f, 0x0b),
    // Preserve proof from a Selector continuation so diagnostics can prove
    // whether a click was already sent. A fresh action always clears it.
    getLocal(0), i32(CHARACTER_ACTION.select), Uint8Array.of(0x46),
    getGlobal(config.expectedIndexGlobalIndex), i32(-1), Uint8Array.of(0x47, 0x71, 0x04, 0x40),
    Uint8Array.of(0x05), getLocal(2), i32(0), store(FIELD.proofMask), Uint8Array.of(0x0b),
    getLocal(0), i32(CHARACTER_ACTION.logout), Uint8Array.of(0x46, 0x04, 0x40),
      i32(layout.contextRoot), load(), setLocal(3),
      getLocal(3), Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.refused), Uint8Array.of(0x0b),
      getLocal(3), load(layout.gameContextSlot * 4), setLocal(3),
      getLocal(3), Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.refused), Uint8Array.of(0x0b),
      getLocal(3), load(layout.characterContext), setLocal(3),
      getLocal(3), Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.refused), Uint8Array.of(0x0b),
      // Instance types 0 and 1 are outpost and explorable. Core separately
      // proves that an explorable is PvE. Reject loading (2) and malformed
      // values again on the game-thread boundary immediately before logout.
      getLocal(3), load(layout.currentInstanceType), i32(1), Uint8Array.of(0x4b, 0x04, 0x40), result(RESULT.refused), Uint8Array.of(0x0b),
      // kLogout { unknown = 0, character_select = 1 }.
      getLocal(2), i32(0), store(0), getLocal(2), i32(1), store(4),
      i32(config.logoutMessageId), getLocal(2), i32(0), Uint8Array.of(0x10), uleb(config.dispatcherFunctionIndex),
      result(RESULT.sent), Uint8Array.of(0x0b),
    getLocal(0), i32(CHARACTER_ACTION.select), Uint8Array.of(0x46, 0x04, 0x40),
      i32(layout.characterArrayCount), load(), setLocal(3),
      getLocal(3), i32(1), Uint8Array.of(0x49), getLocal(3), i32(64), Uint8Array.of(0x4b, 0x72),
      getLocal(1), getLocal(3), Uint8Array.of(0x4f, 0x72, 0x04, 0x40), result(RESULT.invalid), Uint8Array.of(0x0b),
      findFrame(config.selectorHash), getLocal(6), Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.selectorFrame), Uint8Array.of(0x0b),
      getLocal(6), load(layout.frameId), i32(0), Uint8Array.of(0x10), uleb(config.frameChildFunctionIndex),
      setLocal(10), getLocal(10), Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.selectorChild), Uint8Array.of(0x0b),
      frameProof(PROOF.selectorChild),
      validateFrame(8, 10, RESULT.selectorChild), frameProof(PROOF.selectorChildIdentity),
      // Read the Selector pane's current carousel index.
      getLocal(2), i32(0), store(FIELD.selectedIndex),
      getLocal(8), i32(config.frameDispatchOffset), Uint8Array.of(0x6a),
      i32(SELECTOR_INDEX_MESSAGE), i32(0),
      getLocal(2), i32(32), Uint8Array.of(0x6a),
      Uint8Array.of(0x10), uleb(config.frameDispatchFunctionIndex),
      frameProof(PROOF.selectedIndexRead),
      getLocal(2), load(FIELD.selectedIndex), setLocal(9),
      frameProof(PROOF.selectedIndexValid),
      resolveSelectorTarget(),
      getLocal(9), getLocal(16), Uint8Array.of(0x4f, 0x04, 0x40), result(RESULT.selectorIndex), Uint8Array.of(0x0b),
      // A Selector click is applied after this synchronous game-thread call.
      // Confirm the previous adjacent step on the next drain before issuing
      // another one, so an unchanged index can never repeat an ambiguous click.
      getGlobal(config.expectedIndexGlobalIndex), i32(-1), Uint8Array.of(0x47, 0x04, 0x40),
        getLocal(9), getGlobal(config.expectedIndexGlobalIndex), Uint8Array.of(0x47, 0x04, 0x40),
          // The WebAssembly client may apply the synchronous frame message on
          // a later game-thread drain. Poll only the read-only index query;
          // never dispatch the click a second time.
          getGlobal(config.confirmationAttemptsGlobalIndex), i32(1), Uint8Array.of(0x6a),
          setGlobal(config.confirmationAttemptsGlobalIndex),
          getGlobal(config.confirmationAttemptsGlobalIndex), i32(180), Uint8Array.of(0x4f, 0x04, 0x40),
            result(RESULT.selectionUnconfirmed),
          Uint8Array.of(0x0b),
          i32(COMMAND_BASE - CHARACTER_ACTION.select), setGlobal(config.pendingGlobalIndex),
          Uint8Array.of(0x0f),
        Uint8Array.of(0x0b),
        frameProof(PROOF.selectionConfirmed),
        i32(-1), setGlobal(config.expectedIndexGlobalIndex),
        i32(0), setGlobal(config.confirmationAttemptsGlobalIndex),
      Uint8Array.of(0x0b),
      getLocal(9), getLocal(5), Uint8Array.of(0x46, 0x04, 0x40), result(RESULT.sent), Uint8Array.of(0x0b),
      getLocal(9), getLocal(5), Uint8Array.of(0x49, 0x04, 0x40),
        getLocal(9), i32(1), Uint8Array.of(0x6a), setLocal(5),
      Uint8Array.of(0x05),
        getLocal(9), i32(1), Uint8Array.of(0x6b), setLocal(5),
      Uint8Array.of(0x0b),
      // The native message selects one adjacent carousel record at a time.
      // Re-resolve that exact record instead of reusing the final target row.
      getLocal(15), getLocal(5), i32(4), Uint8Array.of(0x6c, 0x6a), load(), setLocal(22),
      characterActionFramePointerWithinMemory(22, SELECTOR_CHARACTER_NAME_OFFSET + CHARACTER_NAME_UNITS * 2),
      Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.selectorContext), Uint8Array.of(0x0b),
      frameProof(PROOF.targetPointer),
      // button_param { name, play = 0 } at payload +24.
      getLocal(2), getLocal(22), i32(SELECTOR_CHARACTER_NAME_OFFSET), Uint8Array.of(0x6a), store(24),
      getLocal(2), i32(0), store(28),
      // kMouseAction for Selector, pointing at the private button_param.
      getLocal(2), getLocal(6), load(layout.frameId), store(0),
      getLocal(2), getLocal(6), load(layout.frameChildOffsetId), store(4),
      getLocal(2), i32(8), store(8),
      getLocal(2), getLocal(2), i32(24), Uint8Array.of(0x6a), store(12),
      getLocal(2), i32(0), store(16),
      getLocal(5), setGlobal(config.expectedIndexGlobalIndex),
      i32(0), setGlobal(config.confirmationAttemptsGlobalIndex),
      parentFrame(6, 8, 10, RESULT.selectorParent),
      frameProof(PROOF.clickSent),
      getLocal(8), i32(config.frameDispatchOffset), Uint8Array.of(0x6a),
      i32(SELECTOR_CLICK_MESSAGE), getLocal(2), i32(0),
      Uint8Array.of(0x10), uleb(config.frameDispatchFunctionIndex),
      i32(COMMAND_BASE - CHARACTER_ACTION.select), setGlobal(config.pendingGlobalIndex),
      Uint8Array.of(0x0f, 0x0b),
    getLocal(0), i32(CHARACTER_ACTION.play), Uint8Array.of(0x46, 0x04, 0x40),
      findFrame(config.playHash), getLocal(6), Uint8Array.of(0x45, 0x04, 0x40), result(RESULT.playFrame), Uint8Array.of(0x0b),
      // Match the client's ButtonClick packet: the button child ID appears in
      // both ID fields, MouseUp activates it, and wparam owns the button value.
      getLocal(2), i32(0), store(24),
      getLocal(2), getLocal(6), load(layout.frameBytes - 4), store(28),
      getLocal(2), i32(0), store(FIELD.selectedIndex),
      getLocal(2), getLocal(6), load(layout.frameChildOffsetId), store(0),
      getLocal(2), getLocal(6), load(layout.frameChildOffsetId), store(4),
      getLocal(2), i32(7), store(8),
      getLocal(2), getLocal(2), i32(24), Uint8Array.of(0x6a), store(12),
      getLocal(2), i32(0), store(16),
      parentFrame(6, 8, 10, RESULT.playParent),
      getLocal(8), i32(config.frameDispatchOffset), Uint8Array.of(0x6a),
      i32(SELECTOR_CLICK_MESSAGE), getLocal(2), i32(0),
      Uint8Array.of(0x10), uleb(config.frameDispatchFunctionIndex),
      result(RESULT.sent), Uint8Array.of(0x0b),
    result(RESULT.invalid), Uint8Array.of(0x0b),
  );
}

export function characterActionDrain(
  pendingGlobal: number,
  argumentGlobal: number,
  payloadGlobal: number,
  enabledGlobal: number,
  executeFunction: number,
): Uint8Array {
  return concat(
    getGlobal(pendingGlobal), i32(COMMAND_BASE - CHARACTER_ACTION.logout), Uint8Array.of(0x46),
    getGlobal(pendingGlobal), i32(COMMAND_BASE - CHARACTER_ACTION.select), Uint8Array.of(0x46, 0x72),
    getGlobal(pendingGlobal), i32(COMMAND_BASE - CHARACTER_ACTION.play), Uint8Array.of(0x46, 0x72, 0x04, 0x40),
      i32(COMMAND_BASE), getGlobal(pendingGlobal), Uint8Array.of(0x6b),
      getGlobal(argumentGlobal), getGlobal(payloadGlobal),
      i32(0), setGlobal(pendingGlobal),
      getGlobal(enabledGlobal), Uint8Array.of(0x45, 0x04, 0x40), Uint8Array.of(0x0f, 0x0b),
      Uint8Array.of(0x10), uleb(executeFunction), Uint8Array.of(0x0f, 0x0b),
  );
}
