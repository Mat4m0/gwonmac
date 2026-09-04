/**
 * Emits the closed Control-click item action. It reads only certified item,
 * inventory, trade, and frame fields and sends Guild Wars' native UI messages.
 */
import { concat, sleb, uleb, type FunctionType } from "../core/wasm-binary.js";
import {
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
const load16 = (offset = 0) => concat(op(0x2f), uleb(1), uleb(offset));
const store = (offset = 0) => concat(op(0x36), uleb(2), uleb(offset));
const ret = (value: number) => concat(i32(value), op(0x0f));
const memoryBytes = () => concat(op(0x3f, 0x00), i32(16), op(0x74));
const UI_MESSAGE = Object.freeze({
  moveItem: 0x1000_01af,
  frameMouseAction: 49,
});
export const QUICK_ITEM_MOVE_COMMAND = -20;
const ITEM_OFFSET = Object.freeze({
  bag: 0x0c,
  modifiers: 0x10,
  modifierCount: 0x14,
  interaction: 0x28,
  quantity: 0x4c,
  slot: 0x50,
});
const BAG_OFFSET = Object.freeze({ index: 0x04, items: 0x18, itemCount: 0x20 });
const BAG_TYPE = Object.freeze({ inventory: 1, storage: 4, materialStorage: 5 });
const INVENTORY_BAG_INDEX = Object.freeze({ backpack: 1, afterBag2: 5, material: 6, storage1: 8 });
const GAME_CONTEXT_OFFSET = Object.freeze({ items: 0x40, trade: 0x58 });
const ITEM_CONTEXT_OFFSET = Object.freeze({ inventory: 0xf8 });
const ITEM_ARRAY_OFFSET = Object.freeze({ buffer: 0xb8, size: 0xc0 });
const ITEM_BYTES = 0x54;
const TRADE_OFFSET = Object.freeze({ flags: 0, playerItems: 0x14, playerItemCount: 0x1c });
const TRADE_INITIATED_FLAG = 1;
const TRADE_MAX_ITEMS = 7;
const STORAGE_PANE = Object.freeze({ count: 15, material: 14 });
const NUMBER_PREFERENCE_STORAGE_PANE = 20;
const MATERIAL_SLOT_COUNT = 41;
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
        QUICK_ITEM_MOVE_RESERVATION_OFFSET + index * Uint32Array.BYTES_PER_ELEMENT,
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
  });
}

export type QuickItemMoveTypes = Readonly<{
  configureType: number;
  modifierType: number;
  unaryType: number;
  binaryType: number;
  ternaryType: number;
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
      clearReservations(globals),
    op(0x0b),
    global(globals.enabled), op(0x0b),
  );
}

export function quickItemMoveModifiers(globals: QuickItemMoveGlobals): Uint8Array {
  return concat(
    uleb(0),
    local(0), i32(3), op(0x71), setGlobal(globals.modifiers),
    local(0), i32(1), op(0x71, 0x45, 0x04, 0x40),
      clearReservations(globals),
    op(0x0b),
    i32(1), op(0x0b),
  );
}

