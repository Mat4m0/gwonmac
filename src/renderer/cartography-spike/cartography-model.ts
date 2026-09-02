/**
 * Owns Cartography's one canonical renderer state. Continent progress and
 * current-instance guidance fail independently, while each accepted value is
 * assembled from one unchanged certified context epoch.
 */
import type {
  CartographyContextController,
  CompassFrameSpikeController,
  ExplorationSpikeController,
  MissionMapFrameSpikeController,
  WorldMapAnchorSpikeController,
  WorldMapFrameSpikeController,
} from "../../shared/cartography-spike.js";
import type { PublishedCompanionState } from "../companion-snapshot.js";
import type { CartographyReachabilityController } from "./reachability-kernel.js";
import { isToolboxCreditableCell } from "./toolbox-cartography-data.js";

declare const explorationBrand: unique symbol;
declare const creditableBrand: unique symbol;
declare const exploredCreditableBrand: unique symbol;
declare const remainingBrand: unique symbol;
declare const reachableBrand: unique symbol;
declare const actionableBrand: unique symbol;
declare const terrainBrand: unique symbol;

export type GridCell = Readonly<{ x: number; y: number }>;
export type GamePoint = Readonly<{ x: number; y: number }>;
export type MapPoint = Readonly<{ x: number; y: number }>;
export type ScreenPoint = Readonly<{ x: number; y: number }>;

type FixedBitset = Readonly<{
  width: number;
  height: number;
  words: Uint32Array;
}>;

export type ExplorationBitset = FixedBitset & { readonly [explorationBrand]: true };
export type CreditableCellBitset = FixedBitset & { readonly [creditableBrand]: true };
export type ExploredCreditableBitset = FixedBitset & {
  readonly [exploredCreditableBrand]: true;
};
export type RemainingCellBitset = FixedBitset & { readonly [remainingBrand]: true };
export type ReachableCellBitset = FixedBitset & { readonly [reachableBrand]: true };
export type ActionableCellBitset = FixedBitset & { readonly [actionableBrand]: true };
export type WalkableTerrainRaster = Readonly<{
  mapLeft: number;
  mapTop: number;
  mapUnitsPerPixel: number;
  width: number;
  height: number;
  words: Uint32Array;
  readonly [terrainBrand]: true;
}>;

export type CartographyUnavailableReason =
  | "context"
  | "loading"
  | "unsupported-area"
  | "companion"
  | "map-mismatch"
  | "anchor"
  | "exploration"
  | "kernel"
  | "epoch-mismatch"
  | "global-mask";

export type CartographyContinentState =
  | Readonly<{ status: "unavailable"; reason: CartographyUnavailableReason }>
  | Readonly<{
      status: "ready";
      continent: number;
      generation: number;
      explorationSequence: number;
      explored: ExplorationBitset;
      creditable: CreditableCellBitset;
      exploredCreditable: ExploredCreditableBitset;
      remaining: RemainingCellBitset;
    }>;

export type CartographyGuidanceState =
  | Readonly<{ status: "unavailable"; reason: CartographyUnavailableReason }>
  | Readonly<{ status: "ready"; actionableCells: ActionableCellBitset }>;

export type CartographyCurrentInstanceState =
  | Readonly<{ status: "unavailable"; reason: CartographyUnavailableReason }>
  | Readonly<{
      status: "ready";
      sequence: number;
      epoch: Readonly<{ mapId: number; area: number; resource: number }>;
      continent: number;
      worldAnchor: MapPoint;
      mapBounds: Readonly<{ min: MapPoint; max: MapPoint }>;
      player: GamePoint;
      walkableTerrain: WalkableTerrainRaster;
      reachableCells: ReachableCellBitset;
      guidance: CartographyGuidanceState;
    }>;

