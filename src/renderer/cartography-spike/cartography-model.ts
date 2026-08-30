/**
 * The one atomic Cartography model. Native observations are accepted only when
 * they belong to one unchanged, even context sequence and area epoch.
 */
import type {
  CartographyContextController,
  CompassFrameSpikeController,
  ExplorationSpikeController,
  MissionMapFrameSpikeController,
  WorldMapAnchorSpikeController,
} from "../../shared/cartography-spike.js";
import type { PublishedCompanionState } from "../companion-snapshot.js";
import type { CartographyReachabilityController } from "./reachability-kernel.js";
import { isToolboxCreditableCell } from "./toolbox-cartography-data.js";

declare const explorationBrand: unique symbol;
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
  | "companion"
  | "map-mismatch"
  | "anchor"
  | "exploration"
  | "kernel"
  | "epoch-mismatch"
  | "global-mask";

export type CartographyModel =
  | Readonly<{ status: "unavailable"; reason: CartographyUnavailableReason }>
  | Readonly<{
      status: "ready";
      sequence: number;
      epoch: Readonly<{ mapId: number; area: number; resource: number }>;
      continent: number;
      worldAnchor: MapPoint;
      mapBounds: Readonly<{ min: MapPoint; max: MapPoint }>;
      player: GamePoint;
      exploration: ExplorationBitset;
      walkableTerrain: WalkableTerrainRaster;
      reachableCells: ReachableCellBitset;
      actionableCells: ActionableCellBitset;
      surfaces: Readonly<{
        compass: ReturnType<CompassFrameSpikeController["snapshot"]>;
        missionMap: ReturnType<MissionMapFrameSpikeController["snapshot"]>;
      }>;
    }>;

export type CartographyCorrection = "include" | "exclude" | null;

export type CartographyModelSources = Readonly<{
  context: CartographyContextController;
  compass: CompassFrameSpikeController;
  missionMap: MissionMapFrameSpikeController;
  exploration: ExplorationSpikeController;
  anchor: WorldMapAnchorSpikeController;
  kernel: CartographyReachabilityController;
  companion(): PublishedCompanionState | null | undefined;
  revealRadius(): 1 | 3;
  correction(mapId: number, cell: GridCell): CartographyCorrection;
}>;

const unavailable = (reason: CartographyUnavailableReason): CartographyModel =>
  Object.freeze({ status: "unavailable", reason });

function bit(words: Uint32Array, index: number): boolean {
  return ((words[index >>> 5]! >>> (index & 31)) & 1) === 1;
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

/** Build one immutable model or fail closed. No partial observations escape. */
export function readCartographyModel(sources: CartographyModelSources): CartographyModel {
  if (!sources.context.refresh()) return unavailable("context");
  const contextA = sources.context.snapshot();
  if (contextA === null) return unavailable("context");
  if (contextA.status !== 1) return unavailable("loading");
  const companion = sources.companion();
  if (companion?.status !== "ready") return unavailable("companion");
  if (companion.mapId !== contextA.mapId) return unavailable("map-mismatch");

  const anchor = sources.anchor.snapshot();
  if (
    anchor === null || anchor.status !== 1
    || anchor.generation !== contextA.areaEpoch
  ) return unavailable("anchor");
  const exploration = sources.exploration.readBitmap();
  if (
    exploration === null || exploration.snapshot.status !== 1
    || exploration.snapshot.generation !== contextA.areaEpoch
  ) return unavailable("exploration");

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
  ) return unavailable("kernel");

  const contextB = sources.context.snapshot();
  if (contextB === null || contextB.status !== 1 || !contextEqual(contextA, contextB)) {
    return unavailable("epoch-mismatch");
  }

  const cells = kernel.width * kernel.height;
  const actionableWords = new Uint32Array(Math.ceil(cells / 32));
  for (let index = 0; index < cells; index += 1) {
    const x = index % kernel.width;
    const y = Math.floor(index / kernel.width);
    const correction = sources.correction(contextA.mapId, { x, y });
    const creditable = isToolboxCreditableCell(anchor.continent, x, y);
    if (creditable === null) return unavailable("global-mask");
    const explored = bit(exploration.words, index);
    const reachable = bit(kernel.reachableCells.words, index);
    const actionable = !explored && (
      correction === "include"
      || (correction !== "exclude" && creditable && reachable)
    );
    if (actionable) {
      const word = index >>> 5;
      actionableWords[word] = actionableWords[word]! | (1 << (index & 31));
    }
  }

  const compass = sources.compass.snapshot();
  const missionMap = sources.missionMap.snapshot();
  return Object.freeze({
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
    exploration: Object.freeze({
      width: exploration.snapshot.width,
      height: exploration.snapshot.height,
      words: exploration.words,
    }) as ExplorationBitset,
    walkableTerrain: Object.freeze(kernel.walkableTerrain) as WalkableTerrainRaster,
    reachableCells: Object.freeze({
      width: kernel.width,
      height: kernel.height,
      words: kernel.reachableCells.words,
    }) as ReachableCellBitset,
    actionableCells: Object.freeze({
      width: kernel.width,
      height: kernel.height,
      words: actionableWords,
    }) as ActionableCellBitset,
    surfaces: Object.freeze({
      compass: compass?.generation === contextA.areaEpoch ? compass : null,
      missionMap: missionMap?.generation === contextA.areaEpoch ? missionMap : null,
    }),
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
