/**
 * Validates renderer-supplied Cartography captures, derives strict reports,
 * and renders deterministic previews without knowing Electron or file paths.
 */
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import {
  CARTOGRAPHY_EVIDENCE_FORMAT,
  CARTOGRAPHY_MAX_CONTINENT_CELLS,
  CARTOGRAPHY_MAX_TERRAIN_CELLS,
  type CartographyBitsetCapture,
  type CartographyEncodedBitset,
  type CartographyEvidenceCapture,
  type CartographyEvidenceDraft,
  type CartographyEvidenceReport,
} from "../../shared/cartography-evidence.js";
import type { ClientSession } from "../../shared/contracts.js";
import { ValidationError } from "../../shared/errors.js";
import {
  decodeCartographyBitset,
  encodeCartographyBitset,
  sealCartographyEvidence,
} from "./report.js";

const REPORT_WORD_CEILING = Math.ceil(CARTOGRAPHY_MAX_TERRAIN_CELLS / 32);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function bitsetCapture(
  value: unknown,
  maximumCells: number,
): CartographyBitsetCapture {
  if (!record(value) || !exact(value, ["width", "height", "words"])
    || !Number.isSafeInteger(value.width) || Number(value.width) <= 0
    || !Number.isSafeInteger(value.height) || Number(value.height) <= 0
    || !(value.words instanceof Uint32Array)) {
    throw new ValidationError("invalid Cartography bitset capture");
  }
  const width = Number(value.width);
  const height = Number(value.height);
  const cells = width * height;
  if (!Number.isSafeInteger(cells) || cells <= 0 || cells > maximumCells
    || value.words.length !== Math.ceil(cells / 32)
    || value.words.length > REPORT_WORD_CEILING) {
    throw new ValidationError("Cartography bitset capture is out of bounds");
  }
  return Object.freeze({ width, height, words: new Uint32Array(value.words) });
}

/** Reject unknown fields before any renderer-owned value reaches the ZIP. */
export function parseCartographyEvidenceCapture(
  value: unknown,
): CartographyEvidenceCapture {
  if (!record(value) || !exact(value, ["source", "continent", "currentInstance"])
    || !record(value.source)
    || !exact(value.source, ["layoutId", "gridRevision", "toolboxSha256", "kernelSha256"])
    || !record(value.continent) || !record(value.currentInstance)) {
    throw new ValidationError("invalid Cartography evidence capture");
  }
  const continent = value.continent.status === "ready"
    ? (() => {
        if (!exact(value.continent, ["status", "continentId", "explored", "creditable"])) {
          throw new ValidationError("invalid ready Cartography continent capture");
        }
        return Object.freeze({
          status: "ready" as const,
          continentId: value.continent.continentId,
          explored: bitsetCapture(value.continent.explored, CARTOGRAPHY_MAX_CONTINENT_CELLS),
          creditable: bitsetCapture(value.continent.creditable, CARTOGRAPHY_MAX_CONTINENT_CELLS),
        });
      })()
    : (() => {
        if (!exact(value.continent, ["status", "reason"])) {
          throw new ValidationError("invalid unavailable Cartography continent capture");
        }
        return Object.freeze({
          status: value.continent.status,
          reason: value.continent.reason,
        });
      })();
  const current = value.currentInstance.status === "ready"
    ? (() => {
        if (!exact(value.currentInstance, [
          "status", "mapId", "instanceType", "areaEpoch", "resourceGeneration",
          "revealRadius", "worldAnchor", "mapBounds", "reachable", "actionable",
          "terrain", "kernel",
        ]) || !record(value.currentInstance.terrain)
          || !exact(value.currentInstance.terrain, [
            "mapLeft", "mapTop", "mapUnitsPerPixel", "cells",
          ])) {
          throw new ValidationError("invalid ready Cartography instance capture");
        }
        return Object.freeze({
          ...value.currentInstance,
          status: "ready" as const,
          reachable: bitsetCapture(
            value.currentInstance.reachable,
            CARTOGRAPHY_MAX_CONTINENT_CELLS,
          ),
          actionable: bitsetCapture(
            value.currentInstance.actionable,
            CARTOGRAPHY_MAX_CONTINENT_CELLS,
          ),
          terrain: Object.freeze({
            ...value.currentInstance.terrain,
            cells: bitsetCapture(
              value.currentInstance.terrain.cells,
              CARTOGRAPHY_MAX_TERRAIN_CELLS,
            ),
          }),
        });
      })()
    : (() => {
        if (!exact(value.currentInstance, [
          "status", "reason", "mapId", "areaEpoch", "resourceGeneration", "kernel",
        ])) {
          throw new ValidationError("invalid unavailable Cartography instance capture");
        }
        return Object.freeze({ ...value.currentInstance });
      })();
  return Object.freeze({
    source: Object.freeze({ ...value.source }),
    continent,
    currentInstance: current,
  }) as CartographyEvidenceCapture;
}