export type CartographyState = Readonly<{
  context: Readonly<{
    sequence: number;
    mapId: number;
    areaEpoch: number;
    layoutId: 1 | 2;
  }> | null;
  continent: CartographyContinentState;
  currentInstance: CartographyCurrentInstanceState;
  surfaces: Readonly<{
    compass: ReturnType<CompassFrameSpikeController["snapshot"]>;
    missionMap: ReturnType<MissionMapFrameSpikeController["snapshot"]>;
    worldMap: ReturnType<WorldMapFrameSpikeController["snapshot"]>;
  }>;
}>;

export type CartographyPresentation = Readonly<{
  player: GamePoint | null;
  compass: ReturnType<CompassFrameSpikeController["snapshot"]>;
  missionMap: ReturnType<MissionMapFrameSpikeController["snapshot"]>;
  worldMap: ReturnType<WorldMapFrameSpikeController["snapshot"]>;
}>;

export type CartographyModelSources = Readonly<{
  context: CartographyContextController;
  compass: CompassFrameSpikeController;
  missionMap: MissionMapFrameSpikeController;
  worldMap: WorldMapFrameSpikeController;
  exploration: ExplorationSpikeController;
  anchor: WorldMapAnchorSpikeController;
  kernel: CartographyReachabilityController;
  companion(): PublishedCompanionState | null | undefined;
  revealRadius(): 1 | 3;
}>;

const unavailable = (reason: CartographyUnavailableReason) =>
  Object.freeze({ status: "unavailable" as const, reason });

const continentCache = new WeakMap<
  ExplorationSpikeController,
  Readonly<{
    continent: number;
    generation: number;
    explorationSequence: number;
    width: number;
    height: number;
    value: Extract<CartographyContinentState, { status: "ready" }>;
  }>
>();

function bit(words: Uint32Array, index: number): boolean {
  return ((words[index >>> 5]! >>> (index & 31)) & 1) === 1;
}

function set(words: Uint32Array, index: number): void {
  words[index >>> 5] = words[index >>> 5]! | (1 << (index & 31));
}

function contextEqual(
  left: NonNullable<ReturnType<CartographyContextController["snapshot"]>>,
  right: NonNullable<ReturnType<CartographyContextController["snapshot"]>>,
): boolean {
  return left.sequence === right.sequence
    && left.areaEpoch === right.areaEpoch
    && left.mapId === right.mapId
    && left.layoutId === right.layoutId;
}

function emptyState(reason: CartographyUnavailableReason): CartographyState {
  return Object.freeze({
    context: null,
    continent: unavailable(reason),
    currentInstance: unavailable(reason),
    surfaces: Object.freeze({ compass: null, missionMap: null, worldMap: null }),
  });
}

/** Progress masks are meaningful on the campaign and Pre-Searing world maps. */
export function isCartographyProgressSupported(
  continent: number,
  onWorldMap: boolean,
): boolean {
  return onWorldMap && (
    continent === 0 || continent === 1 || continent === 2 || continent === 4
  );
}

/** Build one continent partition. Every creditable cell is exactly explored or remaining. */
function deriveContinent(
  continent: number,
  generation: number,
  explorationSequence: number,
  width: number,
  height: number,
  explorationWords: Uint32Array,
): CartographyContinentState {
  const cells = width * height;
  const creditableWords = new Uint32Array(Math.ceil(cells / 32));
  const exploredCreditableWords = new Uint32Array(creditableWords.length);
  const remainingWords = new Uint32Array(creditableWords.length);
  for (let index = 0; index < cells; index += 1) {
    const creditable = isToolboxCreditableCell(
      continent,
      index % width,
      Math.floor(index / width),
    );
    if (creditable === null) return unavailable("global-mask");
    if (!creditable) continue;
    set(creditableWords, index);
    if (bit(explorationWords, index)) set(exploredCreditableWords, index);
    else set(remainingWords, index);
  }
  return Object.freeze({
    status: "ready",
    continent,
    generation,
    explorationSequence,
    explored: Object.freeze({
      width,
      height,
      words: explorationWords,
    }) as ExplorationBitset,
    creditable: Object.freeze({
      width,
      height,
      words: creditableWords,
    }) as CreditableCellBitset,
    exploredCreditable: Object.freeze({
      width,
      height,
      words: exploredCreditableWords,
    }) as ExploredCreditableBitset,
    remaining: Object.freeze({
      width,
      height,
      words: remainingWords,
    }) as RemainingCellBitset,
  });
}

