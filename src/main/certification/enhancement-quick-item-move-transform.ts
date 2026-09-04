/**
 * Emits the closed Control-click item action. It reads only certified item,
 * inventory, trade, and frame fields and sends Guild Wars' native UI messages.
 */
import { concat, sleb, uleb, type FunctionType } from "../core/wasm-binary.js";
import {
  QUICK_ITEM_MOVE_SCRATCH_BYTES,
  QUICK_ITEM_MOVE_PROMPT,
  QUICK_ITEM_MOVE_RESERVATION as CLAIM,
  QUICK_ITEM_MOVE_RESERVATION_BYTES,
  QUICK_ITEM_MOVE_RESERVATION_COUNT,
  QUICK_ITEM_MOVE_RESERVATION_OFFSET,
} from "../../shared/quick-item-move-contract.js";
import type { KnownEnhancementBuild } from "./enhancement-build-model.js";

const op = (...bytes: number[]) => Uint8Array.of(...bytes);
const i32 = (n: number) => concat(op(0x41), sleb(n));
const local = (n: number) => concat(op(0x20), uleb(n));
const setLocal = (n: number) => concat(op(0x21), uleb(n));
const global = (n: number) => concat(op(0x23), uleb(n));
const setGlobal = (n: number) => concat(op(0x24), uleb(n));
const call = (n: number) => concat(op(0x10), uleb(n));
const load = (offset = 0) => concat(op(0x28), uleb(2), uleb(offset));
const load8 = (offset = 0) => concat(op(0x2d), uleb(0), uleb(offset));
const load16 = (offset = 0) => concat(op(0x2f), uleb(1), uleb(offset));
const store = (offset = 0) => concat(op(0x36), uleb(2), uleb(offset));
const ret = (value: number) => concat(i32(value), op(0x0f));
const memoryBytes = () => concat(op(0x3f, 0x00), i32(16), op(0x74));
const requireMemory = (pointer: number, bytes: number) => concat(
  local(pointer), op(0x45), local(pointer), memoryBytes(), i32(bytes),
  op(0x6b, 0x4b, 0x72, 0x04, 0x40), ret(0), op(0x0b),
);
const UI_MESSAGE = Object.freeze({
  moveItem: 0x1000_01af,
  frameMouseAction: 49,
});
export const QUICK_ITEM_MOVE_COMMAND = -20;
const ITEM_OFFSET = Object.freeze({
  bag: 0x0c,
  modelFile: 0x1c,
  typeAndDye: 0x20,
  name: 0x34,
  modifiers: 0x10,
  modifierCount: 0x14,
  interaction: 0x28,
  quantity: 0x4c,
  slot: 0x50,
});
const BAG_OFFSET = Object.freeze({ index: 0x04, items: 0x18, itemCount: 0x20 });
const BAG_TYPE = Object.freeze({ inventory: 1, storage: 4, materialStorage: 5 });
const INVENTORY_BAG_INDEX = Object.freeze({ backpack: 1, afterBag2: 5, material: 6, storage1: 8, afterStorage: 22 });
const GAME_CONTEXT_OFFSET = Object.freeze({ items: 0x40, trade: 0x58 });
const ITEM_CONTEXT_OFFSET = Object.freeze({ inventory: 0xf8 });
const ITEM_ARRAY_OFFSET = Object.freeze({ buffer: 0xb8, size: 0xc0 });
const ITEM_BYTES = 0x54;
const TRADE_OFFSET = Object.freeze({ flags: 0, playerItems: 0x14, playerItemCount: 0x1c });
const TRADE_INITIATED_FLAG = 1;
const TRADE_MAX_ITEMS = 7;
const STORAGE_PANE = Object.freeze({ count: 15, material: 14 });
const NUMBER_PREFERENCE_STORAGE_PANE = 20;
const MATERIAL_SLOT_COUNT = 42;
const NOT_TRADABLE_INTERACTION = 0x100;
const MOVE_DIRECTION = Object.freeze({ store: 1, withdraw: 2 });
const ITEM_MOUSE_ACTION = Object.freeze({
  addToTrade: 2,
  mouseUp: 7,
  mouseClick: 8,
  state: 7,
  removeFromTrade: 9,
});
const clearReservations = (globals: QuickItemMoveGlobals) => concat(
  global(globals.scratch), op(0x04, 0x40),
    ...Array.from({ length: QUICK_ITEM_MOVE_RESERVATION_COUNT }, (_, index) =>
      concat(global(globals.scratch), i32(0), store(
        QUICK_ITEM_MOVE_RESERVATION_OFFSET + index * QUICK_ITEM_MOVE_RESERVATION_BYTES,
      ))),
  op(0x0b),
);

export type QuickItemMoveGlobals = Readonly<{
  enabled: number;
  modifiers: number;
  scratch: number;
  draining: number;
  intentModifiers: number;
}>;

type QuickItemMoveCertificate = NonNullable<KnownEnhancementBuild["quickItemMove"]>;
type PreGameCertificate = NonNullable<KnownEnhancementBuild["preGameControls"]>;

export type ResolvedQuickItemMoveFunction = Readonly<{
  localIndex: number;
  typeIndex: number;
}>;

export type QuickItemMoveResolution = Readonly<{
  certificate: QuickItemMoveCertificate;
  inventorySlot: ResolvedQuickItemMoveFunction;
  materialStorageSlot: ResolvedQuickItemMoveFunction;
  moveItem: ResolvedQuickItemMoveFunction;
}> | null;

type ResolveFunction = (
  label: string,
  functionIndex: number,
  expectedParams: readonly string[],
  expectedResults: readonly string[],
) => ResolvedQuickItemMoveFunction;

/** Resolves and rechecks every function whose exact body authorizes this feature. */
export function resolveQuickItemMoveTransform(options: Readonly<{
  build: KnownEnhancementBuild;
  enabled: boolean;
  resolveFunction: ResolveFunction;
  bodyHash: (functionIndex: number) => string;
  fail: (message: string) => never;
}>): QuickItemMoveResolution {
  if (!options.enabled) return null;
  const certificate = options.build.quickItemMove
    ?? options.fail("Quick Item Move is not certified");
  const entries = [
    ["quick item inventory slot", certificate.inventorySlot],
    ["quick item material slot", certificate.materialStorageSlot],
    ["quick item number preference", certificate.numberPreference],
    ["quick item quantity move", certificate.moveItem],
    ["quick item timer", certificate.timer],
  ] as const;
  const resolved = entries.map(([label, entry]) => {
    const fn = options.resolveFunction(label, entry.functionIndex, entry.params, entry.results);
    if (options.bodyHash(entry.functionIndex) !== entry.bodySha256) {
      options.fail(`${label} body does not match its certificate`);
    }
    return fn;
  });
  return Object.freeze({
    certificate,
    inventorySlot: resolved[0]!,
    materialStorageSlot: resolved[1]!,
    moveItem: resolved[3]!,
  });
}

export type QuickItemMoveTypes = Readonly<{
  configureType: number;
  modifierType: number;
  unaryType: number;
  binaryType: number;
  ternaryType: number;
  slotType: number;
}> | null;