function encoded(capture: CartographyBitsetCapture) {
  return encodeCartographyBitset(capture.width, capture.height, capture.words);
}

export function buildCartographyEvidenceReport(
  capture: CartographyEvidenceCapture,
  session: ClientSession,
): CartographyEvidenceReport {
  const continent = capture.continent.status === "ready"
    ? (() => {
        const ready = capture.continent;
        const explored = encoded(ready.explored);
        const creditable = encoded(ready.creditable);
        if (explored.width !== creditable.width || explored.height !== creditable.height) {
          throw new ValidationError("Cartography continent bitset dimensions differ");
        }
        const remaining = Uint32Array.from(
          ready.creditable.words,
          (word, index) => word & ~ready.explored.words[index]!,
        );
        return Object.freeze({
          status: "ready" as const,
          continentId: ready.continentId,
          explored,
          creditable,
          remainingEstimate: encodeCartographyBitset(
            explored.width,
            explored.height,
            remaining,
          ),
        });
      })()
    : capture.continent;
  const currentInstance = capture.currentInstance.status === "ready"
    ? Object.freeze({
        ...capture.currentInstance,
        reachable: encoded(capture.currentInstance.reachable),
        actionable: encoded(capture.currentInstance.actionable),
        terrain: Object.freeze({
          mapLeft: capture.currentInstance.terrain.mapLeft,
          mapTop: capture.currentInstance.terrain.mapTop,
          mapUnitsPerPixel: capture.currentInstance.terrain.mapUnitsPerPixel,
          cells: encoded(capture.currentInstance.terrain.cells),
        }),
      })
    : capture.currentInstance;
  const draft: CartographyEvidenceDraft = {
    formatVersion: CARTOGRAPHY_EVIDENCE_FORMAT,
    reportId: randomUUID(),
    capturedAt: new Date().toISOString(),
    source: {
      applicationVersion: session.appVersion,
      clientSha256: session.compatibility?.clientSha256 ?? null,
      ...capture.source,
    },
    continent,
    currentInstance,
  };
  return sealCartographyEvidence(draft);
}

function has(words: Uint32Array, index: number): boolean {
  return ((words[index >>> 5]! >>> (index & 31)) & 1) === 1;
}

export type CartographyPreviewColor = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

/** Draw ordered semantic layers; later layers take visual precedence. */
export function renderCartographyBitsetPreview(
  layers: readonly Readonly<{
    cells: CartographyEncodedBitset;
    color: CartographyPreviewColor;
  }>[],
  background: CartographyPreviewColor = [17, 22, 25, 255],
): Uint8Array {
  if (layers.length === 0) throw new ValidationError("preview requires a layer");
  const { width, height } = layers[0]!.cells;
  const decoded = layers.map(({ cells, color }) => {
    if (cells.width !== width || cells.height !== height) {
      throw new ValidationError("preview layer dimensions differ");
    }
    return Object.freeze({ words: decodeCartographyBitset(cells), color });
  });
  const png = new PNG({ width, height, colorType: 6 });
  for (let index = 0; index < width * height; index += 1) {
    let color = background;
    for (const layer of decoded) {
      if (has(layer.words, index)) color = layer.color;
    }
    const offset = index * 4;
    png.data[offset] = color[0];
    png.data[offset + 1] = color[1];
    png.data[offset + 2] = color[2];
    png.data[offset + 3] = color[3];
  }
  return PNG.sync.write(png);
}

/** A deterministic data preview, not a screenshot of the player's game. */
export function renderCartographyEvidencePreview(
  report: CartographyEvidenceReport,
): Uint8Array | null {
  if (report.continent.status !== "ready") return null;
  return renderCartographyBitsetPreview([
    { cells: report.continent.creditable, color: [226, 174, 62, 255] },
    { cells: report.continent.explored, color: [64, 125, 92, 255] },
    ...(report.currentInstance?.status === "ready"
      ? [{
          cells: report.currentInstance.actionable,
          color: [255, 116, 38, 255] as const,
        }]
      : []),
  ]);
}