function deriveContinentCached(
  source: ExplorationSpikeController,
  continent: number,
  generation: number,
  explorationSequence: number,
  width: number,
  height: number,
  explorationWords: Uint32Array,
): CartographyContinentState {
  const cached = continentCache.get(source);
  if (
    cached?.continent === continent
    && cached.generation === generation
    && cached.explorationSequence === explorationSequence
    && cached.width === width
    && cached.height === height
  ) return cached.value;
  const value = deriveContinent(
    continent,
    generation,
    explorationSequence,
    width,
    height,
    explorationWords,
  );
  if (value.status === "ready") {
    continentCache.set(source, Object.freeze({
      continent,
      generation,
      explorationSequence,
      width,
      height,
      value,
    }));
  }
  return value;
}

function deriveGuidance(
  continent: CartographyContinentState,
  reachableCells: ReachableCellBitset,
): CartographyGuidanceState {
  if (continent.status === "unavailable") return unavailable(continent.reason);
  const actionableWords = new Uint32Array(reachableCells.words.length);
  for (let index = 0; index < reachableCells.width * reachableCells.height; index += 1) {
    if (bit(continent.remaining.words, index) && bit(reachableCells.words, index)) {
      set(actionableWords, index);
    }
  }
  return Object.freeze({
    status: "ready",
    actionableCells: Object.freeze({
      width: reachableCells.width,
      height: reachableCells.height,
      words: actionableWords,
    }) as ActionableCellBitset,
  });
}

/**
 * Read one immutable state or fail the affected evidence level closed. Native
 * context, exploration, and anchor observations must share one even epoch.
 */