export function quickItemMoveGlobals(base: number): QuickItemMoveGlobals {
  return Object.freeze({
    enabled: base,
    modifiers: base + 1,
    scratch: base + 2,
    draining: base + 3,
    intentModifiers: base + 4,
  });
}

/** Reserves signatures at the transform's deterministic type-allocation point. */
export function reserveQuickItemMoveTypes(options: Readonly<{
  enabled: boolean;
  appendType: (type: FunctionType) => number;
}>): QuickItemMoveTypes {
  if (!options.enabled) return null;
  const configureType = options.appendType({ params: [0x7f, 0x7f], results: [0x7f] });
  const modifierType = options.appendType({ params: [0x7f], results: [0x7f] });
  return Object.freeze({
    configureType,
    modifierType,
    unaryType: modifierType,
    binaryType: options.appendType({ params: [0x7f, 0x7f], results: [0x7f] }),
    slotType: options.appendType({ params: [0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f], results: [0x7f] }),
    ternaryType: options.appendType({ params: [0x7f, 0x7f, 0x7f], results: [0x7f] }),
  });
}

export function quickItemMoveConfigure(
  globals: QuickItemMoveGlobals,
  pendingGlobal: number,
): Uint8Array {
  return concat(
    uleb(0),
    local(0), i32(1), op(0x71), setGlobal(globals.enabled),
    local(1), setGlobal(globals.scratch),
    local(0), op(0x45, 0x04, 0x40),
      i32(0), setGlobal(globals.modifiers), i32(0), setGlobal(globals.draining),
      i32(0), setGlobal(globals.intentModifiers),
      global(pendingGlobal), i32(QUICK_ITEM_MOVE_COMMAND), op(0x46, 0x04, 0x40),
        i32(0), setGlobal(pendingGlobal),
      op(0x0b),
      global(globals.scratch), op(0x04, 0x40),
        global(globals.scratch), i32(0), store(QUICK_ITEM_MOVE_PROMPT.item),
        global(globals.scratch), i32(0), store(QUICK_ITEM_MOVE_PROMPT.quantity),
      op(0x0b),
      clearReservations(globals),
    op(0x0b),
    global(globals.enabled), op(0x0b),
  );
}

export function quickItemMoveModifiers(globals: QuickItemMoveGlobals): Uint8Array {
  return concat(
    uleb(0),
    local(0), i32(3), op(0x71), setGlobal(globals.modifiers),
    i32(1), op(0x0b),
  );
}

/** Toolbox's stack identity checks, with bounded UTF-16 name reads. */
export function quickItemMoveSameItem(): Uint8Array {
  return concat(
    // params item pointers; locals left name, right name, index, character
    uleb(1), uleb(4), op(0x7f),
    ...[0, 1].map((item) => concat(
      local(item), op(0x45), local(item), memoryBytes(), i32(ITEM_BYTES),
      op(0x6b, 0x4b, 0x72, 0x04, 0x40), ret(0), op(0x0b),
      local(item), load(ITEM_OFFSET.interaction), i32(0x80000), op(0x71, 0x45, 0x04, 0x40), ret(0), op(0x0b),
    )),
    local(0), load(ITEM_OFFSET.modelFile), op(0x04, 0x40),
      local(0), load(ITEM_OFFSET.modelFile), local(1), load(ITEM_OFFSET.modelFile), op(0x47, 0x04, 0x40), ret(0), op(0x0b),
    op(0x0b),
    // ItemType::Dye is 10; type and its three DyeInfo bytes share this word.
    local(0), load(ITEM_OFFSET.typeAndDye), i32(255), op(0x71), i32(10), op(0x46, 0x04, 0x40),
      local(0), load(ITEM_OFFSET.typeAndDye), local(1), load(ITEM_OFFSET.typeAndDye), op(0x47, 0x04, 0x40), ret(0), op(0x0b),
    op(0x0b),
    local(0), load(ITEM_OFFSET.name), setLocal(2), local(1), load(ITEM_OFFSET.name), setLocal(3),
    local(2), op(0x45), local(3), op(0x45, 0x72, 0x04, 0x40), ret(0), op(0x0b),
    i32(0), setLocal(4), op(0x02, 0x40, 0x03, 0x40),
      local(4), i32(512), op(0x4f, 0x0d), uleb(1),
      ...[2, 3].map((pointer) => concat(
        local(pointer), memoryBytes(), i32(2), op(0x6b, 0x4b, 0x04, 0x40), ret(0), op(0x0b),
      )),
      local(2), load16(), setLocal(5), local(5), local(3), load16(), op(0x47, 0x04, 0x40), ret(0), op(0x0b),
      local(5), op(0x45, 0x04, 0x40), ret(1), op(0x0b),
      local(2), i32(2), op(0x6a), setLocal(2), local(3), i32(2), op(0x6a), setLocal(3),
      local(4), i32(1), op(0x6a), setLocal(4), op(0x0c), uleb(0),
    op(0x0b, 0x0b), ret(0), op(0x0b),
  );
}

export function quickItemMoveFindFrame(
  layout: NonNullable<KnownEnhancementBuild["preGameControls"]>["layout"],
): Uint8Array {
  return concat(
    // locals: count, array, index, frame
    uleb(1), uleb(4), op(0x7f),
    i32(layout.frameCount), load(), setLocal(1),
    local(1), op(0x45), local(1), i32(16_384), op(0x4b, 0x72, 0x04, 0x40), ret(0), op(0x0b),
    i32(layout.frameArray), load(), setLocal(2), local(2), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    // The registry mutates while windows are created and destroyed. Bound
    // both its pointer table and each transient frame before dereferencing.
    local(2), memoryBytes(), local(1), i32(2), op(0x74, 0x6b, 0x4b, 0x04, 0x40), ret(0), op(0x0b),
    i32(0), setLocal(3), op(0x02, 0x40, 0x03, 0x40),
      local(3), local(1), op(0x4f, 0x0d), uleb(1),
      local(2), local(3), i32(4), op(0x6c, 0x6a), load(), setLocal(4),
      local(4), op(0x45, 0x45),
        local(4), memoryBytes(), i32(layout.frameBytes), op(0x6b, 0x4d, 0x71, 0x04, 0x40),
        local(4), load(layout.frameId), local(3), op(0x46, 0x04, 0x40),
        local(4), load(layout.frameHashId), local(0), op(0x46, 0x04, 0x40),
          local(4), load(layout.frameState), i32(4), op(0x71, 0x45, 0x45),
          local(4), load(layout.frameState), i32(0x200), op(0x71, 0x45, 0x71, 0x04, 0x40),
            local(4), op(0x0f),
          op(0x0b),
        op(0x0b),
        op(0x0b),
      op(0x0b),
      local(3), i32(1), op(0x6a), setLocal(3), op(0x0c), uleb(0),
    op(0x0b, 0x0b), i32(0), op(0x0b),
  );
}

