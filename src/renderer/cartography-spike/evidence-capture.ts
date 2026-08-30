/**
 * Builds one bounded, pointer-free renderer capture from independent continent
 * observation and the optional atomic current-instance model.
 */
import type {
  CartographyEvidenceCapture,
  CartographyKernelDiagnostic,
  CartographyUnavailableReason,
} from "../../shared/cartography-evidence.js";
import type { CartographyModel, CartographyModelSources } from "./cartography-model.js";
import {
  isToolboxCreditableCell,
  TOOLBOX_CARTOGRAPHY_SOURCE,
} from "./toolbox-cartography-data.js";
import type { CartographyReachabilityDiagnostic } from "./reachability-kernel.js";

const GRID_REVISION = 1;
const PLANE_LIMIT = 256;
const TRAPEZOID_LIMIT = 65_536;
const DOORWAY_LIMIT = 256;
const TERRAIN_CELL_LIMIT = 262_144;

function cloneBitset(width: number, height: number, words: Uint32Array) {
  return Object.freeze({ width, height, words: new Uint32Array(words) });
}

function positiveOrNull(value: number | null | undefined): number | null {
  return value !== undefined && value !== null && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function kernelReason(status: number): CartographyUnavailableReason | null {
  switch (status) {
    case 1: return null;
    case 2: return "invalid-input";
    case 3: return "kernel";
    case 4: return "terrain-raster-limit";
    case 5: return "no-start";
    case 6: return "ambiguous-layout";
    case 7: return "plane-limit";
    case 8: return "trapezoid-limit";
    case 9: return "doorway-limit";
    case 10: return "terrain-raster-limit";
    default: return "not-observed";
  }
}

function kernelEvidence(
  value: CartographyReachabilityDiagnostic | null,
): CartographyKernelDiagnostic | null {
  if (value === null) return null;
  const reason = kernelReason(value.status);
  const status = value.status === 1
    ? "ready" as const
    : value.status === 2
      ? "invalid-input" as const
      : value.status === 5
        ? "no-start" as const
        : value.status === 6
          ? "ambiguous-layout" as const
          : value.status === 4 || (value.status >= 7 && value.status <= 10)
            ? "limit" as const
            : "unavailable" as const;
  return Object.freeze({
    status,
    reason,
    // ABI v3 did not publish this scalar. Zero is an explicit unknown count,
    // while the closed status still identifies an exceeded plane limit.
    planeCount: 0,
    totalTrapezoids: value.totalTrapezoids,
    reachableTrapezoids: value.reachableTrapezoids,
    groundCells: value.groundCells,
    doorwayCount: value.doorwayCount,
    terrainWidth: value.terrainWidth,
    terrainHeight: value.terrainHeight,
    planeLimit: PLANE_LIMIT,
    trapezoidLimit: TRAPEZOID_LIMIT,
    doorwayLimit: DOORWAY_LIMIT,
    terrainCellLimit: TERRAIN_CELL_LIMIT,
  });
}

function creditableWords(
  continent: number,
  width: number,
  height: number,
): Uint32Array | null {
  const words = new Uint32Array(Math.ceil(width * height / 32));
  for (let index = 0; index < width * height; index += 1) {
    const creditable = isToolboxCreditableCell(
      continent,
      index % width,
      Math.floor(index / width),
    );
    if (creditable === null) return null;
    if (creditable) words[index >>> 5] = words[index >>> 5]! | (1 << (index & 31));
  }
  return words;
}

export function captureCartographyEvidence(
  model: CartographyModel,
  sources: CartographyModelSources,
): CartographyEvidenceCapture {
  sources.context.refresh();
  const context = sources.context.snapshot();
  const anchor = sources.anchor.snapshot();
  const exploration = sources.exploration.readBitmap();
  const diagnostic = sources.kernel.diagnostic();
  const sameGeneration = context?.status === 1
    && anchor?.status === 1
    && exploration?.snapshot.status === 1
    && anchor.generation === context.areaEpoch
    && exploration.snapshot.generation === context.areaEpoch;
  const creditable = sameGeneration && anchor && exploration
    ? creditableWords(
        anchor.continent,
        exploration.snapshot.width,
        exploration.snapshot.height,
      )
    : null;
  const continent = sameGeneration && anchor && exploration && creditable
    ? Object.freeze({
        status: "ready" as const,
        continentId: anchor.continent,
        explored: cloneBitset(
          exploration.snapshot.width,
          exploration.snapshot.height,
          exploration.words,
        ),
        creditable: cloneBitset(
          exploration.snapshot.width,
          exploration.snapshot.height,
          creditable,
        ),
      })
    : Object.freeze({
        status: "unavailable" as const,
        reason: context === null
          ? "context" as const
          : context.status !== 1
          ? "loading" as const
          : anchor?.status !== 1
            ? "anchor" as const
            : exploration?.snapshot.status !== 1
              ? "exploration" as const
              : "global-mask" as const,
      });
  const kernel = kernelEvidence(diagnostic);
  const companion = sources.companion();
  const currentReady = model.status === "ready"
    && sameGeneration
    && context?.status === 1
    && context.mapId === model.epoch.mapId
    && context.areaEpoch === model.epoch.area
    && diagnostic?.status === 1
    && diagnostic.mapId === model.epoch.mapId
    && diagnostic.areaEpoch === model.epoch.area
    && diagnostic.resourceGeneration === model.epoch.resource
    && kernel?.status === "ready";
  const currentInstance = model.status === "ready" && currentReady
    ? Object.freeze({
        status: "ready" as const,
        mapId: model.epoch.mapId,
        instanceType: companion?.status === "ready"
          ? companion.instanceType === 0 ? "outpost" as const : "explorable" as const
          : "unknown" as const,
        areaEpoch: model.epoch.area,
        resourceGeneration: model.epoch.resource,
        revealRadius: sources.revealRadius(),
        worldAnchor: model.worldAnchor,
        mapBounds: model.mapBounds,
        reachable: cloneBitset(
          model.reachableCells.width,
          model.reachableCells.height,
          model.reachableCells.words,
        ),
        actionable: cloneBitset(
          model.actionableCells.width,
          model.actionableCells.height,
          model.actionableCells.words,
        ),
        terrain: Object.freeze({
          mapLeft: model.walkableTerrain.mapLeft,
          mapTop: model.walkableTerrain.mapTop,
          mapUnitsPerPixel: model.walkableTerrain.mapUnitsPerPixel,
          cells: cloneBitset(
            model.walkableTerrain.width,
            model.walkableTerrain.height,
            model.walkableTerrain.words,
          ),
        }),
        kernel: kernel ?? Object.freeze({
          status: "unavailable" as const,
          reason: "not-observed" as const,
          planeCount: 0,
          totalTrapezoids: 0,
          reachableTrapezoids: 0,
          groundCells: 0,
          doorwayCount: 0,
          terrainWidth: 0,
          terrainHeight: 0,
          planeLimit: PLANE_LIMIT,
          trapezoidLimit: TRAPEZOID_LIMIT,
          doorwayLimit: DOORWAY_LIMIT,
          terrainCellLimit: TERRAIN_CELL_LIMIT,
        }),
      })
    : Object.freeze({
        status: "unavailable" as const,
        reason: model.status === "unavailable"
          ? model.reason
          : context?.status !== 1
            ? "loading" as const
            : !sameGeneration
                || context.mapId !== model.epoch.mapId
                || context.areaEpoch !== model.epoch.area
              ? "epoch-mismatch" as const
              : "kernel" as const,
        mapId: positiveOrNull(context?.mapId ?? diagnostic?.mapId),
        areaEpoch: positiveOrNull(context?.areaEpoch ?? diagnostic?.areaEpoch),
        resourceGeneration: positiveOrNull(diagnostic?.resourceGeneration),
        kernel,
      });
  return Object.freeze({
    source: Object.freeze({
      layoutId: context?.layoutId === 1 || context?.layoutId === 2
        ? context.layoutId
        : diagnostic?.layoutId === 1 || diagnostic?.layoutId === 2
          ? diagnostic.layoutId
          : null,
      gridRevision: GRID_REVISION,
      toolboxSha256: TOOLBOX_CARTOGRAPHY_SOURCE.sha256,
      kernelSha256: sources.kernel.sha256,
    }),
    continent,
    currentInstance,
  });
}
