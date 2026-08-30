/**
 * Privacy-safe Cartography evidence exchanged between the app and offline
 * tools. Every string is either a closed enum or a fixed-format identifier.
 * There is deliberately no label, account, character, path, note, or message
 * field in this contract.
 */

export const CARTOGRAPHY_EVIDENCE_FORMAT = 1 as const;
export const CARTOGRAPHY_MAX_CONTINENT_CELLS = 131_072;
export const CARTOGRAPHY_MAX_TERRAIN_CELLS = 262_144;

export const CARTOGRAPHY_UNAVAILABLE_REASONS = Object.freeze([
  "not-observed",
  "context",
  "loading",
  "companion",
  "map-mismatch",
  "anchor",
  "exploration",
  "kernel",
  "epoch-mismatch",
  "global-mask",
  "invalid-input",
  "path-array-invalid",
  "plane-limit",
  "trapezoid-limit",
  "doorway-limit",
  "terrain-raster-limit",
  "no-start",
  "ambiguous-layout",
] as const);

export type CartographyUnavailableReason =
  (typeof CARTOGRAPHY_UNAVAILABLE_REASONS)[number];

export const CARTOGRAPHY_INSTANCE_TYPES = Object.freeze([
  "outpost",
  "explorable",
  "mission",
  "unknown",
] as const);

export type CartographyInstanceType =
  (typeof CARTOGRAPHY_INSTANCE_TYPES)[number];

export const CARTOGRAPHY_KERNEL_STATUSES = Object.freeze([
  "ready",
  "invalid-input",
  "unavailable",
  "limit",
  "no-start",
  "ambiguous-layout",
] as const);

export type CartographyKernelStatus =
  (typeof CARTOGRAPHY_KERNEL_STATUSES)[number];

export type CartographyEncodedBitset = Readonly<{
  encoding: "u32-le-base64";
  width: number;
  height: number;
  setBits: number;
  sha256: string;
  data: string;
}>;

export type CartographyEvidenceSource = Readonly<{
  applicationVersion: string;
  clientSha256: string | null;
  layoutId: 1 | 2 | null;
  gridRevision: number;
  toolboxSha256: string;
  kernelSha256: string | null;
}>;

export type CartographyContinentEvidence =
  | Readonly<{
      status: "unavailable";
      reason: CartographyUnavailableReason;
    }>
  | Readonly<{
      status: "ready";
      continentId: number;
      explored: CartographyEncodedBitset;
      creditable: CartographyEncodedBitset;
      remainingEstimate: CartographyEncodedBitset;
    }>;

export type CartographyKernelDiagnostic = Readonly<{
  status: CartographyKernelStatus;
  reason: CartographyUnavailableReason | null;
  planeCount: number;
  totalTrapezoids: number;
  reachableTrapezoids: number;
  groundCells: number;
  doorwayCount: number;
  terrainWidth: number;
  terrainHeight: number;
  planeLimit: number;
  trapezoidLimit: number;
  doorwayLimit: number;
  terrainCellLimit: number;
}>;

export type CartographyTerrainEvidence = Readonly<{
  mapLeft: number;
  mapTop: number;
  mapUnitsPerPixel: number;
  cells: CartographyEncodedBitset;
}>;

export type CartographyCurrentInstanceEvidence =
  | Readonly<{
      status: "unavailable";
      reason: CartographyUnavailableReason;
      mapId: number | null;
      areaEpoch: number | null;
      resourceGeneration: number | null;
      kernel: CartographyKernelDiagnostic | null;
    }>
  | Readonly<{
      status: "ready";
      mapId: number;
      instanceType: CartographyInstanceType;
      areaEpoch: number;
      resourceGeneration: number;
      revealRadius: 1 | 3;
      worldAnchor: Readonly<{ x: number; y: number }>;
      mapBounds: Readonly<{
        min: Readonly<{ x: number; y: number }>;
        max: Readonly<{ x: number; y: number }>;
      }>;
      reachable: CartographyEncodedBitset;
      actionable: CartographyEncodedBitset;
      terrain: CartographyTerrainEvidence;
      kernel: CartographyKernelDiagnostic;
    }>;

export type CartographyEvidenceReport = Readonly<{
  formatVersion: typeof CARTOGRAPHY_EVIDENCE_FORMAT;
  reportId: string;
  capturedAt: string;
  contentSha256: string;
  source: CartographyEvidenceSource;
  continent: CartographyContinentEvidence;
  currentInstance: CartographyCurrentInstanceEvidence | null;
}>;

export type CartographyEvidenceDraft = Omit<
  CartographyEvidenceReport,
  "contentSha256"
>;

/**
 * Bounded renderer-to-main capture. The renderer owns live observations; main
 * owns hashing, validation, the save dialog, and the diagnostics archive.
 * Typed arrays cross Electron's structured-clone boundary without exposing
 * game-memory addresses.
 */
export type CartographyBitsetCapture = Readonly<{
  width: number;
  height: number;
  words: Uint32Array;
}>;

export type CartographyEvidenceCapture = Readonly<{
  source: Readonly<{
    layoutId: 1 | 2 | null;
    gridRevision: number;
    toolboxSha256: string;
    kernelSha256: string | null;
  }>;
  continent:
    | Readonly<{ status: "unavailable"; reason: CartographyUnavailableReason }>
    | Readonly<{
        status: "ready";
        continentId: number;
        explored: CartographyBitsetCapture;
        creditable: CartographyBitsetCapture;
      }>;
  currentInstance:
    | Readonly<{
        status: "unavailable";
        reason: CartographyUnavailableReason;
        mapId: number | null;
        areaEpoch: number | null;
        resourceGeneration: number | null;
        kernel: CartographyKernelDiagnostic | null;
      }>
    | Readonly<{
        status: "ready";
        mapId: number;
        instanceType: CartographyInstanceType;
        areaEpoch: number;
        resourceGeneration: number;
        revealRadius: 1 | 3;
        worldAnchor: Readonly<{ x: number; y: number }>;
        mapBounds: Readonly<{
          min: Readonly<{ x: number; y: number }>;
          max: Readonly<{ x: number; y: number }>;
        }>;
        reachable: CartographyBitsetCapture;
        actionable: CartographyBitsetCapture;
        terrain: Readonly<{
          mapLeft: number;
          mapTop: number;
          mapUnitsPerPixel: number;
          cells: CartographyBitsetCapture;
        }>;
        kernel: CartographyKernelDiagnostic;
      }>;
}>;

export type CartographyEvidenceExportResult =
  | Readonly<{ status: "written" }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "unavailable"; reason: CartographyUnavailableReason }>;