export function quickItemMoveFindAncestor(
  frameResolver: number,
  frameParent: number,
  frameHashOffset: number,
  frameIdOffset: number,
  frameBytes: number,
): Uint8Array {
  return concat(
    // locals: frame id, resolved frame pointer, depth. Both native helpers
    // accept an id; only the resolver's result may be dereferenced.
    uleb(1), uleb(3), op(0x7f),
    local(0), setLocal(2), i32(0), setLocal(4),
    op(0x02, 0x40, 0x03, 0x40),
      local(2), op(0x45), local(4), i32(16), op(0x4f, 0x72, 0x0d), uleb(1),
      local(2), call(frameResolver), setLocal(3),
      local(3), op(0x45, 0x45),
        local(3), memoryBytes(), i32(frameBytes), op(0x6b, 0x4d, 0x71, 0x45, 0x0d), uleb(1),
      local(3), load(frameIdOffset), local(2), op(0x47, 0x0d), uleb(1),
      local(3), load(frameHashOffset), local(1), op(0x46, 0x04, 0x40), local(3), op(0x0f, 0x0b),
      local(2), call(frameParent), setLocal(2), local(4), i32(1), op(0x6a), setLocal(4), op(0x0c), uleb(0),
    op(0x0b, 0x0b), i32(0), op(0x0b),
  );
}

type QuickMoveContext = Readonly<{
  certificate: NonNullable<KnownEnhancementBuild["quickItemMove"]>;
  layout: NonNullable<KnownEnhancementBuild["preGameControls"]>["layout"];
  globals: QuickItemMoveGlobals;
  itemLookup: number;
  uiDispatcher: number;
  findFrame: number;
}>;

export type QuickExecutorConfig = QuickMoveContext & Readonly<{
  numberPreference: number;
  availableSource: number;
  moveSlot: number;
  materialCapacity: number;
}>;

/** Mirrors GWCA Items::GetItemById against the already certified GameContext.
 * Item ids are indices in ItemContext::item_array. Every pointer used by the
 * generated code is bounded before it is dereferenced. */