/** Claims a transient destination slot until Control is released. */
export function quickItemMoveClaimDestination(globals: QuickItemMoveGlobals): Uint8Array {
  return concat(
    // params destination bag index, zero-based slot; locals key, index, entry
    uleb(1), uleb(3), op(0x7f),
    global(globals.scratch), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(0), i32(0xffff), op(0x71), i32(16), op(0x74),
      local(1), i32(0xffff), op(0x71, 0x72), i32(1), op(0x6a), setLocal(2),
    i32(0), setLocal(3),
    op(0x02, 0x40, 0x03, 0x40),
      local(3), i32(QUICK_ITEM_MOVE_RESERVATION_COUNT), op(0x4f, 0x0d), uleb(1),
      global(globals.scratch), local(3), i32(Uint32Array.BYTES_PER_ELEMENT), op(0x6c),
        i32(QUICK_ITEM_MOVE_RESERVATION_OFFSET), op(0x6a, 0x6a), load(), setLocal(4),
      local(4), local(2), op(0x46, 0x04, 0x40), ret(0), op(0x0b),
      local(4), op(0x45, 0x04, 0x40),
        global(globals.scratch), local(3), i32(Uint32Array.BYTES_PER_ELEMENT), op(0x6c),
          i32(QUICK_ITEM_MOVE_RESERVATION_OFFSET), op(0x6a, 0x6a), local(2), store(), ret(1),
      op(0x0b),
      local(3), i32(1), op(0x6a), setLocal(3), op(0x0c), uleb(0),
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

export type QuickExecutorConfig = Readonly<{
  certificate: NonNullable<KnownEnhancementBuild["quickItemMove"]>;
  layout: NonNullable<KnownEnhancementBuild["preGameControls"]>["layout"];
  globals: QuickItemMoveGlobals;
  itemLookup: number;
  numberPreference: number;
  uiDispatcher: number;
  findFrame: number;
  claimDestination: number;
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

export function quickItemMoveStorageExecutor(c: QuickExecutorConfig): Uint8Array {
  const g = c.globals;
  return concat(
    // params id, quantity, direction; locals item, bag, contexts, game, items, inventory, page, dest, bagNo, slot, slots, count, mod, end
    uleb(1), uleb(15), op(0x7f),
    global(g.enabled), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    i32(c.certificate.storageFrameHash), call(c.findFrame), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(0), call(c.itemLookup), setLocal(3), local(3), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(1), op(0x45), local(1), local(3), load16(ITEM_OFFSET.quantity), op(0x4b, 0x72, 0x04, 0x40), ret(0), op(0x0b),
    local(3), load(ITEM_OFFSET.bag), setLocal(4), local(4), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    i32(c.layout.contextRoot), load(), setLocal(5), local(5), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(5), load(c.layout.gameContextSlot * 4), setLocal(6), local(6), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(6), load(GAME_CONTEXT_OFFSET.items), setLocal(7), local(7), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(7), load(ITEM_CONTEXT_OFFSET.inventory), setLocal(8), local(8), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    // Store to the visible pane.
    local(2), i32(MOVE_DIRECTION.store), op(0x46, 0x04, 0x40),
      local(4), load(), i32(BAG_TYPE.inventory), op(0x47, 0x04, 0x40), ret(0), op(0x0b),
      i32(NUMBER_PREFERENCE_STORAGE_PANE), call(c.numberPreference), i32(255), op(0x71), setLocal(9),
      local(9), i32(STORAGE_PANE.count), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
      local(9), i32(STORAGE_PANE.material), op(0x49, 0x04, 0x40),
        local(8), local(9), i32(INVENTORY_BAG_INDEX.storage1), op(0x6a), i32(4), op(0x6c, 0x6a), load(), setLocal(10),
      op(0x05),
        // Material slot is encoded by modifier 0x2508 at bits 8..15.
        local(3), load(ITEM_OFFSET.modifiers), setLocal(15), local(3), load(ITEM_OFFSET.modifierCount), i32(4), op(0x6c), local(15), op(0x6a), setLocal(16),
        i32(MATERIAL_SLOT_COUNT), setLocal(12), op(0x02, 0x40, 0x03, 0x40),
          local(15), local(16), op(0x4f, 0x0d), uleb(1), local(15), load(), setLocal(17),
          local(17), i32(-65536), op(0x71), i32(0x2508_0000), op(0x46, 0x04, 0x40),
            local(17), i32(8), op(0x76), i32(255), op(0x71), setLocal(12), op(0x0c), uleb(2),
          op(0x0b), local(15), i32(4), op(0x6a), setLocal(15), op(0x0c), uleb(0),
        op(0x0b, 0x0b),
        // 41 is GWCA MaterialSlot::Count, including all three Zaishen coins.
        local(12), i32(MATERIAL_SLOT_COUNT), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
        local(8), load(INVENTORY_BAG_INDEX.material * 4), setLocal(10),
      op(0x0b),
      local(10), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
      // Standard panes still need an empty-slot scan. A material slot is fixed
      // by item identity, so compatible rapid moves may safely share it.
      local(9), i32(STORAGE_PANE.material), op(0x49, 0x04, 0x40),
        i32(-1), setLocal(12),
      op(0x0b),
    op(0x05),
      // Withdraw into the first empty inventory slot.
      local(4), load(), i32(BAG_TYPE.storage), op(0x46), local(4), load(), i32(BAG_TYPE.materialStorage), op(0x46, 0x72, 0x45, 0x04, 0x40), ret(0), op(0x0b),
      i32(INVENTORY_BAG_INDEX.backpack), setLocal(11), i32(-1), setLocal(12), i32(0), setLocal(17),
      op(0x02, 0x40, 0x03, 0x40), local(11), i32(INVENTORY_BAG_INDEX.afterBag2), op(0x4f, 0x0d), uleb(1),
        local(8), local(11), i32(4), op(0x6c, 0x6a), load(), setLocal(10),
        local(10), op(0x04, 0x40),
          local(10), load(BAG_OFFSET.items), setLocal(13), local(10), load(BAG_OFFSET.itemCount), setLocal(14), i32(0), setLocal(12),
          op(0x02, 0x40, 0x03, 0x40), local(12), local(14), op(0x4f, 0x0d), uleb(1),
            local(13), local(12), i32(4), op(0x6c, 0x6a), load(), op(0x45, 0x04, 0x40),
              local(10), load(BAG_OFFSET.index), local(12), call(c.claimDestination), setLocal(17),
              local(17), op(0x0d), uleb(2),
            op(0x0b),
            local(12), i32(1), op(0x6a), setLocal(12), op(0x0c), uleb(0),
          op(0x0b, 0x0b),
          local(17), op(0x0d), uleb(2),
        op(0x0b),
        local(11), i32(1), op(0x6a), setLocal(11), op(0x0c), uleb(0),
      op(0x0b, 0x0b),
      local(17), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    op(0x0b),
    // For normal storage pages, locate the first empty slot now.
    local(2), i32(MOVE_DIRECTION.store), op(0x46),
      local(9), i32(STORAGE_PANE.material), op(0x49, 0x71, 0x04, 0x40),
      local(10), load(BAG_OFFSET.items), setLocal(13), local(10), load(BAG_OFFSET.itemCount), setLocal(14), i32(0), setLocal(12),
      op(0x02, 0x40, 0x03, 0x40), local(12), local(14), op(0x4f, 0x0d), uleb(1),
        local(13), local(12), i32(4), op(0x6c, 0x6a), load(), op(0x45, 0x04, 0x40),
          local(10), load(BAG_OFFSET.index), local(12), call(c.claimDestination), op(0x0d), uleb(2),
        op(0x0b),
        local(12), i32(1), op(0x6a), setLocal(12), op(0x0c), uleb(0),
      op(0x0b, 0x0b), local(12), local(14), op(0x4f, 0x04, 0x40), ret(0), op(0x0b),
    op(0x0b),
    // Native kMoveItem {item id, destination bag index, zero-based slot,
    // prompt}. GWCA's similarly shaped kSendMoveItem number is private to
    // GWCA's callback bus and is not a Guild Wars UI command.
    global(g.scratch), setLocal(15), local(15), op(0x45, 0x04, 0x40), ret(0), op(0x0b),
    local(15), local(0), store(),
    local(15), local(10), load(BAG_OFFSET.index), store(4),
    local(15), local(12), store(8),
    local(15), effectiveModifiers(g), i32(2), op(0x71, 0x45, 0x45), store(12),
    i32(UI_MESSAGE.moveItem), local(15), i32(0), call(c.uiDispatcher), ret(1), op(0x0b),
  );
}

export type QuickHandlerConfig = QuickExecutorConfig & Readonly<{
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
  const { certificate, inventorySlot, materialStorageSlot } = options.resolution;
  const action = options.preGame.characterSwitchAction;
  const append = options.appendFunction;
  const uiForward = append(options.uiHook.typeIndex, options.nextBodies[options.uiHook.localIndex]!);
  const findFrame = append(options.types.unaryType, quickItemMoveFindFrame(options.preGame.layout));
  const findAncestor = append(options.types.binaryType, quickItemMoveFindAncestor(
    action.frameResolver.functionIndex,
    action.frameParent.functionIndex,
    options.preGame.layout.frameHashId,
    options.preGame.layout.frameId,
    options.preGame.layout.frameBytes,
  ));
  const claimDestination = append(
    options.types.binaryType,
    quickItemMoveClaimDestination(options.globals),
  );
  const itemLookup = append(
    options.types.unaryType,
    quickItemMoveItemLookup(options.preGame.layout),
  );
  const executor = append(options.types.ternaryType, quickItemMoveStorageExecutor({
    certificate,
    layout: options.preGame.layout,
    globals: options.globals,
    itemLookup,
    numberPreference: certificate.numberPreference.functionIndex,
    uiDispatcher: uiForward,
    findFrame,
    claimDestination,
  }));
  const handler = append(options.types.binaryType, quickItemMoveHandler({
    certificate,
    layout: options.preGame.layout,
    globals: options.globals,
    itemLookup,
    numberPreference: certificate.numberPreference.functionIndex,
    uiDispatcher: uiForward,
    findFrame,
    claimDestination,
    frameDispatch: action.frameDispatch.functionIndex,
    frameDispatchOffset: action.frameDispatchOffset,
    findAncestor,
    storageExecutor: executor,
    pendingGlobal: options.pendingGlobal,
    argumentGlobalBase: options.argumentGlobalBase,
  }));
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
  ]), handlerIndex: handler });
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