export function readCartographyState(sources: CartographyModelSources): CartographyState {
  if (!sources.context.refresh()) return emptyState("context");
  const contextA = sources.context.snapshot();
  if (contextA === null) return emptyState("context");
  if (contextA.status !== 1) return emptyState("loading");

  const anchor = sources.anchor.snapshot();
  if (
    anchor === null || anchor.status !== 1
    || anchor.generation !== contextA.areaEpoch
  ) return emptyState("anchor");
  const exploration = sources.exploration.readBitmap();
  if (
    exploration === null || exploration.snapshot.status !== 1
    || exploration.snapshot.generation !== contextA.areaEpoch
  ) return emptyState("exploration");

  const companion = sources.companion();
  const continent: CartographyContinentState = companion?.status !== "ready"
    || companion.playRegion === "unknown"
    ? unavailable("companion")
    : companion.mapId !== contextA.mapId
      ? unavailable("map-mismatch")
      : !isCartographyProgressSupported(anchor.continent, companion.onWorldMap)
        ? unavailable("unsupported-area")
        : deriveContinentCached(
            sources.exploration,
            anchor.continent,
            contextA.areaEpoch,
            exploration.snapshot.sequence,
            exploration.snapshot.width,
            exploration.snapshot.height,
            exploration.words,
          );
  let current: CartographyCurrentInstanceState = unavailable("companion");
  if (companion?.status === "ready") {
    if (companion.mapId !== contextA.mapId) current = unavailable("map-mismatch");
    else {
      const kernel = sources.kernel.classify({
        layoutId: contextA.layoutId,
        mapId: contextA.mapId,
        areaEpoch: contextA.areaEpoch,
        playerId: companion.playerId,
        worldAnchorX: anchor.worldAnchorX,
        worldAnchorY: anchor.worldAnchorY,
        width: exploration.snapshot.width,
        height: exploration.snapshot.height,
        mapMinX: anchor.mapMinX,
        mapMinY: anchor.mapMinY,
        mapMaxX: anchor.mapMaxX,
        mapMaxY: anchor.mapMaxY,
        revealRadius: sources.revealRadius(),
      });
      if (
        kernel === null || kernel.status !== 1
        || kernel.mapId !== contextA.mapId
        || kernel.areaEpoch !== contextA.areaEpoch
        || kernel.layoutId !== contextA.layoutId
        || kernel.width !== exploration.snapshot.width
        || kernel.height !== exploration.snapshot.height
      ) current = unavailable("kernel");
      else {
        const reachableCells = Object.freeze({
          width: kernel.width,
          height: kernel.height,
          words: kernel.reachableCells.words,
        }) as ReachableCellBitset;
        current = Object.freeze({
          status: "ready",
          sequence: contextA.sequence,
          epoch: Object.freeze({
            mapId: contextA.mapId,
            area: contextA.areaEpoch,
            resource: kernel.resourceGeneration,
          }),
          continent: anchor.continent,
          worldAnchor: Object.freeze({ x: anchor.worldAnchorX, y: anchor.worldAnchorY }),
          mapBounds: Object.freeze({
            min: Object.freeze({ x: anchor.mapMinX, y: anchor.mapMinY }),
            max: Object.freeze({ x: anchor.mapMaxX, y: anchor.mapMaxY }),
          }),
          player: Object.freeze({ x: companion.playerX, y: companion.playerY }),
          walkableTerrain: Object.freeze(kernel.walkableTerrain) as WalkableTerrainRaster,
          reachableCells,
          guidance: deriveGuidance(continent, reachableCells),
        });
      }
    }
  }

  const contextB = sources.context.snapshot();
  if (contextB === null || contextB.status !== 1 || !contextEqual(contextA, contextB)) {
    return emptyState("epoch-mismatch");
  }
  const compass = sources.compass.snapshot();
  const missionMap = sources.missionMap.snapshot();
  const worldMap = sources.worldMap.snapshot();
  return Object.freeze({
    context: Object.freeze({
      sequence: contextA.sequence,
      mapId: contextA.mapId,
      areaEpoch: contextA.areaEpoch,
      layoutId: contextA.layoutId,
    }),
    continent,
    currentInstance: current,
    surfaces: Object.freeze({
      compass: compass?.generation === contextA.areaEpoch ? compass : null,
      missionMap: missionMap?.generation === contextA.areaEpoch ? missionMap : null,
      worldMap: worldMap?.generation === contextA.areaEpoch ? worldMap : null,
    }),
  });
}

/** Read cheap frame-sensitive presentation state without rerunning classification. */
export function readCartographyPresentation(
  state: CartographyState,
  sources: CartographyModelSources,
): CartographyPresentation {
  const current = state.currentInstance;
  const context = state.context;
  if (context === null) {
    return Object.freeze({ player: null, compass: null, missionMap: null, worldMap: null });
  }
  const companion = sources.companion();
  const player = current.status === "ready"
    && companion?.status === "ready" && companion.mapId === current.epoch.mapId
    ? Object.freeze({ x: companion.playerX, y: companion.playerY })
    : null;
  const compass = sources.compass.snapshot();
  const missionMap = sources.missionMap.snapshot();
  const worldMap = sources.worldMap.snapshot();
  return Object.freeze({
    player,
    compass: compass?.generation === context.areaEpoch ? compass : null,
    missionMap: missionMap?.generation === context.areaEpoch ? missionMap : null,
    worldMap: worldMap?.generation === context.areaEpoch ? worldMap : null,
  });
}

export function bitsetHasCell(bitset: FixedBitset, cell: GridCell): boolean | null {
  if (
    !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)
    || cell.x < 0 || cell.y < 0
    || cell.x >= bitset.width || cell.y >= bitset.height
  ) return null;
  return bit(bitset.words, cell.y * bitset.width + cell.x);
}
