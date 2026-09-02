/**
 * Builds one bounded, pointer-free renderer capture from independent continent
 * observation and the optional atomic current-instance model.
 */
import type {
  CartographyEvidenceCapture,
  CartographyKernelDiagnostic,
  CartographyUnavailableReason,
} from "../../shared/cartography-evidence.js";
import type { CartographyModelSources, CartographyState } from "./cartography-model.js";
import { TOOLBOX_CARTOGRAPHY_SOURCE } from "./toolbox-cartography-data.js";
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

export function captureCartographyEvidence(
  state: CartographyState,
  sources: CartographyModelSources,
): CartographyEvidenceCapture {
  const diagnostic = sources.kernel.diagnostic();
  const readyContinent = state.continent.status === "ready" ? state.continent : null;
  const continent = readyContinent !== null
    ? Object.freeze({
        status: "ready" as const,
        continentId: readyContinent.continent,
        explored: cloneBitset(
          readyContinent.explored.width,
          readyContinent.explored.height,
          readyContinent.explored.words,
        ),
        creditable: cloneBitset(
          readyContinent.creditable.width,
          readyContinent.creditable.height,
          readyContinent.creditable.words,
        ),
      })
    : Object.freeze({
        status: "unavailable" as const,
        reason: state.continent.status === "unavailable"
          ? state.continent.reason
          : "context" as const,
      });
  const kernel = kernelEvidence(diagnostic);
  const companion = sources.companion();
  const current = state.currentInstance;
  const currentReady = current.status === "ready"
    && state.context !== null
    && state.context.mapId === current.epoch.mapId
    && state.context.areaEpoch === current.epoch.area
    && diagnostic?.status === 1
    && diagnostic.mapId === current.epoch.mapId
    && diagnostic.areaEpoch === current.epoch.area
    && diagnostic.resourceGeneration === current.epoch.resource
    && kernel?.status === "ready";
  const currentInstance = current.status === "ready" && currentReady
    ? Object.freeze({
        status: "ready" as const,
        mapId: current.epoch.mapId,
        instanceType: companion?.status === "ready"
          ? companion.instanceType === 0 ? "outpost" as const : "explorable" as const
          : "unknown" as const,
        areaEpoch: current.epoch.area,
        resourceGeneration: current.epoch.resource,
        revealRadius: sources.revealRadius(),
        worldAnchor: current.worldAnchor,
        mapBounds: current.mapBounds,
        reachable: cloneBitset(
          current.reachableCells.width,
          current.reachableCells.height,
          current.reachableCells.words,
        ),
        actionable: cloneBitset(
          current.reachableCells.width,
          current.reachableCells.height,
          // Limited areas have terrain evidence but no progress mask, so they
          // intentionally publish no confirmed actionable cells.
          current.guidance.status === "ready"
            ? current.guidance.actionableCells.words
            : new Uint32Array(current.reachableCells.words.length),
        ),
        terrain: Object.freeze({
          mapLeft: current.walkableTerrain.mapLeft,
          mapTop: current.walkableTerrain.mapTop,
          mapUnitsPerPixel: current.walkableTerrain.mapUnitsPerPixel,
          cells: cloneBitset(
            current.walkableTerrain.width,
            current.walkableTerrain.height,
            current.walkableTerrain.words,
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
        reason: current.status === "unavailable" ? current.reason : "kernel" as const,
        mapId: positiveOrNull(state.context?.mapId ?? diagnostic?.mapId),
        areaEpoch: positiveOrNull(state.context?.areaEpoch ?? diagnostic?.areaEpoch),
        resourceGeneration: positiveOrNull(diagnostic?.resourceGeneration),
        kernel,
      });
  return Object.freeze({
    source: Object.freeze({
      layoutId: state.context?.layoutId === 1 || state.context?.layoutId === 2
        ? state.context.layoutId
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