export function quickItemMoveItemLookup(
  layout: NonNullable<KnownEnhancementBuild["preGameControls"]>["layout"],
): Uint8Array {
  return concat(
    // param item id; locals context root, game, items, buffer, address, item
    uleb(1), uleb(6), op(0x7f),
    local(0), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(0), i32(1_000_000), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
    i32(layout.contextRoot), load(), setLocal(1), local(1), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(1), load(layout.gameContextSlot * 4), setLocal(2), local(2), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(2), load(GAME_CONTEXT_OFFSET.items), setLocal(3), local(3), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(0), local(3), load(ITEM_ARRAY_OFFSET.size), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
    local(3), load(ITEM_ARRAY_OFFSET.buffer), setLocal(4), local(4), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(4), local(0), i32(4), op(0x6c, 0x6a), setLocal(5),
    local(5), memoryBytes(), i32(4), op(0x6b, 0x4d, 0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(5), load(), setLocal(6),
    local(6), op(0x45, 0x45), local(6), memoryBytes(), i32(ITEM_BYTES),
      op(0x6b, 0x4d, 0x71, 0x04, 0x7f), local(6), op(0x05), i32(0), op(0x0b, 0x0b),
  );
}

const claimAddress = (g: QuickItemMoveGlobals, index: number) => concat(
  global(g.scratch), i32(QUICK_ITEM_MOVE_RESERVATION_OFFSET), op(0x6a),
  local(index), i32(QUICK_ITEM_MOVE_RESERVATION_BYTES), op(0x6c, 0x6a),
);
const increment = (index: number) => concat(local(index), i32(1), op(0x6a), setLocal(index));
const itemKey = (item: number) => concat(
  local(item), load(ITEM_OFFSET.bag), load(BAG_OFFSET.index), i32(16), op(0x74),
  local(item), load8(ITEM_OFFSET.slot), op(0x72),
);

/** Reclaims acknowledged or timed-out moves before calculating source capacity.
 * Key release is not an acknowledgement. Timeouts follow Toolbox's three seconds. */
export function quickItemMoveAvailableSource(c: Pick<QuickMoveContext, "globals" | "itemLookup" | "certificate">): Uint8Array {
  const p = { sourceId: 0, inventory: 1 };
  const v = { source: 2, remaining: 3, now: 4, index: 5, claim: 6,
    priorSource: 7, bag: 8, target: 9, acknowledged: 10, key: 11, slots: 12, count: 13 };
  // params source id, inventory pointer; locals source, remaining, now, index,
  // claim, prior source, destination bag, target, acknowledged, key, slots, count
  return concat(
    uleb(1), uleb(Object.keys(v).length), op(0x7f),
    local(p.sourceId), call(c.itemLookup), setLocal(v.source), local(v.source), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    requireMemory(p.inventory, INVENTORY_BAG_INDEX.afterStorage * 4),
    local(v.source), load16(ITEM_OFFSET.quantity), setLocal(v.remaining), call(c.certificate.timer.functionIndex), setLocal(v.now),
    i32(0), setLocal(v.index), op(0x02, 0x40, 0x03, 0x40),
      local(v.index), i32(QUICK_ITEM_MOVE_RESERVATION_COUNT), op(0x4f, 0x0d), uleb(1),
      claimAddress(c.globals, v.index), setLocal(v.claim),
      op(0x02, 0x40),
        local(v.claim), load(CLAIM.source), op(0x45, 0x0d), uleb(0),
        local(v.now), local(v.claim), load(CLAIM.started), op(0x6b), i32(3_000), op(0x4f, 0x04, 0x40),
          local(v.claim), i32(0), store(CLAIM.source), op(0x0c), uleb(1),
        op(0x0b),
        local(v.claim), load(CLAIM.source), call(c.itemLookup), setLocal(v.priorSource),
        i32(1), setLocal(v.acknowledged),
        local(v.priorSource), op(0x04, 0x40),
          local(v.priorSource), load(ITEM_OFFSET.bag), setLocal(v.bag), local(v.bag), op(0x04, 0x40),
            requireMemory(v.bag, 40),
            itemKey(v.priorSource), local(v.claim), load(CLAIM.sourceKey), op(0x46),
            local(v.priorSource), load16(ITEM_OFFSET.quantity), local(v.claim), load(CLAIM.remaining), op(0x4b, 0x71, 0x45), setLocal(v.acknowledged),
          op(0x0b),
        op(0x0b),
        // Both sides must reflect the move: source and destination updates can
        // arrive separately. A missing source alone does not free a destination.
        local(v.acknowledged), op(0x04, 0x40),
          local(v.claim), load(CLAIM.destination), setLocal(v.key),
          local(v.key), i32(16), op(0x76), i32(1), op(0x6a), i32(INVENTORY_BAG_INDEX.afterStorage), op(0x49, 0x04, 0x40),
            local(p.inventory), local(v.key), i32(16), op(0x76), i32(1), op(0x6a), i32(4), op(0x6c, 0x6a), load(), setLocal(v.bag),
            local(v.bag), op(0x04, 0x40),
              requireMemory(v.bag, 40),
              local(v.bag), load(BAG_OFFSET.items), setLocal(v.slots), local(v.bag), load(BAG_OFFSET.itemCount), setLocal(v.count),
              local(v.key), i32(0xffff), op(0x71), local(v.count), op(0x49), local(v.count), i32(256), op(0x4d, 0x71, 0x04, 0x40),
                requireMemory(v.slots, 4),
                local(v.slots), memoryBytes(), local(v.count), i32(4), op(0x6c, 0x6b, 0x4b, 0x04, 0x40), ret(0), op(0x0b),
                local(v.slots), local(v.key), i32(0xffff), op(0x71), i32(4), op(0x6c, 0x6a), load(), setLocal(v.target),
                local(v.target), op(0x04, 0x40),
                  requireMemory(v.target, ITEM_BYTES),
                  local(v.target), load16(ITEM_OFFSET.quantity), local(v.claim), load(CLAIM.expected), op(0x4f, 0x04, 0x40),
                    local(v.claim), i32(0), store(CLAIM.source),
                  op(0x0b),
                op(0x0b),
              op(0x0b),
            op(0x0b),
          op(0x0b),
        op(0x0b),
        local(v.claim), load(CLAIM.source), local(p.sourceId), op(0x46, 0x04, 0x40),
          local(v.claim), load(CLAIM.remaining), local(v.remaining), op(0x49, 0x04, 0x40), local(v.claim), load(CLAIM.remaining), setLocal(v.remaining), op(0x0b),
        op(0x0b),
      op(0x0b), increment(v.index), op(0x0c), uleb(0),
    op(0x0b, 0x0b), local(v.remaining), op(0x0b),
  );
}

/** One bounded slot transaction: validate identity, reserve capacity, then move.
 * The caller owns stack-first bag traversal; this helper never chooses a bag. */
export function quickItemMoveSlot(c: Pick<QuickMoveContext, "globals" | "itemLookup" | "certificate"> & Readonly<{ sameItem: number }>): Uint8Array {
  const p = { sourceId: 0, remaining: 1, bag: 2, slot: 3, pass: 4, capacity: 5 };
  const v = { source: 6, target: 7, expected: 8, key: 9, index: 10,
    claim: 11, freeClaim: 12, quantity: 13, available: 14 };
  // params source id, remaining, bag pointer, slot, pass (0 stacks / 1 empty / 2 fixed), capacity
  // locals source, target, expected, key, index, claim, free claim, quantity, available source
  return concat(
    uleb(1), uleb(Object.keys(v).length), op(0x7f),
    local(p.capacity), op(0x45), local(p.capacity), i32(65_535), op(0x4b, 0x72, 0x04, 0x40), ret(0), op(0x0b),
    local(p.sourceId), call(c.itemLookup), setLocal(v.source), local(v.source), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(v.source), load16(ITEM_OFFSET.quantity), setLocal(v.available),
    local(p.bag), load(BAG_OFFSET.items), local(p.slot), i32(4), op(0x6c, 0x6a), load(), setLocal(v.target),
    local(v.target), op(0x04, 0x40),
      local(v.source), local(v.target), call(c.sameItem), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
      local(v.target), load16(ITEM_OFFSET.quantity), setLocal(v.expected),
    op(0x0b),
    local(p.bag), load(BAG_OFFSET.index), i32(16), op(0x74), local(p.slot), op(0x72), setLocal(v.key),
    i32(0), setLocal(v.index), op(0x02, 0x40, 0x03, 0x40),
      local(v.index), i32(QUICK_ITEM_MOVE_RESERVATION_COUNT), op(0x4f, 0x0d), uleb(1),
      claimAddress(c.globals, v.index), setLocal(v.claim),
      local(v.claim), load(CLAIM.source), local(p.sourceId), op(0x46, 0x04, 0x40),
        local(v.claim), load(CLAIM.remaining), local(v.available), op(0x49, 0x04, 0x40), local(v.claim), load(CLAIM.remaining), setLocal(v.available), op(0x0b),
      op(0x0b),
      local(v.claim), load(CLAIM.source), op(0x45, 0x04, 0x40),
        local(v.freeClaim), op(0x45, 0x04, 0x40), local(v.claim), setLocal(v.freeClaim), op(0x0b),
      op(0x05),
        local(v.claim), load(CLAIM.destination), local(v.key), op(0x46, 0x04, 0x40),
          // An unacknowledged move owns identity even if a target is visible.
          local(v.source), local(v.claim), load(CLAIM.source), call(c.itemLookup), call(c.sameItem),
          op(0x45, 0x04, 0x40), ret(0), op(0x0b),
          local(v.claim), load(CLAIM.expected), local(v.expected), op(0x4b, 0x04, 0x40), local(v.claim), load(CLAIM.expected), setLocal(v.expected), op(0x0b),
        op(0x0b),
      op(0x0b), increment(v.index), op(0x0c), uleb(0),
    op(0x0b, 0x0b),
    local(v.freeClaim), op(0x45), local(v.expected), local(p.capacity), op(0x4f, 0x72),
    local(v.expected), op(0x45), local(p.pass), op(0x47), local(p.pass), i32(2), op(0x49, 0x71, 0x72, 0x04, 0x40), ret(0), op(0x0b),
    local(p.capacity), local(v.expected), op(0x6b), setLocal(v.quantity),
    local(v.quantity), local(p.remaining), op(0x4b, 0x04, 0x40), local(p.remaining), setLocal(v.quantity), op(0x0b),
    local(v.quantity), local(v.available), op(0x4b, 0x04, 0x40), local(v.available), setLocal(v.quantity), op(0x0b),
    local(v.quantity), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(v.freeClaim), local(p.sourceId), store(CLAIM.source),
    local(v.freeClaim), local(v.available), local(v.quantity), op(0x6b), store(CLAIM.remaining),
    local(v.freeClaim), local(v.key), store(CLAIM.destination),
    local(v.freeClaim), local(v.expected), local(v.quantity), op(0x6a), store(CLAIM.expected),
    local(v.freeClaim), call(c.certificate.timer.functionIndex), store(CLAIM.started),
    local(v.freeClaim), itemKey(v.source), store(CLAIM.sourceKey),
    local(p.sourceId), local(v.quantity), local(p.bag), load(BAG_OFFSET.index), local(p.slot), call(c.certificate.moveItem.functionIndex),
    local(v.quantity), op(0x0b),
  );
}

/** Mirrors GWCA's account unlock 0x83 capacity rule, bounded to uint16 item quantities. */
export function quickItemMoveMaterialCapacity(): Uint8Array {
  // param game context; locals account, array, count, index, row
  return concat(
    uleb(1), uleb(5), op(0x7f),
    requireMemory(0, 0x2c), local(0), load(0x28), setLocal(1),
    local(1), op(0x45, 0x04, 0x40), ret(250), op(0x0b), requireMemory(1, 16),
    local(1), load(), setLocal(2), local(1), load(8), setLocal(3),
    local(3), i32(4_096), op(0x4b, 0x04, 0x40), ret(0), op(0x0b),
    local(2), memoryBytes(), local(3), i32(12), op(0x6c, 0x6b, 0x4b, 0x04, 0x40), ret(0), op(0x0b),
    i32(0), setLocal(4), op(0x02, 0x40, 0x03, 0x40),
      local(4), local(3), op(0x4f, 0x0d), uleb(1),
      local(2), local(4), i32(12), op(0x6c, 0x6a), setLocal(5),
      local(5), load(), i32(0x83), op(0x46, 0x04, 0x40),
        local(5), load(4), i32(261), op(0x4b, 0x04, 0x40), ret(0), op(0x0b),
        local(5), load(4), i32(1), op(0x6a), i32(250), op(0x6c, 0x0f),
      op(0x0b), increment(4), op(0x0c), uleb(0),
    op(0x0b, 0x0b), ret(250), op(0x0b),
  );
}

export function quickItemMoveStorageExecutor(c: QuickExecutorConfig): Uint8Array {
  const g = c.globals;
  // Native parameters are item id, requested quantity and transfer direction.
  const v = { item: 3, sourceBag: 4, context: 5, game: 6, items: 7, inventory: 8,
    page: 9, bag: 10, bagNo: 11, slot: 12, slots: 13, count: 14,
    first: 15, end: 16, pass: 17, remaining: 18, quantity: 19, moved: 20,
    modifier: 21, modifierEnd: 22 };
  return concat(
    uleb(1), uleb(20), op(0x7f),
    global(g.enabled), op(0x45), global(g.scratch), op(0x45, 0x72, 0x04, 0x40), ret(0), op(0x0b),
    global(g.scratch), memoryBytes(), i32(QUICK_ITEM_MOVE_SCRATCH_BYTES), op(0x6b, 0x4b, 0x04, 0x40), ret(0), op(0x0b),
    i32(c.certificate.storageFrameHash), call(c.findFrame), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(2), i32(MOVE_DIRECTION.store), op(0x47), local(2), i32(MOVE_DIRECTION.withdraw), op(0x47, 0x71, 0x04, 0x40), ret(0), op(0x0b),
    local(0), call(c.itemLookup), setLocal(v.item), local(v.item), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(v.item), load(ITEM_OFFSET.modelFile), i32(0x2f301), op(0x46, 0x04, 0x40), ret(0), op(0x0b),
    local(1), op(0x45), local(1), local(v.item), load16(ITEM_OFFSET.quantity), op(0x4b, 0x72, 0x04, 0x40), ret(0), op(0x0b),
    local(v.item), load(ITEM_OFFSET.bag), setLocal(v.sourceBag), requireMemory(v.sourceBag, 40),
    i32(c.layout.contextRoot), load(), setLocal(v.context), requireMemory(v.context, c.layout.gameContextSlot * 4 + 4),
    local(v.context), load(c.layout.gameContextSlot * 4), setLocal(v.game), requireMemory(v.game, GAME_CONTEXT_OFFSET.items + 4),
    local(v.game), load(GAME_CONTEXT_OFFSET.items), setLocal(v.items), requireMemory(v.items, ITEM_CONTEXT_OFFSET.inventory + 4),
    local(v.items), load(ITEM_CONTEXT_OFFSET.inventory), setLocal(v.inventory), requireMemory(v.inventory, INVENTORY_BAG_INDEX.afterStorage * 4),
    local(2), i32(MOVE_DIRECTION.store), op(0x46, 0x04, 0x7f),
      local(v.sourceBag), load(), i32(BAG_TYPE.inventory), op(0x46),
    op(0x05),
      local(v.sourceBag), load(), i32(BAG_TYPE.storage), op(0x46),
      local(v.sourceBag), load(), i32(BAG_TYPE.materialStorage), op(0x46, 0x72),
    op(0x0b, 0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(0), local(v.inventory), call(c.availableSource), setLocal(v.remaining),
    local(v.remaining), local(1), op(0x4b, 0x04, 0x40), local(1), setLocal(v.remaining), op(0x0b),
    local(v.remaining), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    effectiveModifiers(g), i32(2), op(0x71, 0x45, 0x45), local(1), i32(1), op(0x4b, 0x71, 0x04, 0x40),
      global(g.scratch), local(0), store(QUICK_ITEM_MOVE_PROMPT.item),
      global(g.scratch), itemKey(v.item), store(QUICK_ITEM_MOVE_PROMPT.sourceKey),
      global(g.scratch), local(2), store(QUICK_ITEM_MOVE_PROMPT.direction),
      global(g.scratch), local(0), store(),
      global(g.scratch), local(v.sourceBag), load(BAG_OFFSET.index), store(4),
      global(g.scratch), local(v.item), load8(ITEM_OFFSET.slot), store(8),
      global(g.scratch), i32(1), store(12),
      i32(UI_MESSAGE.moveItem), global(g.scratch), i32(0), call(c.uiDispatcher), ret(1),
    op(0x0b),
    local(2), i32(MOVE_DIRECTION.store), op(0x46, 0x04, 0x40),
      i32(NUMBER_PREFERENCE_STORAGE_PANE), call(c.numberPreference), i32(255), op(0x71), setLocal(v.page),
      local(v.page), i32(STORAGE_PANE.count), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
      local(v.page), i32(STORAGE_PANE.material), op(0x46, 0x04, 0x40),
        // Materials use fixed slots but share quantity and pending-move handling.
        local(v.inventory), load(INVENTORY_BAG_INDEX.material * 4), setLocal(v.bag),
        requireMemory(v.bag, 40),
        local(v.item), load(ITEM_OFFSET.modifiers), setLocal(v.modifier),
        local(v.item), load(ITEM_OFFSET.modifierCount), setLocal(v.count),
        local(v.count), i32(64), op(0x4b, 0x04, 0x40), ret(0), op(0x0b),
        local(v.modifier), memoryBytes(), local(v.count), i32(4), op(0x6c, 0x6b, 0x4b, 0x04, 0x40), ret(0), op(0x0b),
        local(v.count), i32(4), op(0x6c), local(v.modifier), op(0x6a), setLocal(v.modifierEnd),
        i32(MATERIAL_SLOT_COUNT), setLocal(v.slot), op(0x02, 0x40, 0x03, 0x40),
          local(v.modifier), local(v.modifierEnd), op(0x4f, 0x0d), uleb(1),
          local(v.modifier), load(), i32(-65536), op(0x71), i32(0x2508_0000), op(0x46, 0x04, 0x40),
            local(v.modifier), load(), i32(8), op(0x76), i32(255), op(0x71), setLocal(v.slot), op(0x0c), uleb(2),
          op(0x0b), local(v.modifier), i32(4), op(0x6a), setLocal(v.modifier), op(0x0c), uleb(0),
        op(0x0b, 0x0b),
        local(v.slot), i32(MATERIAL_SLOT_COUNT), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
        local(v.slot), local(v.bag), load(BAG_OFFSET.itemCount), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
        local(v.bag), load(BAG_OFFSET.items), setLocal(v.slots), requireMemory(v.slots, MATERIAL_SLOT_COUNT * 4),
        local(0), local(v.remaining), local(v.bag), local(v.slot), i32(2), local(v.game), call(c.materialCapacity), call(c.moveSlot),
        op(0x45, 0x45, 0x0f),
      op(0x0b),
      local(v.page), i32(INVENTORY_BAG_INDEX.storage1), op(0x6a), setLocal(v.first),
      local(v.first), i32(1), op(0x6a), setLocal(v.end),
    op(0x05),
      i32(INVENTORY_BAG_INDEX.backpack), setLocal(v.first), i32(INVENTORY_BAG_INDEX.afterBag2), setLocal(v.end),
    op(0x0b),
    // Scan all eligible bags for stacks before considering any empty cell.
    i32(0), setLocal(v.pass), op(0x03, 0x40),
      local(v.first), setLocal(v.bagNo), op(0x02, 0x40, 0x03, 0x40),
        local(v.bagNo), local(v.end), op(0x4f, 0x0d), uleb(1),
        local(v.inventory), local(v.bagNo), i32(4), op(0x6c, 0x6a), load(), setLocal(v.bag),
        local(v.bag), op(0x04, 0x40),
          requireMemory(v.bag, 40),
          local(v.bag), load(BAG_OFFSET.items), setLocal(v.slots), local(v.bag), load(BAG_OFFSET.itemCount), setLocal(v.count),
          local(v.count), i32(256), op(0x4b, 0x04, 0x40), ret(0), op(0x0b),
          local(v.count), op(0x04, 0x40), requireMemory(v.slots, 4), op(0x0b),
          local(v.slots), memoryBytes(), local(v.count), i32(4), op(0x6c, 0x6b, 0x4b, 0x04, 0x40), ret(0), op(0x0b),
          i32(0), setLocal(v.slot), op(0x02, 0x40, 0x03, 0x40),
            local(v.slot), local(v.count), op(0x4f, 0x0d), uleb(1),
            local(0), local(v.remaining), local(v.bag), local(v.slot), local(v.pass), i32(250), call(c.moveSlot), setLocal(v.quantity),
            local(v.quantity), op(0x04, 0x40),
              local(v.remaining), local(v.quantity), op(0x6b), setLocal(v.remaining), i32(1), setLocal(v.moved),
              local(v.remaining), op(0x45, 0x04, 0x40), ret(1), op(0x0b),
            op(0x0b), increment(v.slot), op(0x0c), uleb(0),
          op(0x0b, 0x0b),
        op(0x0b), increment(v.bagNo), op(0x0c), uleb(0),
      op(0x0b, 0x0b), increment(v.pass), local(v.pass), i32(2), op(0x49, 0x0d), uleb(0),
    op(0x0b), local(v.moved), op(0x0b),
  );
}

/** Cancels stale prompt ownership whenever another native move UI starts. */
export function quickItemMoveUiWrapper(g: QuickItemMoveGlobals, original: number): Uint8Array {
  return concat(
    uleb(0), global(g.scratch), op(0x04, 0x40),
      local(0), i32(UI_MESSAGE.moveItem), op(0x46, 0x04, 0x40),
        global(g.scratch), i32(0), store(QUICK_ITEM_MOVE_PROMPT.item),
      op(0x0b),
    op(0x0b), local(0), local(1), local(2), call(original), op(0x0b),
  );
}

/** Intercepts only our same-source quantity confirmation. The chosen amount
 * enters the existing game-thread mailbox; unrelated native moves pass through. */
export function quickItemMoveQuantityWrapper(c: Readonly<{
  globals: QuickItemMoveGlobals; original: number; pendingGlobal: number; argumentGlobalBase: number;
}>): Uint8Array {
  const g = c.globals;
  return concat(
    uleb(0), global(g.scratch), op(0x04, 0x40),
      global(g.scratch), load(QUICK_ITEM_MOVE_PROMPT.item), local(0), op(0x46),
      local(2), i32(16), op(0x74), local(3), op(0x72),
      global(g.scratch), load(QUICK_ITEM_MOVE_PROMPT.sourceKey), op(0x46, 0x71, 0x04, 0x40),
        global(g.scratch), i32(0), store(QUICK_ITEM_MOVE_PROMPT.item),
        global(g.enabled), global(c.pendingGlobal), op(0x45, 0x71), local(1), op(0x45, 0x45, 0x71, 0x04, 0x40),
          global(g.scratch), local(1), store(QUICK_ITEM_MOVE_PROMPT.quantity),
          local(0), setGlobal(c.argumentGlobalBase), i32(0), setGlobal(c.argumentGlobalBase + 1),
          i32(1), setGlobal(g.intentModifiers), i32(QUICK_ITEM_MOVE_COMMAND), setGlobal(c.pendingGlobal),
        op(0x0b, 0x0f),
      op(0x0b),
    op(0x0b),
    local(0), local(1), local(2), local(3), call(c.original), op(0x0b),
  );
}

/** A quantity confirmation has no originating item frame. Drain it through
 * the same storage executor; ordinary clicks retain their trade-aware handler. */
export function quickItemMoveDispatch(g: QuickItemMoveGlobals, handler: number, storage: number): Uint8Array {
  return concat(
    uleb(1), uleb(1), op(0x7f),
    global(g.scratch), op(0x04, 0x40),
      global(g.scratch), load(QUICK_ITEM_MOVE_PROMPT.quantity), setLocal(2),
      global(g.scratch), i32(0), store(QUICK_ITEM_MOVE_PROMPT.quantity),
      local(1), op(0x45), local(2), op(0x45, 0x45, 0x71, 0x04, 0x40),
        local(0), local(2), global(g.scratch), load(QUICK_ITEM_MOVE_PROMPT.direction), call(storage), op(0x0f),
      op(0x0b),
    op(0x0b), local(0), local(1), call(handler), op(0x0b),
  );
}

export type QuickHandlerConfig = QuickMoveContext & Readonly<{
  frameDispatch: number;
  frameDispatchOffset: number;
  findAncestor: number;
  storageExecutor: number;
  pendingGlobal: number;
  argumentGlobalBase: number;
}>;

const effectiveModifiers = (g: QuickItemMoveGlobals) => concat(
  global(g.draining), op(0x04, 0x7f), global(g.intentModifiers),
  op(0x05), global(g.modifiers), op(0x0b),
);

export function quickItemMoveHandler(c: QuickHandlerConfig): Uint8Array {
  const g = c.globals;
  return concat(
    // params item id, frame id; locals item, bag, contexts, game, trade, cart, dialog, rows, count, index, scratch, qty
    uleb(1), uleb(12), op(0x7f),
    global(g.enabled), op(0x45), effectiveModifiers(g), i32(1),
      op(0x71, 0x45, 0x72, 0x04, 0x40), ret(0), op(0x0b),
    global(g.scratch), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(0), call(c.itemLookup), setLocal(2), local(2), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(2), load(ITEM_OFFSET.bag), setLocal(3), local(3), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    i32(c.layout.contextRoot), load(), setLocal(4), local(4), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(4), load(c.layout.gameContextSlot * 4), setLocal(5), local(5), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(5), load(GAME_CONTEXT_OFFSET.trade), setLocal(6),
    // UI callbacks only capture intent. Native UI messages are sent from the
    // certified recurring game-thread boundary on the next frame.
    global(g.draining), op(0x45, 0x04, 0x40),
      local(6), op(0x04, 0x7f),
        local(6), load(TRADE_OFFSET.flags), i32(TRADE_INITIATED_FLAG), op(0x71, 0x45, 0x45),
      op(0x05), i32(0), op(0x0b),
      i32(c.certificate.storageFrameHash), call(c.findFrame), op(0x45, 0x45, 0x72, 0x45),
      op(0x04, 0x40), ret(0), op(0x0b),
      global(c.pendingGlobal), op(0x04, 0x40), ret(0), op(0x0b),
      global(g.scratch), i32(0), store(QUICK_ITEM_MOVE_PROMPT.quantity),
      local(0), setGlobal(c.argumentGlobalBase),
      local(1), setGlobal(c.argumentGlobalBase + 1),
      global(g.modifiers), setGlobal(g.intentModifiers),
      i32(QUICK_ITEM_MOVE_COMMAND), setGlobal(c.pendingGlobal), ret(1),
    op(0x0b),
    local(6), op(0x04, 0x40),
      local(6), load(TRADE_OFFSET.flags), i32(TRADE_INITIATED_FLAG),
        op(0x71, 0x45, 0x45, 0x04, 0x40),
        // Frame ancestry is relevant only to an active trade. Avoid touching
        // transient trade UI records during ordinary storage clicks.
        local(1), i32(c.certificate.tradeCartFrameHash), call(c.findAncestor), setLocal(7),
        local(1), i32(c.certificate.tradeDialogFrameHash), call(c.findAncestor), setLocal(8),
        // Own cart click removes only an id present in the player's offer array.
        local(7), op(0x04, 0x40),
          local(6), load(TRADE_OFFSET.playerItems), setLocal(9),
            local(6), load(TRADE_OFFSET.playerItemCount), setLocal(10), i32(0), setLocal(11),
          op(0x02, 0x40, 0x03, 0x40), local(11), local(10), op(0x4f, 0x0d), uleb(1),
            local(9), local(11), i32(8), op(0x6c, 0x6a), load(), local(0), op(0x46, 0x04, 0x40),
              global(g.scratch), setLocal(12), local(12), i32(0), store(),
                local(12), i32(ITEM_MOUSE_ACTION.removeFromTrade), store(4),
                local(12), i32(ITEM_MOUSE_ACTION.state), store(8),
                local(12), local(0), store(12), local(12), i32(0), store(16),
              local(7), i32(c.frameDispatchOffset), op(0x6a), i32(UI_MESSAGE.frameMouseAction),
                local(12), i32(0), call(c.frameDispatch), ret(1),
            op(0x0b), local(11), i32(1), op(0x6a), setLocal(11), op(0x0c), uleb(0),
          op(0x0b, 0x0b), ret(0),
        op(0x0b),
        // Any other trade descendant is the partner cart and is never changed.
        local(8), op(0x04, 0x40), ret(0), op(0x0b),
        // Inventory takes trade precedence while both windows are open.
        local(3), load(), i32(BAG_TYPE.inventory), op(0x46, 0x04, 0x40),
          local(2), load(ITEM_OFFSET.interaction), i32(NOT_TRADABLE_INTERACTION), op(0x71, 0x04, 0x40), ret(0), op(0x0b),
          local(6), load(TRADE_OFFSET.playerItemCount), i32(TRADE_MAX_ITEMS), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
          local(6), load(TRADE_OFFSET.playerItems), setLocal(9), i32(0), setLocal(11),
          op(0x02, 0x40, 0x03, 0x40), local(11), local(6), load(TRADE_OFFSET.playerItemCount), op(0x4f, 0x0d), uleb(1),
            local(9), local(11), i32(8), op(0x6c, 0x6a), load(), local(0), op(0x46, 0x04, 0x40), ret(0), op(0x0b),
            local(11), i32(1), op(0x6a), setLocal(11), op(0x0c), uleb(0),
          op(0x0b, 0x0b),
          i32(c.certificate.tradeCartFrameHash), call(c.findFrame), setLocal(7), local(7), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
          global(g.scratch), setLocal(12), local(12), i32(0), store(),
            local(12), i32(ITEM_MOUSE_ACTION.addToTrade), store(4),
            local(12), i32(ITEM_MOUSE_ACTION.state), store(8),
            local(12), local(12), i32(20), op(0x6a), store(12),
            local(12), i32(0), store(16), local(12), local(0), store(20),
          effectiveModifiers(g), i32(2), op(0x71), op(0x04, 0x7f), i32(0), op(0x05),
            local(2), load16(ITEM_OFFSET.quantity), op(0x0b), setLocal(13), local(12), local(13), store(24),
          local(7), i32(c.frameDispatchOffset), op(0x6a), i32(UI_MESSAGE.frameMouseAction),
            local(12), i32(0), call(c.frameDispatch), ret(1),
        op(0x0b),
      op(0x0b),
    op(0x0b),
    // Storage items always withdraw, even during a trade.
    local(3), load(), i32(BAG_TYPE.storage), op(0x46),
      local(3), load(), i32(BAG_TYPE.materialStorage), op(0x46, 0x72, 0x04, 0x40),
      i32(MOVE_DIRECTION.withdraw), setLocal(11),
    op(0x05), local(3), load(), i32(BAG_TYPE.inventory), op(0x46, 0x04, 0x40),
      i32(MOVE_DIRECTION.store), setLocal(11), op(0x05), ret(0), op(0x0b), op(0x0b),
    local(0), local(2), load16(ITEM_OFFSET.quantity), local(11), call(c.storageExecutor), op(0x0b),
  );
}

export function quickItemMoveSlotWrapper(
  original: number,
  handler: number,
  material: boolean,
  frameResolver: number,
): Uint8Array {
  if (!material) {
    return concat(
      // params message, action, context; locals slot, bag context, item id, handled
      uleb(1), uleb(4), op(0x7f),
      local(0), load(4), i32(UI_MESSAGE.frameMouseAction), op(0x46),
      local(1), load(8), i32(ITEM_MOUSE_ACTION.mouseUp), op(0x46),
        local(1), load(8), i32(ITEM_MOUSE_ACTION.mouseClick), op(0x46, 0x72),
      op(0x71, 0x04, 0x40),
        local(1), load(4), i32(2), op(0x49, 0x45, 0x04, 0x40),
          local(1), load(4), i32(2), op(0x6b), setLocal(3),
          local(0), load(8), load(), setLocal(4),
          local(4), op(0x04, 0x40),
            local(3), local(4), load(16), op(0x49, 0x04, 0x40),
              local(4), load(8), local(3), i32(4), op(0x6c, 0x6a), load(), setLocal(5),
              local(5), local(1), load(), call(handler), setLocal(6),
              local(6), op(0x04, 0x40), op(0x0f, 0x0b),
            op(0x0b),
          op(0x0b),
        op(0x0b),
      op(0x0b),
      local(0), local(1), local(2), call(original), op(0x0b),
    );
  }
  const itemExpression = concat(
    local(1), load(), call(frameResolver), setLocal(3),
    local(3), op(0x45, 0x04, 0x7f), i32(0), op(0x05),
      // latest non-null callback context, whose material item id is +0x1c
      local(3), load(0xa8), setLocal(5), local(3), load(0xb0), setLocal(6),
      i32(0), setLocal(4),
      op(0x02,0x40,0x03,0x40), local(6), op(0x45,0x0d), uleb(1),
        local(6),i32(1),op(0x6b),setLocal(6),
        local(5),local(6),i32(12),op(0x6c,0x6a),load(4),setLocal(4),
        local(4),op(0x0d),uleb(1),op(0x0c),uleb(0),op(0x0b,0x0b),
      local(4), op(0x04,0x7f), local(4),load(28),op(0x05),i32(0),op(0x0b),
    op(0x0b),
  );
  return concat(
    uleb(1), uleb(6), op(0x7f),
    local(0), load(4), i32(UI_MESSAGE.frameMouseAction), op(0x46),
      local(1), load(8), i32(ITEM_MOUSE_ACTION.mouseUp), op(0x46),
      local(1), load(8), i32(ITEM_MOUSE_ACTION.mouseClick), op(0x46,0x72,0x71),
    op(0x04,0x40),
      itemExpression, setLocal(7),
      local(7), local(1), load(), call(handler), setLocal(8),
      local(8), op(0x04,0x40), op(0x0f,0x0b),
    op(0x0b), local(0),local(1),local(2),call(original),op(0x0b),
  );
}

/** Installs the complete callback replacement as one feature-owned contribution. */
export function applyQuickItemMoveTransform(options: Readonly<{
  resolution: NonNullable<QuickItemMoveResolution>;
  preGame: PreGameCertificate;
  uiHook: ResolvedQuickItemMoveFunction;
  globals: QuickItemMoveGlobals;
  types: NonNullable<QuickItemMoveTypes>;
  bodies: readonly Uint8Array[];
  nextBodies: Uint8Array[];
  appendFunction: (typeIndex: number, body: Uint8Array) => number;
  pendingGlobal: number;
  argumentGlobalBase: number;
}>): Readonly<{
  exports: readonly Readonly<{ name: string; index: number }>[];
  handlerIndex: number;
}> {
  const { certificate, inventorySlot, materialStorageSlot, moveItem } = options.resolution;
  const action = options.preGame.characterSwitchAction;
  const append = options.appendFunction;
  const uiForward = append(options.uiHook.typeIndex, options.nextBodies[options.uiHook.localIndex]!);
  options.nextBodies[options.uiHook.localIndex] = quickItemMoveUiWrapper(options.globals, uiForward);
  const moveOriginal = append(moveItem.typeIndex, options.nextBodies[moveItem.localIndex]!);
  options.nextBodies[moveItem.localIndex] = quickItemMoveQuantityWrapper({
    globals: options.globals, original: moveOriginal,
    pendingGlobal: options.pendingGlobal, argumentGlobalBase: options.argumentGlobalBase,
  });
  const findFrame = append(options.types.unaryType, quickItemMoveFindFrame(options.preGame.layout));
  const findAncestor = append(options.types.binaryType, quickItemMoveFindAncestor(
    action.frameResolver.functionIndex,
    action.frameParent.functionIndex,
    options.preGame.layout.frameHashId,
    options.preGame.layout.frameId,
    options.preGame.layout.frameBytes,
  ));
  const sameItem = append(options.types.binaryType, quickItemMoveSameItem());
  const itemLookup = append(
    options.types.unaryType,
    quickItemMoveItemLookup(options.preGame.layout),
  );
  const materialCapacity = append(options.types.unaryType, quickItemMoveMaterialCapacity());
  const availableSource = append(options.types.binaryType, quickItemMoveAvailableSource({
    certificate, globals: options.globals, itemLookup,
  }));
  const moveSlot = append(options.types.slotType, quickItemMoveSlot({
    certificate, globals: options.globals, itemLookup, sameItem,
  }));
  const executor = append(options.types.ternaryType, quickItemMoveStorageExecutor({
    certificate,
    layout: options.preGame.layout,
    globals: options.globals,
    itemLookup,
    numberPreference: certificate.numberPreference.functionIndex,
    uiDispatcher: uiForward,
    findFrame,
    availableSource,
    moveSlot,
    materialCapacity,
  }));
  const handler = append(options.types.binaryType, quickItemMoveHandler({
    certificate,
    layout: options.preGame.layout,
    globals: options.globals,
    itemLookup,
    uiDispatcher: uiForward,
    findFrame,
    frameDispatch: action.frameDispatch.functionIndex,
    frameDispatchOffset: action.frameDispatchOffset,
    findAncestor,
    storageExecutor: executor,
    pendingGlobal: options.pendingGlobal,
    argumentGlobalBase: options.argumentGlobalBase,
  }));
  const dispatch = append(options.types.binaryType, quickItemMoveDispatch(options.globals, handler, executor));
  const inventoryOriginal = append(inventorySlot.typeIndex, options.bodies[inventorySlot.localIndex]!);
  const materialOriginal = append(
    materialStorageSlot.typeIndex,
    options.bodies[materialStorageSlot.localIndex]!,
  );
  options.nextBodies[inventorySlot.localIndex] = quickItemMoveSlotWrapper(
    inventoryOriginal,
    handler,
    false,
    action.frameResolver.functionIndex,
  );
  options.nextBodies[materialStorageSlot.localIndex] = quickItemMoveSlotWrapper(
    materialOriginal,
    handler,
    true,
    action.frameResolver.functionIndex,
  );
  return Object.freeze({ exports: Object.freeze([
    Object.freeze({
      name: certificate.configureExport,
      index: append(options.types.configureType, quickItemMoveConfigure(
        options.globals,
        options.pendingGlobal,
      )),
    }),
    Object.freeze({
      name: certificate.modifierExport,
      index: append(options.types.modifierType, quickItemMoveModifiers(options.globals)),
    }),
  ]), handlerIndex: dispatch });
}

/** Runs one captured click from the same certified game-thread safe point as
 * the other native actions. The mailbox is cleared before execution. */
export function quickItemMoveDrain(
  pendingGlobal: number,
  argumentGlobalBase: number,
  globals: QuickItemMoveGlobals,
  handlerIndex: number,
): Uint8Array {
  return concat(
    global(pendingGlobal), i32(QUICK_ITEM_MOVE_COMMAND), op(0x46, 0x04, 0x40),
      i32(0), setGlobal(pendingGlobal), i32(1), setGlobal(globals.draining),
      global(argumentGlobalBase), global(argumentGlobalBase + 1), call(handlerIndex), op(0x1a),
      i32(0), setGlobal(globals.draining), op(0x0f),
    op(0x0b),
  );
}
